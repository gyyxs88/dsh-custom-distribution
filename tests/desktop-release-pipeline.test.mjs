import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { legacyVersion, targetVersion, loadRelease, validateManifest, digest } from '../desktop/release-contract.mjs';
import { buildBundle } from '../scripts/Build-DesktopBundle.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const base = process.env.DSH_PUBLISH_TEST_ROOT;
const app = process.env.DSH_PUBLISH_TEST_APP;
const old = loadRelease();
const read = file => JSON.parse(fs.readFileSync(file));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
const tree = file => !fs.existsSync(file) ? null : fs.statSync(file).isDirectory() ? Object.fromEntries(fs.readdirSync(file).sort().map(n => [n, tree(path.join(file, n))])) : digest(fs.readFileSync(file));
const cleanEnv = extra => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(SystemRoot|WINDIR|COMSPEC|PATH|PATHEXT|TEMP|TMP|LOCALAPPDATA|APPDATA|USERPROFILE|HOMEDRIVE|HOMEPATH|USERNAME|USERDOMAIN|OS|PROCESSOR_ARCHITECTURE)$/i.test(k))), ...extra });
function run(file, args, env = cleanEnv()) {
  const result = spawnSync(file, args, { env, encoding: 'utf8', windowsHide: true, timeout: 90000 });
  assert.equal(result.status, 0, (result.error?.message ?? '') + result.stdout + result.stderr);
  return result;
}
function syntheticTarget() {
  const m = structuredClone(old.manifest);
  m.releaseTag = `desktop-v${targetVersion}`; m.runtimeVersion = '0.2.2-rc.1';
  m.official.windowsX64.url = 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.2-rc.1-win-x64.exe';
  m.official.windowsX64.size = 293425336;
  m.official.windowsX64.sha512Base64 = 'swcK0J6ofGkaAWLRpOes2ca7CWO8vuM5Vp0FRnQ/DG3q+Z+OhvsgLz3hIiSYpRUETY+fEz+Ww86fNa0jiVIifw==';
  m.packages = [structuredClone(m.packages.find(p => p.name === 'dsh-desktop-compat'))];
  m.bundles = m.packages.map(p => p.name);
  m.retiredPackages = old.manifest.packages.map(p => p.name).filter(n => !m.bundles.includes(n));
  m.compatibility = {};
  return m;
}

test('release selection preserves rc.5 and rejects an unfrozen target', () => {
  assert.equal(old.manifest.releaseTag, `desktop-v${legacyVersion}`);
  assert.throws(() => loadRelease('../elsewhere'), /Unsupported Desktop/);
  if (!fs.existsSync(path.join(repo, `desktop/releases/${targetVersion}/manifest.json`))) assert.throws(() => loadRelease(targetVersion), /Frozen release manifest is not available/);
});

test('target metadata permits retain/retire decisions and zero grants without carrying rc.5 exceptions', () => {
  const m = syntheticTarget();
  assert.equal(validateManifest(m, targetVersion), m);
  assert.deepEqual(m.compatibility, {});
  for (const mutate of [m => m.retiredPackages.pop(), m => m.compatibility['dsh-desktop-compat@0.0.0'] = ['*'], m => m.packages.push(m.packages[0]), m => m.official.windowsX64.size++, m => m.official.windowsX64.sha512Base64 = m.official.windowsX64.sha512Base64.toLowerCase()]) {
    const bad = structuredClone(m); mutate(bad); assert.throws(() => validateManifest(bad, targetVersion));
  }
});

test('old accepted bundle builds reproducibly and preserves nonempty output', { skip: !base }, () => {
  const first = path.join(base, 'legacy-assets'), second = path.join(base, 'legacy-rebuild');
  const a = buildBundle(first, old), b = buildBundle(second, old);
  assert.deepEqual(a.assets, b.assets);
  for (const file of ['dsh-desktop-v0.2.1-rc.5.1-win-x64.zip', 'Install-Desktop.ps1', 'SHA256SUMS.txt', 'publish-assets.json']) assert.deepEqual(fs.readFileSync(path.join(first, file)), fs.readFileSync(path.join(second, file)));
  assert.throws(() => buildBundle(first, old), /Output exists/);
  assert.equal(read(path.join(first, 'publish-assets.json')).makeLatest, false);
});

