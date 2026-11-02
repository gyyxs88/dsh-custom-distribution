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
const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
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
const packageName = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/;
if (manifest.schemaVersion !== 1 || manifest.releaseTag !== 'desktop-v0.2.1-rc.5.1' || manifest.runtimeVersion !== '0.2.1-rc.5' || manifest.packages.length !== 6) throw Error('Unexpected Desktop release manifest.');
const expectedVersions = {
  '@omdsh-dev/dsh-genui': '0.9.1-dsh021.3',
  'dsh-desktop-compat': '0.2.1-rc.5.1',
  'dsh-remote-control': '0.3.3-dsh021.3',
  'dsh-session-control': '0.8.5-dsh021.2',
  'dsh-subagent-code-agents': '0.2.4-dsh021.1',
  'dsh-tps-correction': '0.2.1-rc.5.1',
};
const expectedGrants = ['@omdsh-dev/dsh-genui', 'dsh-remote-control', 'dsh-session-control', 'dsh-subagent-code-agents'].map(name => `${name}@${expectedVersions[name]}`);
// A manifest may retain the three previously verified rc.3 annotations. Only
// this installation's exact runtime is granted; existing old records stay intact.
if (!equal(Object.keys(manifest.compatibility).sort(), expectedGrants.sort()) || Object.entries(manifest.compatibility).some(([key, versions]) => !Array.isArray(versions) || !versions.includes(manifest.runtimeVersion) || new Set(versions).size !== versions.length || versions.some(v => v !== manifest.runtimeVersion && (v !== '0.2.1-rc.3' || key.startsWith('dsh-remote-control@'))))) throw Error('Unexpected exact compatibility grants.');
if (new Set(manifest.packages.map(p => p.name)).size !== 6 || !equal([...manifest.bundles].sort(), manifest.packages.map(p => p.name).sort())) throw Error('Invalid bundle set.');
for (const pkg of manifest.packages) {
  if (!Object.hasOwn(expectedVersions, pkg.name) || pkg.version !== expectedVersions[pkg.name] || !packageName.test(pkg.name) || pkg.name.split('/').some(p => p === '.' || p === '..') || !/^packages\/[a-z0-9.-]+\.tgz$/.test(pkg.file) || !/^[a-f0-9]{64}$/.test(pkg.sha256)) throw Error('Invalid package identity.');
  if (hash(path.join(bundle, pkg.file)) !== pkg.sha256) throw Error(`Package checksum mismatch: ${pkg.name}`);
}
if (manifest.official.windowsX64.appAsarSha256 !== 'e1b6f25fa937da98086c3e77af77aa14791105963c4d337a1c42179d232c6915' || manifest.official.windowsX64.exeSha256 !== '7ae939b5a82b220fbd8ad04dfbafaaedb5a49ab43dc884a5db6381f678dd0cc4' || hash(path.join(app, 'resources/app.asar')) !== manifest.official.windowsX64.appAsarSha256 || hash(path.join(app, 'DeepSeek Harness.exe')) !== manifest.official.windowsX64.exeSha256) throw Error('Exact official rc.5 program required.');
plain(profile);
const official = await import(pathToFileURL(path.join(app, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')));
if (official.getDshRuntimeVersion() !== manifest.runtimeVersion) throw Error('Unexpected official runtime.');
const managed = ['package.json', 'compatibility.json', ...manifest.packages.map(p => `node_modules/${p.name}`)];
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
      } else if (current.releaseTag === 'desktop-v0.2.1-rc.3.1' && current.status === 'INSTALLED') {
        // Preserve the previous distribution receipt and managed bytes as part of
        // this installation's backup, so plugin rollback can restore the pair.
        const metadata = read(packageFile);
        for (const p of manifest.packages) {
          if (metadata.dependencies?.[p.name] !== current.after?.dependencies?.[p.name] || !equal(tree(path.join(profile, 'node_modules', p.name)), current.installedTrees?.[p.name])) throw Error('Previous distribution changed; repair managed plugins before upgrading.');
        }
      } else throw Error('Unsupported existing distribution receipt.');
    }
    if (!alreadyInstalled) {
      // Parse before writes, so malformed user metadata cannot be overwritten.
      const before = fs.existsSync(packageFile) ? read(packageFile) : { name: 'dsh-profile-desktop', private: true, dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } };
      if (before.dependencies && (typeof before.dependencies !== 'object' || Array.isArray(before.dependencies))) throw Error('Invalid profile dependencies.');
      if (before.dsh?.profile?.bundles && !Array.isArray(before.dsh.profile.bundles)) throw Error('Invalid profile bundles.');
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
          // Windows tar's -C rejects long Unicode paths. CreateProcess accepts
          // an extended-length cwd, and archive members then stay relative.
          const extract = spawnSync(tar, ['-xf', path.toNamespacedPath(archive), '--strip-components', '1'], { cwd: path.toNamespacedPath(dest), encoding: 'utf8', windowsHide: true });
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
      for (const p of manifest.packages) {
        if (current.dependencies?.[p.name] !== receipt.after.dependencies[p.name] || !equal(tree(path.join(profile, 'node_modules', p.name)), receipt.installedTrees[p.name])) throw Error('Managed plugin changed since installation; latest state saved, automatic rollback refused.');
        if (Object.hasOwn(receipt.before.dependencies ?? {}, p.name)) current.dependencies[p.name] = receipt.before.dependencies[p.name];
        else delete current.dependencies[p.name];
      }
      const added = manifest.bundles.filter(n => !receipt.before.dsh?.profile?.bundles?.includes(n));
      current.dsh.profile.bundles = current.dsh.profile.bundles.filter(n => !added.includes(n));
      try {
        for (const [key, version] of receipt.grants) await official.setProfileVersionExemption(profile, key, version, false, true);
        write(packageFile, current);
        for (const p of manifest.packages) {
          const dest = path.join(profile, 'node_modules', p.name), moved = path.join(latest.dir, 'removed', p.name);
          fs.mkdirSync(path.dirname(moved), { recursive: true });
          fs.renameSync(dest, moved);
          const links = read(path.join(original, 'before-links.json'));
          if (Object.hasOwn(links, `node_modules/${p.name}`)) {
            fs.renameSync(path.join(original, 'replaced', p.name), dest);
          } else copy(path.join(original, 'before/node_modules', p.name), dest);
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
