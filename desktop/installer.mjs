// Runs only in the verified official Electron's Node mode. No npm, lifecycle scripts,
// home migration, credentials, provider calls or application shutdown.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

process.on('uncaughtException', error => { console.error(`Desktop installer: ${error.message}`); process.exitCode = 1; });
const originalFs = createRequire(import.meta.url)('original-fs');

const [action, bundleArg, appArg, homeArg, backupArg] = process.argv.slice(2);
if (!process.versions.electron) throw Error('Use the official Desktop runtime.');
const bundle = path.resolve(bundleArg), app = path.resolve(appArg), home = path.resolve(homeArg);
const profile = path.join(home, 'profiles/desktop');
const store = path.join(profile, '.desktop-distribution');
// Replaced by the bundle builder only after the selected release is frozen.
const manifestSha256 = '9eca18f33a51176f8a6c242f714a8d1ebe1c5921b7c3bbb5ea20e4b642105578';
const manifestBytes = fs.readFileSync(path.join(bundle, 'manifest.json'));
if (createHash('sha256').update(manifestBytes).digest('hex') !== manifestSha256) throw Error('Desktop release manifest checksum mismatch.');
const manifest = JSON.parse(manifestBytes);
const hash = file => createHash('sha256').update((file.endsWith('.asar') ? originalFs : fs).readFileSync(file)).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
};
// Refuse links before copying or replacing any managed path; never follow them.
function plain(file) {
  let cursor = path.resolve(file);
  for (;;) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw Error('Linked installation/profile path refused.');
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
function tree(file) {
  if (!fs.existsSync(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink()) return { link: fs.readlinkSync(file) };
  plain(file);
  if (fs.statSync(file).isFile()) return hash(file);
  return Object.fromEntries(fs.readdirSync(file).sort().map(name => [name, tree(path.join(file, name))]));
}
function copy(source, dest) {
  if (!fs.existsSync(source)) return;
  tree(source);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(source, dest, { recursive: true, dereference: false, errorOnExist: true, force: false });
}
function privateDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const identity = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
  const sid = /S-1-5-\d+(?:-\d+)+/.exec(identity.stdout)?.[0];
  if (!sid) throw Error('Cannot resolve current user for private backup.');
  const acl = spawnSync('icacls.exe', [dir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { encoding: 'utf8' });
  if (acl.status !== 0) throw Error('Cannot protect private backup.');
}
// Names, versions, retirement decisions and exact grants are pinned together.
// Do not infer new-runtime grants from a previous release's exceptions.
const expectedGrants = Object.keys(manifest.compatibility);
const retired = manifest.retiredPackages ?? [];
const managedNames = [...manifest.packages.map(p => p.name), ...retired];
for (const pkg of manifest.packages) {
  if (hash(path.join(bundle, pkg.file)) !== pkg.sha256) throw Error(`Package checksum mismatch: ${pkg.name}`);
}
if (hash(path.join(app, 'resources/app.asar')) !== manifest.official.windowsX64.appAsarSha256 || hash(path.join(app, 'DeepSeek Harness.exe')) !== manifest.official.windowsX64.exeSha256) throw Error(`Exact official ${manifest.runtimeVersion} program required.`);
plain(profile);
const official = await import(pathToFileURL(path.join(app, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')));
if (official.getDshRuntimeVersion() !== manifest.runtimeVersion) throw Error('Unexpected official runtime.');
for (const name of ['readProfileCompatibility', 'readProfileVersionExemptions', 'setProfileVersionExemption']) if (typeof official[name] !== 'function') throw Error(`Official compatibility API unavailable: ${name}`);
const managed = ['package.json', 'compatibility.json', ...managedNames.map(name => `node_modules/${name}`)];
for (const rel of managed) plain(path.dirname(path.join(profile, rel)));
const packageFile = path.join(profile, 'package.json');
const receiptFile = path.join(store, 'current.json');
const archiveDir = path.join(store, 'releases', manifest.releaseTag);
const desiredSpec = pkg => `file:.desktop-distribution/releases/${manifest.releaseTag}/${pkg.file}`;

function inspect() {
  const pkg = read(packageFile), exemptions = official.readProfileVersionExemptions(profile);
  const installed = manifest.packages.map(p => {
    const dir = path.join(profile, 'node_modules', p.name), meta = read(path.join(dir, 'package.json'));
    if (meta.name !== p.name || meta.version !== p.version || pkg.dependencies?.[p.name] !== desiredSpec(p) || !pkg.dsh?.profile?.bundles?.includes(p.name)) throw Error(`Package not installed: ${p.name}`);
    return { name: p.name, version: p.version };
  });
  for (const key of expectedGrants) if (!exemptions[key]?.includes(manifest.runtimeVersion)) throw Error('Missing exact official compatibility grant.');
  for (const name of retired) if (pkg.dependencies?.[name] || pkg.dsh?.profile?.bundles?.includes(name) || fs.existsSync(path.join(profile, 'node_modules', name))) throw Error(`Retired plugin still installed: ${name}`);
  const receipt = read(receiptFile);
  if (receipt.status !== 'INSTALLED' || receipt.releaseTag !== manifest.releaseTag) throw Error('Missing matching installation receipt.');
  for (const p of manifest.packages) if (!equal(tree(path.join(profile, 'node_modules', p.name)), receipt.installedTrees[p.name])) throw Error(`Installed package changed: ${p.name}`);
  return { status: 'VERIFIED', runtimeVersion: manifest.runtimeVersion, packages: installed, realProviderCalls: 0 };
}
function snapshot(kind) {
  privateDir(store);
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const dir = path.join(store, 'backups', id);
  privateDir(dir);
  const links = {};
  for (const rel of managed) {
    const source = path.join(profile, rel);
    if (fs.existsSync(source) && fs.lstatSync(source).isSymbolicLink()) links[rel] = fs.readlinkSync(source);
    else copy(source, path.join(dir, 'before', rel));
  }
  write(path.join(dir, 'before-links.json'), links);
  copy(receiptFile, path.join(dir, 'prior-receipt.json'));
  write(path.join(dir, 'operation.json'), { kind, id, profile, status: 'PREPARED' });
  return { id, dir };
}
// Restoration moves the latest managed state into the private operation backup.
// There are no recursive deletes; user data outside the managed paths is untouched.
function restoreExact(backup) {
  for (const rel of managed) {
    const current = path.join(profile, rel), before = path.join(backup.dir, 'before', rel);
    if (fs.existsSync(current)) {
      const moved = path.join(backup.dir, 'interrupted', rel);
      fs.mkdirSync(path.dirname(moved), { recursive: true });
      fs.renameSync(current, moved);
    }
    const links = read(path.join(backup.dir, 'before-links.json'));
    if (Object.hasOwn(links, rel)) {
      const original = path.join(backup.dir, 'replaced', rel.replace(/^node_modules\//, ''));
      if (fs.existsSync(original)) {
        fs.mkdirSync(path.dirname(current), { recursive: true });
        fs.renameSync(original, current);
      } else if (fs.existsSync(path.join(backup.dir, 'interrupted', rel))) {
        fs.renameSync(path.join(backup.dir, 'interrupted', rel), current);
      }
    } else copy(before, current);
  }
  if (fs.existsSync(receiptFile)) fs.renameSync(receiptFile, path.join(backup.dir, 'interrupted-receipt.json'));
  copy(path.join(backup.dir, 'prior-receipt.json'), receiptFile);
}
let lock;
if (action !== 'verify') {
  privateDir(store);
  lock = path.join(store, 'operation.lock');
  // mkdir is atomic across both PowerShell editions and all runtime processes.
  fs.mkdirSync(lock);
}
try {
  if (action === 'verify') console.log(JSON.stringify(inspect()));
  else if (action === 'install') {
    let alreadyInstalled = false;
    if (fs.existsSync(receiptFile)) {
      const current = read(receiptFile);
      if (current.releaseTag === manifest.releaseTag && current.status === 'INSTALLED') {
        console.log(JSON.stringify({ ...inspect(), status: 'ALREADY_INSTALLED', backupId: current.backupId }));
        process.exitCode = 0;
        alreadyInstalled = true;
      } else if ((manifest.releaseTag === 'desktop-v0.2.1-rc.5.1' ? ['desktop-v0.2.1-rc.3.1'] : ['desktop-v0.2.1-rc.3.1', 'desktop-v0.2.1-rc.5.1']).includes(current.releaseTag) && current.status === 'INSTALLED') {
        // Preserve the previous distribution receipt and managed bytes as part of
        // this installation's backup, so plugin rollback can restore the pair.
        const metadata = read(packageFile);
        for (const name of managedNames.filter(name => Object.hasOwn(current.installedTrees ?? {}, name))) {
          if (metadata.dependencies?.[name] !== current.after?.dependencies?.[name] || !equal(tree(path.join(profile, 'node_modules', name)), current.installedTrees[name]) || metadata.dsh?.profile?.bundles?.includes(name) !== current.after?.dsh?.profile?.bundles?.includes(name)) throw Error('Previous distribution changed; repair managed plugins before upgrading.');
        }
      } else throw Error('Unsupported existing distribution receipt.');
    }
    if (!alreadyInstalled) {
      // Parse before writes, so malformed user metadata cannot be overwritten.
      const before = fs.existsSync(packageFile) ? read(packageFile) : { name: 'dsh-profile-desktop', private: true, dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } };
      if (before.dependencies && (typeof before.dependencies !== 'object' || Array.isArray(before.dependencies))) throw Error('Invalid profile dependencies.');
      if (before.dsh?.profile?.bundles && !Array.isArray(before.dsh.profile.bundles)) throw Error('Invalid profile bundles.');
      for (const name of retired) {
        const present = Object.hasOwn(before.dependencies ?? {}, name) || before.dsh?.profile?.bundles?.includes(name) || fs.existsSync(path.join(profile, 'node_modules', name));
        if (present && (!fs.existsSync(receiptFile) || !Object.hasOwn(read(receiptFile).installedTrees ?? {}, name))) throw Error(`Retired plugin is not managed by the previous distribution: ${name}`);
      }
      const compatibility = official.readProfileCompatibility(profile);
      if (!compatibility.rewritable) throw Error('Repair the existing compatibility metadata before installing.');
      const backup = snapshot('install');
      try {
        // Prepare every package before replacing any active module directory.
        const stage = path.join(backup.dir, 'stage');
        const tar = path.join(process.env.SystemRoot, 'System32/tar.exe');
        for (const p of manifest.packages) {
          const archive = path.join(bundle, p.file);
          const listing = spawnSync(tar, ['-tf', path.toNamespacedPath(archive)], { encoding: 'utf8', windowsHide: true });
          if (listing.status !== 0 || listing.stdout.trim().split(/\r?\n/).some(n => !n.startsWith('package/') || n.split('/').includes('..') || n.includes('\\'))) throw Error('Unsafe package archive.');
          const dest = path.join(stage, p.name);
          fs.mkdirSync(dest, { recursive: true });
          // Keep members relative instead of tar's Unicode-sensitive -C.
          // A namespaced cwd can itself fail process creation near MAX_PATH.
          const extract = spawnSync(tar, ['-xf', path.toNamespacedPath(archive), '--strip-components', '1'], { cwd: dest, encoding: 'utf8', windowsHide: true });
          if (extract.status !== 0) throw Error(`Cannot extract ${p.name}`);
          const meta = read(path.join(dest, 'package.json'));
          if (meta.name !== p.name || meta.version !== p.version) throw Error('Archive identity mismatch.');
          tree(dest);
        }
        fs.mkdirSync(path.join(archiveDir, 'packages'), { recursive: true });
        for (const p of manifest.packages) {
          const archive = path.join(archiveDir, p.file);
          if (fs.existsSync(archive)) {
            if (hash(archive) !== p.sha256) throw Error('Stored archive differs from release.');
          } else fs.copyFileSync(path.join(bundle, p.file), archive);
          const dest = path.join(profile, 'node_modules', p.name);
          if (fs.existsSync(dest)) {
            const old = path.join(backup.dir, 'replaced', p.name);
            fs.mkdirSync(path.dirname(old), { recursive: true });
            fs.renameSync(dest, old);
          }
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.renameSync(path.join(stage, p.name), dest);
        }
        const after = structuredClone(before);
        after.dependencies ??= {};
        after.dsh ??= {}; after.dsh.profile ??= {};
        after.dsh.profile.bundles ??= ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
        for (const name of retired) {
          const dest = path.join(profile, 'node_modules', name);
          if (fs.existsSync(dest)) {
            const old = path.join(backup.dir, 'replaced', name);
            fs.mkdirSync(path.dirname(old), { recursive: true });
            fs.renameSync(dest, old);
          }
          delete after.dependencies[name];
          after.dsh.profile.bundles = after.dsh.profile.bundles.filter(n => n !== name);
        }
        for (const p of manifest.packages) after.dependencies[p.name] = desiredSpec(p);
        for (const name of manifest.bundles) if (!after.dsh.profile.bundles.includes(name)) after.dsh.profile.bundles.push(name);
        write(packageFile, after);
        // Same official locked, atomic API as the accepted Merge-Compatibility.mjs.
        const grants = [];
        for (const key of expectedGrants) {
          const version = manifest.runtimeVersion;
          if (!compatibility.exemptions[key]?.includes(version)) grants.push([key, version]);
          await official.setProfileVersionExemption(profile, key, version, true, true);
        }
        const installedTrees = Object.fromEntries(manifest.packages.map(p => [p.name, tree(path.join(profile, 'node_modules', p.name))]));
        const receipt = { status: 'INSTALLED', releaseTag: manifest.releaseTag, backupId: backup.id, before, after, grants, installedTrees };
        write(receiptFile, receipt);
        inspect();
        write(path.join(backup.dir, 'operation.json'), { kind: 'install', id: backup.id, status: 'INSTALLED' });
        console.log(JSON.stringify({ status: 'INSTALLED', backupId: backup.id, realProviderCalls: 0 }));
      } catch (error) {
        restoreExact(backup);
        write(path.join(backup.dir, 'operation.json'), { kind: 'install', id: backup.id, status: 'RESTORED_AFTER_FAILURE' });
        throw error;
      }
    }
  } else if (action === 'rollback') {
    if (!fs.existsSync(receiptFile)) {
      console.log(JSON.stringify({ status: 'ALREADY_ROLLED_BACK' }));
    } else {
      const receipt = read(receiptFile);
      if (receipt.releaseTag !== manifest.releaseTag || receipt.status !== 'INSTALLED') throw Error('Use the installer matching the current distribution receipt.');
      if (backupArg && backupArg !== receipt.backupId) throw Error('Backup ID is not the current installation.');
      if (!/^[a-zA-Z0-9-]+$/.test(receipt.backupId)) throw Error('Invalid backup ID.');
      const original = path.join(store, 'backups', receipt.backupId);
      const latest = snapshot('rollback');
      // Only undo fields this installer changed. Later user edits are retained;
      // conflicting edits to these very fields stop rollback after latest backup.
      const current = read(packageFile);
      for (const name of managedNames) {
        if (current.dependencies?.[name] !== receipt.after.dependencies[name] || !equal(tree(path.join(profile, 'node_modules', name)), receipt.installedTrees[name] ?? null) || current.dsh?.profile?.bundles?.includes(name) !== receipt.after.dsh.profile.bundles.includes(name)) throw Error('Managed plugin changed since installation; latest state saved, automatic rollback refused.');
        if (Object.hasOwn(receipt.before.dependencies ?? {}, name)) current.dependencies[name] = receipt.before.dependencies[name];
        else delete current.dependencies[name];
      }
      const added = manifest.bundles.filter(n => !receipt.before.dsh?.profile?.bundles?.includes(n));
      current.dsh.profile.bundles = current.dsh.profile.bundles.filter(n => !added.includes(n));
      const originalBundles = receipt.before.dsh?.profile?.bundles ?? [];
      for (const name of originalBundles.filter(n => retired.includes(n))) {
        if (current.dsh.profile.bundles.includes(name)) continue;
        const originalIndex = originalBundles.indexOf(name);
        const next = originalBundles.slice(originalIndex + 1).find(n => current.dsh.profile.bundles.includes(n));
        const previous = originalBundles.slice(0, originalIndex).reverse().find(n => current.dsh.profile.bundles.includes(n));
        const index = next ? current.dsh.profile.bundles.indexOf(next) : previous ? current.dsh.profile.bundles.indexOf(previous) + 1 : 0;
        current.dsh.profile.bundles.splice(index, 0, name);
      }
      try {
        for (const [key, version] of receipt.grants) await official.setProfileVersionExemption(profile, key, version, false, true);
        write(packageFile, current);
        for (const name of managedNames) {
          const dest = path.join(profile, 'node_modules', name), moved = path.join(latest.dir, 'removed', name);
          if (fs.existsSync(dest)) {
            fs.mkdirSync(path.dirname(moved), { recursive: true });
            fs.renameSync(dest, moved);
          }
          const links = read(path.join(original, 'before-links.json'));
          if (Object.hasOwn(links, `node_modules/${name}`)) {
            fs.renameSync(path.join(original, 'replaced', name), dest);
          } else copy(path.join(original, 'before/node_modules', name), dest);
        }
        fs.renameSync(receiptFile, path.join(latest.dir, 'rolled-back-receipt.json'));
        copy(path.join(original, 'prior-receipt.json'), receiptFile);
        write(path.join(latest.dir, 'operation.json'), { kind: 'rollback', id: latest.id, status: 'ROLLED_BACK', original: receipt.backupId });
        console.log(JSON.stringify({ status: 'ROLLED_BACK', backupId: latest.id, realProviderCalls: 0 }));
      } catch (error) { restoreExact(latest); throw error; }
    }
  } else throw Error('Unknown installer action.');
} finally {
  if (lock) {
    const retained = path.join(store, 'completed-locks');
    fs.mkdirSync(retained, { recursive: true });
    fs.renameSync(lock, path.join(retained, randomUUID()));
  }
}