test('target official atomic compatibility API and Host path work without candidate plugins', { skip: !(base && app) }, () => {
  const output = path.join(base, 'official-api');
  run(path.join(app, 'DeepSeek Harness.exe'), [path.join(repo, 'tests/desktop-official-api.mjs'), app, output, '0.2.2-rc.1'], cleanEnv({ ELECTRON_RUN_AS_NODE: '1', DSH_HOME: path.join(output, 'home') }));
  assert.equal(read(path.join(output, 'api-results.json')).status, 'PASSED');
  const home = path.join(base, 'desktop-install-official-only/home');
  write(path.join(home, 'profiles/desktop/package.json'), JSON.stringify({ private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }));
  run(path.join(app, 'DeepSeek Harness.exe'), [path.join(repo, 'tests/desktop-install-host.mjs'), app, home, path.join(base, 'official-host.json'), 'official-only'], cleanEnv({ ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }));
  assert.equal(read(path.join(base, 'official-host.json')).status, 'PASSED');
});

test('synthetic target installs, retires managed rc.5 plugins and rolls back through both PowerShell editions', { skip: !(base && app) }, () => {
  // Fixtures are deliberately not candidate/final assets and are retained locally.
  const fixture = path.join(base, 'synthetic-release'), m = syntheticTarget();
  m.official.windowsX64.appAsarSha256 = digest(fs.readFileSync(path.join(app, 'resources/app.asar')));
  m.official.windowsX64.exeSha256 = digest(fs.readFileSync(path.join(app, 'DeepSeek Harness.exe')));
  const pkg = m.packages[0]; pkg.version = '0.0.0-synthetic'; pkg.file = 'packages/dsh-desktop-compat-0.0.0-synthetic.tgz';
  write(path.join(fixture, 'input/package/package.json'), JSON.stringify({ name: pkg.name, version: pkg.version }));
  write(path.join(fixture, 'input/package/fixture.txt'), 'synthetic installer test; never publish');
  fs.mkdirSync(path.join(fixture, 'packages'), { recursive: true });
  run('tar.exe', ['-czf', path.join(fixture, pkg.file), '-C', path.join(fixture, 'input'), 'package']);
  pkg.sha256 = digest(fs.readFileSync(path.join(fixture, pkg.file)));
  m.compatibility = { [`${pkg.name}@${pkg.version}`]: [m.runtimeVersion] };
  write(path.join(fixture, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  const pin = digest(fs.readFileSync(path.join(fixture, 'manifest.json')));
  const output = path.join(base, 'synthetic-assets');
  buildBundle(output, { directory: fixture, manifest: m, manifestSha256: pin });
  const bundle = path.join(output, 'bundle');
  const ps = fs.readFileSync(path.join(bundle, 'scripts/Install-Desktop.ps1'), 'utf8');
  assert.ok(ps.startsWith('\uFEFF')); assert.ok(ps.includes(`$runtimeVersion = '${m.runtimeVersion}'`));
  assert.ok(!ps.includes('0.2.1-rc.5'));
  for (const shell of ['powershell.exe', 'pwsh.exe']) for (const prior of [false, true]) {
    const home = path.join(base, `desktop-install-synthetic-${shell}-${prior}/home`), profile = path.join(home, 'profiles/desktop');
    const store = path.join(profile, '.desktop-distribution');
    let receipt, original;
    const metadata = { private: true, dependencies: { 'synthetic-user': 'file:./user' }, dsh: { profile: { bundles: ['synthetic-user'] } } };
    if (prior) {
      for (const p of old.manifest.packages) {
        write(path.join(profile, 'node_modules', p.name, 'package.json'), JSON.stringify({ name: p.name, version: p.version }));
        metadata.dependencies[p.name] = `file:.desktop-distribution/releases/${old.manifest.releaseTag}/${p.file}`;
        metadata.dsh.profile.bundles.push(p.name);
      }
      receipt = { status: 'INSTALLED', releaseTag: old.manifest.releaseTag, backupId: 'synthetic-old-backup', after: structuredClone(metadata), installedTrees: Object.fromEntries(old.manifest.packages.map(p => [p.name, tree(path.join(profile, 'node_modules', p.name))])) };
      write(path.join(store, 'current.json'), JSON.stringify(receipt));
      original = tree(path.join(profile, 'node_modules'));
    }
    write(path.join(profile, 'package.json'), JSON.stringify(metadata));
    write(path.join(profile, 'compatibility.json'), JSON.stringify({ 'synthetic-user@1.0.0': ['0.2.1-rc.5'] }));
    const invoke = action => run(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(bundle, 'scripts/Install-Desktop.ps1'), '-DesktopPath', app, '-DshHome', home, '-Action', action]);
    assert.match(invoke('Install').stdout, /"status":"INSTALLED"/);
    assert.match(invoke('Verify').stdout, /"status":"VERIFIED"/);
    assert.match(invoke('Install').stdout, /ALREADY_INSTALLED/);
    for (const n of m.retiredPackages) assert.ok(!fs.existsSync(path.join(profile, 'node_modules', n)));
    const later = read(path.join(profile, 'package.json')); later.laterUserSetting = 'retain'; write(path.join(profile, 'package.json'), JSON.stringify(later));
    invoke('Rollback');
    const rolled = read(path.join(profile, 'package.json'));
    assert.deepEqual(rolled.dependencies, metadata.dependencies);
    assert.deepEqual(rolled.dsh.profile.bundles, metadata.dsh.profile.bundles);
    assert.equal(rolled.laterUserSetting, 'retain');
    assert.deepEqual(read(path.join(profile, 'compatibility.json')), { 'synthetic-user@1.0.0': ['0.2.1-rc.5'] });
    if (prior) { assert.deepEqual(read(path.join(store, 'current.json')), receipt); assert.deepEqual(tree(path.join(profile, 'node_modules')), original); }
  }
  write(path.join(base, 'synthetic-consumer-results.json'), JSON.stringify({ status: 'PASSED', syntheticAssetsOnly: true, runtimeVersion: m.runtimeVersion, shells: ['5.1', '7'], cleanAndManagedRc5Upgrade: true, retainedPackages: m.packages.length, retiredPackages: m.retiredPackages.length, installVerifyRepeatRollback: true, priorReceiptAndBytesRestored: true, originalBundleOrderRestored: true, laterUserSettingPreserved: true, realProviderCalls: 0, sshCalls: 0, externalCodingCalls: 0 }, null, 2) + '\n');
});

test('retirement refuses unmanaged or changed plugins and preserves rollback conflicts', { skip: !(base && app) }, () => {
  const bundle = path.join(base, 'synthetic-assets/bundle'), m = read(path.join(bundle, 'manifest.json'));
  const retiredName = m.retiredPackages[0];
  const invoke = (home, action, expected, pattern) => {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(bundle, 'scripts/Install-Desktop.ps1'), '-DesktopPath', app, '-DshHome', home, '-Action', action], { env: cleanEnv(), encoding: 'utf8', windowsHide: true, timeout: 90000 });
    assert.equal(result.status, expected, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, pattern);
    return result;
  };
  for (const changed of [false, true]) {
    const home = path.join(base, `retirement-refusal-${changed}/home`), profile = path.join(home, 'profiles/desktop');
    const metadata = { private: true, dependencies: { [retiredName]: 'file:./original' }, dsh: { profile: { bundles: [retiredName] } } };
    const module = path.join(profile, 'node_modules', retiredName);
    write(path.join(module, 'package.json'), JSON.stringify({ name: retiredName, version: '1.0.0-synthetic' }));
    write(path.join(profile, 'package.json'), JSON.stringify(metadata));
    if (changed) {
      write(path.join(profile, '.desktop-distribution/current.json'), JSON.stringify({ status: 'INSTALLED', releaseTag: old.manifest.releaseTag, after: metadata, installedTrees: { [retiredName]: tree(module) } }));
      write(path.join(module, 'later-change.txt'), 'retain this user edit');
    }
    const before = tree(profile), beforeModule = tree(module);
    invoke(home, 'Install', 1, changed ? /Previous distribution changed/ : /not managed by the previous distribution/);
    assert.deepEqual(tree(module), beforeModule);
    assert.equal(digest(fs.readFileSync(path.join(profile, 'package.json'))), before['package.json']);
    assert.ok(!fs.existsSync(path.join(profile, '.desktop-distribution/operation.lock')));
    if (changed) assert.equal(fs.readFileSync(path.join(module, 'later-change.txt'), 'utf8'), 'retain this user edit');
  }
  const home = path.join(base, 'retirement-rollback-conflict/home');
  invoke(home, 'Install', 0, /"status":"INSTALLED"/);
  const marker = path.join(home, 'profiles/desktop/node_modules', retiredName, 'user-added.txt');
  write(marker, 'retain after refused rollback');
  invoke(home, 'Rollback', 1, /latest state saved/);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'retain after refused rollback');
  assert.equal(read(path.join(home, 'profiles/desktop/.desktop-distribution/current.json')).releaseTag, m.releaseTag);
  write(path.join(base, 'retirement-guards.json'), JSON.stringify({ status: 'PASSED', unmanagedRetirementRefused: true, changedPriorModuleRefused: true, rollbackConflictRetained: true, realProviderCalls: 0 }, null, 2) + '\n');
});
