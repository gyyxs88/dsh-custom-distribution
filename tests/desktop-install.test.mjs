import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const repo = fileURLToPath(new URL('../', import.meta.url));
const app = process.env.DSH_INSTALL_TEST_APP;
const bundle = process.env.DSH_INSTALL_TEST_BUNDLE;
const base = process.env.DSH_INSTALL_TEST_ROOT;
const enabled = !!(app && bundle && base);
const runtimeVersion = '0.2.1-rc.5';
const releaseTag = 'desktop-v0.2.1-rc.5.1';
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function cleanEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|COMSPEC|PATH|PATHEXT|TEMP|TMP|LOCALAPPDATA|APPDATA|USERPROFILE|HOMEDRIVE|HOMEPATH|USERNAME|USERDOMAIN|OS|PROCESSOR_ARCHITECTURE)$/i.test(key)));
  return { ...env, ...extra };
}

test('Built standalone bootstrap downloads a pinned ZIP as a standard user', { skip: !enabled }, async () => {
  const root = path.join(base, 'desktop-install-bootstrap-' + Date.now() + '-下载 空格 中文');
  fs.mkdirSync(root, { recursive: true });
  const zip = path.join(path.dirname(bundle), 'dsh-desktop-v0.2.1-rc.5.1-win-x64.zip');
  const bytes = fs.readFileSync(zip);
  let downloads = 0;
  let corruptDownload = false;
  const server = createServer((request, response) => {
    assert.equal(request.url, '/dsh-desktop-v0.2.1-rc.5.1-win-x64.zip');
    downloads++;
    response.writeHead(200, { 'content-length': bytes.length, 'content-type': 'application/zip' });
    const downloaded = Buffer.from(bytes);
    if (corruptDownload) downloaded[0] ^= 1;
    response.end(downloaded);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    // Only the URL is redirected in this private test copy. The built digest
    // and positive-test ZIP bytes are unchanged; GitHub remains a release gate.
    let bootstrap = fs.readFileSync(path.join(path.dirname(bundle), 'Install-Desktop.ps1'), 'utf8');
    assert.ok(!bootstrap.includes('__DESKTOP_BUNDLE_SHA256__'));
    bootstrap = bootstrap.replace('$releaseBase = "https://github.com/gyyxs88/dsh-custom-distribution/releases/download/$releaseTag"', `$releaseBase = "http://127.0.0.1:${port}"`);
    const script = path.join(root, 'Install-Desktop.ps1');
    write(script, bootstrap);
    for (const shell of ['powershell.exe', 'pwsh.exe']) for (const bad of [false, true]) {
      corruptDownload = bad;
      const home = path.join(root, `${shell}-${bad ? 'bad-digest' : '全新 home'}`);
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-DesktopPath', app, '-DshHome', home];
      let output = '';
      const child = spawn(shell, args, { cwd: root, env: cleanEnv({ LOCALAPPDATA: path.join(root, 'LocalAppData') }), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      child.stdout.on('data', b => output += b);
      child.stderr.on('data', b => output += b);
      const code = await new Promise(resolve => child.once('exit', resolve));
      write(path.join(root, `${shell}-${bad}.log`), output);
      assert.equal(code, bad ? 1 : 0, output);
      assert.match(output, bad ? /bundle checksum mismatch/ : /"status":"INSTALLED"/);
      if (bad) assert.ok(!fs.existsSync(path.join(home, 'profiles/desktop/package.json')));
    }
    assert.equal(downloads, 4);
    const result = { status: 'PASSED', source: 'built standalone bootstrap; only release URL redirected to loopback', shells: ['5.1', '7'], downloads, corruptedZipRejectedBeforeProfileWrite: true, zipSha256: digest(zip), realProviderCalls: 0, githubDownloadNotYetTested: true };
    write(path.join(base, 'bootstrap-download.json'), JSON.stringify(result, null, 2));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Installer guards and caller environment restoration', { skip: !enabled }, () => {
  const root = path.join(base, 'desktop-install-guards-' + Date.now() + '-合成 升级');
  const home = path.join(root, 'home'), profile = path.join(home, 'profiles/desktop');
  fs.mkdirSync(profile, { recursive: true });
  const installer = path.join(bundle, 'scripts/Install-Desktop.ps1');
  const invoke = (shell, action, expected = 0) => run(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer, '-Action', action, '-DesktopPath', app, '-DshHome', home], cleanEnv(), expected);
  invoke('powershell.exe', 'Install');
  for (const shell of ['powershell.exe', 'pwsh.exe']) {
    const quote = value => "'" + value.replaceAll("'", "''") + "'";
    const command = `$env:DSH_HOME='CALLER_SENTINEL'; [Environment]::SetEnvironmentVariable('NODE_OPTIONS',[NullString]::Value,'Process'); [Environment]::SetEnvironmentVariable('NODE_PATH',[NullString]::Value,'Process'); [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE',[NullString]::Value,'Process'); & ${quote(installer)} -Action Verify -DesktopPath ${quote(app)} -DshHome ${quote(home)}; if($env:DSH_HOME -ne 'CALLER_SENTINEL' -or (Test-Path Env:NODE_OPTIONS) -or (Test-Path Env:NODE_PATH) -or (Test-Path Env:ELECTRON_RUN_AS_NODE)) {throw 'Environment changed'}; Write-Output 'ENV_RESTORED'`;
    assert.match(run(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]).stdout, /ENV_RESTORED/);
  }
  const marker = path.join(profile, 'node_modules/dsh-desktop-compat/installer-test-edit.txt');
  write(marker, 'synthetic later user change');
  const conflict = invoke('powershell.exe', 'Rollback', 1);
  assert.match(conflict.stdout + conflict.stderr, /latest state saved/);
  assert.ok(fs.existsSync(marker));
  const backupRoot = path.join(profile, '.desktop-distribution/backups');
  const backups = fs.readdirSync(backupRoot);
  assert.ok(backups.length >= 2);
  assert.ok(backups.some(id => fs.existsSync(path.join(backupRoot, id, 'before/node_modules/dsh-desktop-compat/installer-test-edit.txt'))));
  assert.ok(!fs.existsSync(path.join(profile, '.desktop-distribution/operation.lock')));
  // Corrupt metadata cannot be replaced. These are synthetic files only.
  const invalid = path.join(root, 'invalid-home'), invalidProfile = path.join(invalid, 'profiles/desktop');
  write(path.join(invalidProfile, 'package.json'), '{"private":true,"dependencies":{}}');
  write(path.join(invalidProfile, 'compatibility.json'), '{BROKEN_SYNTHETIC');
  const oldHash = digest(path.join(invalidProfile, 'compatibility.json'));
  run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer, '-DesktopPath', app, '-DshHome', invalid], cleanEnv(), 1);
  assert.equal(digest(path.join(invalidProfile, 'compatibility.json')), oldHash);
  assert.ok(!fs.existsSync(path.join(invalidProfile, 'node_modules')));
  write(path.join(base, 'guard-results.json'), JSON.stringify({ status: 'PASSED', environmentsRestored: ['5.1', '7'], changedPluginRollbackRefused: true, latestStateBackedUp: true, malformedCompatibilityPreserved: true, realProviderCalls: 0 }, null, 2));
});
function run(file, args, env = cleanEnv(), expected = 0) {
  const result = spawnSync(file, args, { cwd: repo, env, encoding: 'utf8', timeout: 90000 });
  if (enabled) {
    const id = String(++run.sequence).padStart(3, '0');
    write(path.join(base, 'commands', `${id}.json`), JSON.stringify({ file, args, expected, status: result.status, error: result.error?.message }, null, 2));
    write(path.join(base, 'commands', `${id}.stdout.log`), result.stdout ?? '');
    write(path.join(base, 'commands', `${id}.stderr.log`), result.stderr ?? '');
  }
  if (result.error) throw result.error;
  assert.equal(result.status, expected, `${file}: ${result.stdout}\n${result.stderr}`);
  return result;
}
run.sequence = 0;
test('Pinned rc.5 metadata, four exact grants and failed-install restoration', { skip: !enabled }, () => {
  const root = path.join(base, 'desktop-install-rejection-' + Date.now());
  for (const mode of ['runtime', 'official-size', 'official-digest-case', 'missing-remote', 'wildcard-grant', 'archive-checksum', 'archive-identity']) {
    const fixture = path.join(root, mode), altered = path.join(fixture, 'bundle');
    fs.cpSync(bundle, altered, { recursive: true });
    const manifestFile = path.join(altered, 'manifest.json'), manifest = json(manifestFile);
    const home = path.join(fixture, 'home'), profile = path.join(home, 'profiles/desktop');
    const meta = '{"name":"synthetic-existing","private":true,"dependencies":{"user-plugin":"file:./user"},"dsh":{"profile":{"bundles":["user-plugin"]}},"keep":true}\n';
    const grants = '{"user-plugin@1.0.0":["0.2.1-rc.3"]}\n';
    write(path.join(profile, 'package.json'), meta);
    write(path.join(profile, 'compatibility.json'), grants);
    if (mode === 'runtime') manifest.runtimeVersion = '0.2.1-rc.3';
    if (mode === 'official-size') manifest.official.windowsX64.size++;
    if (mode === 'official-digest-case') manifest.official.windowsX64.sha512Base64 = manifest.official.windowsX64.sha512Base64.toLowerCase();
    if (mode === 'missing-remote') delete manifest.compatibility['dsh-remote-control@0.3.3-dsh021.3'];
    if (mode === 'wildcard-grant') manifest.compatibility['dsh-remote-control@0.3.3-dsh021.3'] = ['*'];
    if (mode === 'archive-checksum') fs.appendFileSync(path.join(altered, manifest.packages[0].file), 'synthetic corruption');
    if (mode === 'archive-identity') {
      const pkg = manifest.packages.find(p => p.name === 'dsh-desktop-compat');
      write(path.join(fixture, 'input/package/package.json'), '{"name":"dsh-desktop-compat","version":"0.0.0"}');
      const tar = spawnSync('tar.exe', ['-czf', path.join(altered, pkg.file), '-C', path.join(fixture, 'input'), 'package'], { encoding: 'utf8' });
      assert.equal(tar.status, 0, tar.stderr);
      pkg.sha256 = digest(path.join(altered, pkg.file));
    }
    write(manifestFile, JSON.stringify(manifest));
    const failure = run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(altered, 'scripts/Install-Desktop.ps1'), '-BundlePath', altered, '-DesktopPath', app, '-DshHome', home], cleanEnv(), 1);
    const expected = { runtime: /Unexpected Desktop release manifest/, 'official-size': /Unexpected official rc.5/, 'official-digest-case': /Unexpected official rc.5/, 'missing-remote': /Unexpected exact compatibility/, 'wildcard-grant': /Unexpected exact compatibility/, 'archive-checksum': /Package checksum mismatch/, 'archive-identity': /Archive identity mismatch/ }[mode];
    assert.match(failure.stdout + failure.stderr, expected);
    assert.equal(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'), meta);
    assert.equal(fs.readFileSync(path.join(profile, 'compatibility.json'), 'utf8'), grants);
    assert.ok(!fs.existsSync(path.join(profile, 'node_modules/dsh-desktop-compat')));
    assert.ok(!fs.existsSync(path.join(profile, '.desktop-distribution/operation.lock')));
    if (mode === 'archive-identity') {
      const backups = path.join(profile, '.desktop-distribution/backups');
      assert.ok(fs.readdirSync(backups).some(id => json(path.join(backups, id, 'operation.json')).status === 'RESTORED_AFTER_FAILURE'));
    }
  }
  write(path.join(base, 'rejection-results.json'), JSON.stringify({ status: 'PASSED', exactRuntime: true, pinnedOfficialMetadata: true, caseSensitiveSha512: true, fourExactGrants: true, packageChecksum: true, restoredAfterStagingFailure: true, realProviderCalls: 0 }, null, 2));
});

test('Existing rc.3.1 distribution upgrades and restores old bytes and receipt', { skip: !enabled }, () => {
  const oldRelease = path.join(repo, 'desktop/releases/0.2.1-rc.3.1');
  const old = json(path.join(oldRelease, 'manifest.json'));
  const tree = file => fs.statSync(file).isDirectory() ? Object.fromEntries(fs.readdirSync(file).sort().map(name => [name, tree(path.join(file, name))])) : digest(file);
  for (const shell of ['powershell.exe', 'pwsh.exe']) {
    const root = path.join(base, 'desktop-install-prior-' + shell + '-' + Date.now());
    const home = path.join(root, '旧发行 用户'), profile = path.join(home, 'profiles/desktop');
    const store = path.join(profile, '.desktop-distribution');
    const before = { name: 'synthetic-prior-installation', private: true, dependencies: { 'user-plugin': 'file:./user' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'user-plugin'] } }, userSetting: 'keep' };
    const after = structuredClone(before);
    for (const p of old.packages) {
      const archive = path.join(store, 'releases', old.releaseTag, p.file);
      fs.mkdirSync(path.dirname(archive), { recursive: true });
      fs.copyFileSync(path.join(oldRelease, p.file), archive);
      const dest = path.join(profile, 'node_modules', p.name);
      fs.mkdirSync(dest, { recursive: true });
      const extracted = spawnSync('tar.exe', ['-xf', archive, '-C', dest, '--strip-components', '1'], { encoding: 'utf8' });
      assert.equal(extracted.status, 0, extracted.stderr);
      after.dependencies[p.name] = `file:.desktop-distribution/releases/${old.releaseTag}/${p.file}`;
      after.dsh.profile.bundles.push(p.name);
    }
    const oldReceipt = { status: 'INSTALLED', releaseTag: old.releaseTag, backupId: 'synthetic-prior-backup', before, after, grants: [], installedTrees: Object.fromEntries(old.packages.map(p => [p.name, tree(path.join(profile, 'node_modules', p.name))])) };
    write(path.join(profile, 'package.json'), JSON.stringify(after));
    write(path.join(profile, 'compatibility.json'), JSON.stringify(old.compatibility));
    write(path.join(store, 'current.json'), JSON.stringify(oldReceipt));
    const invoke = (action, expected = 0) => run(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(bundle, 'scripts/Install-Desktop.ps1'), '-Action', action, '-DesktopPath', app, '-DshHome', home], cleanEnv(), expected);
    // Changed old managed modules cannot silently be replaced during upgrade.
    const marker = path.join(profile, 'node_modules/dsh-desktop-compat/synthetic-change.txt');
    write(marker, 'changed after old install');
    const changed = invoke('Install', 1);
    assert.match(changed.stdout + changed.stderr, /Previous distribution changed/);
    fs.renameSync(marker, path.join(root, 'retained-change.txt'));
    assert.match(invoke('Install').stdout, /"status":"INSTALLED"/);
    assert.equal(json(path.join(store, 'current.json')).releaseTag, releaseTag);
    invoke('Verify');
    assert.match(invoke('Install').stdout, /ALREADY_INSTALLED/);
    const metadata = json(path.join(profile, 'package.json'));
    metadata.later = 'retain this setting';
    write(path.join(profile, 'package.json'), JSON.stringify(metadata));
    invoke('Rollback');
    assert.deepEqual(json(path.join(store, 'current.json')), oldReceipt);
    assert.equal(json(path.join(profile, 'package.json')).later, 'retain this setting');
    for (const p of old.packages) {
      assert.deepEqual(tree(path.join(profile, 'node_modules', p.name)), oldReceipt.installedTrees[p.name]);
      assert.equal(json(path.join(profile, 'package.json')).dependencies[p.name], after.dependencies[p.name]);
    }
    for (const [key, versions] of Object.entries(old.compatibility)) assert.deepEqual(json(path.join(profile, 'compatibility.json'))[key], versions);
    const repeated = invoke('Rollback', 1);
    assert.match(repeated.stdout + repeated.stderr, /installer matching the current distribution/);
  }
  write(path.join(base, 'prior-distribution-results.json'), JSON.stringify({ status: 'PASSED', shells: ['5.1', '7'], oldSixPackageBytesRestored: true, oldReceiptRestored: true, changedOldPluginRefused: true, unrelatedLaterSettingsPreserved: true, officialProgramDowngradeNotPerformed: true }, null, 2));
});
const evidence = [];
for (const shell of ['powershell.exe', 'pwsh.exe']) {
  test(`Desktop install / verify / repeat / rollback on ${shell}`, { skip: !enabled }, () => {
    const root = path.join(base, `desktop-install-${shell}-` + Date.now() + '-空格 中文');
    fs.mkdirSync(root, { recursive: true });
    // Run downloaded/built contents under a fresh path with Unicode and spaces.
    const consume = path.join(root, '解压 发行包');
    run(shell, ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${path.join(path.dirname(bundle), 'dsh-desktop-v0.2.1-rc.5.1-win-x64.zip').replaceAll("'", "''")}' -DestinationPath '${consume.replaceAll("'", "''")}'`]);
    const installer = path.join(consume, 'scripts/Install-Desktop.ps1');
    const invoke = (home, action, expected = 0, extra = []) => run(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer, '-Action', action, '-DesktopPath', app, '-DshHome', home, ...extra], cleanEnv(), expected);
    const identity = run(shell, ['-NoProfile', '-Command', '[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)']);
    assert.equal(identity.stdout.trim(), 'False', 'Consumer test must run without administrator token');
    for (const kind of ['empty', 'upgrade-pnpm-link']) {
      const home = path.join(root, `${kind} 用户`), profile = path.join(home, 'profiles/desktop');
      let custom, link, target;
      const preserved = [];
      if (kind !== 'empty') {
        custom = { name: 'synthetic', private: true, dependencies: { 'user-plugin': 'file:./custom', 'dsh-session-control': 'file:./old-session' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'user-plugin', 'dsh-session-control'], custom: 'keep' } }, userField: { keep: true } };
        write(path.join(profile, 'package.json'), JSON.stringify(custom));
        for (const [relative, text] of [
          ['cordis.yml', '[]\n# synthetic custom root\n'],
          ['cordis.patch.yml', '- id: llm-pi-ai\n  config:\n    providers:\n      offline-fixture:\n        api: openai-completions\n        baseURL: http://127.0.0.1:1/v1\n        apiKeyEnv: UNUSED_FIXTURE_KEY\n        models:\n          - id: fixture-model\n            input: [text]\n- id: agent-default-model\n  config:\n    provider: offline-fixture\n    model: fixture-model\n'],
          ['compatibility.json', JSON.stringify({ 'user-plugin@1.0.0': ['0.2.1-rc.2'], 'dsh-session-control@0.8.5-dsh021.2': ['0.2.1-rc.2', '0.2.1-rc.3'], 'dsh-remote-control@0.3.3-dsh021.3': ['0.2.1-rc.3'] })],
        ]) write(path.join(profile, relative), text);
        for (const [relative, text] of [['sessions/synthetic.jsonl', '{"synthetic":true}\n'], ['pending/synthetic.json', '{"synthetic":true}\n'], ['.credentials.yaml', 'fixture: NOT_A_REAL_CREDENTIAL\n']]) write(path.join(home, relative), text);
        target = path.join(profile, 'node_modules/.pnpm/synthetic-session/node_modules/dsh-session-control');
        write(path.join(target, 'package.json'), '{"name":"dsh-session-control","version":"0.0.0"}');
        write(path.join(target, 'marker.txt'), 'original pnpm target: must stay unchanged');
        link = path.join(profile, 'node_modules/dsh-session-control');
        fs.symlinkSync(target, link, 'junction');
        for (const file of [path.join(profile, 'cordis.yml'), path.join(profile, 'cordis.patch.yml'), path.join(home, '.credentials.yaml'), path.join(home, 'sessions/synthetic.jsonl'), path.join(home, 'pending/synthetic.json'), path.join(target, 'marker.txt')]) preserved.push([file, digest(file)]);
      }
      const installed = invoke(home, 'Install');
      assert.match(installed.stdout, /"status":"INSTALLED"/);
      assert.ok(!fs.existsSync(path.join(profile, '.desktop-distribution/operation.lock')));
      for (const [file, hash] of preserved) assert.equal(digest(file), hash);
      const granted = json(path.join(profile, 'compatibility.json'));
      for (const key of Object.keys(json(path.join(bundle, 'manifest.json')).compatibility)) assert.ok(granted[key]?.includes(runtimeVersion));
      if (!custom) for (const versions of Object.values(granted)) assert.deepEqual(versions, [runtimeVersion]);
      if (custom) {
        assert.deepEqual(granted['dsh-session-control@0.8.5-dsh021.2'], ['0.2.1-rc.2', '0.2.1-rc.3', runtimeVersion]);
        assert.deepEqual(granted['dsh-remote-control@0.3.3-dsh021.3'], ['0.2.1-rc.3', runtimeVersion]);
      }
      const repeat = invoke(home, 'Install');
      assert.match(repeat.stdout, /ALREADY_INSTALLED/);
      invoke(home, 'Verify');
      // Only the brand-new home runs the real official Host, with no old modules to mask gaps.
      if (kind === 'empty') {
        assert.ok(!fs.existsSync(path.join(home, '.credentials.yaml')));
        const hostEvidence = path.join(root, 'empty-official-host.json');
        const host = run(path.join(app, 'DeepSeek Harness.exe'), [path.join(repo, 'tests/desktop-install-host.mjs'), app, home, hostEvidence], cleanEnv({ ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }));
        write(path.join(root, 'empty-host.log'), host.stdout + host.stderr);
        assert.equal(json(hostEvidence).status, 'PASSED');
      }
      const packageFile = path.join(profile, 'package.json');
      const later = json(packageFile);
      later.laterUserSetting = 'keep after rollback';
      later.dependencies['later-plugin'] = 'file:./later';
      later.dsh.profile.bundles.push('later-plugin');
      write(packageFile, JSON.stringify(later));
      // New unrelated compatibility record must survive rollback as well.
      const comp = json(path.join(profile, 'compatibility.json'));
      comp['later-plugin@1.0.0'] = ['0.2.1-rc.5'];
      write(path.join(profile, 'compatibility.json'), JSON.stringify(comp));
      invoke(home, 'Rollback');
      const rolled = json(packageFile);
      assert.equal(rolled.laterUserSetting, 'keep after rollback');
      assert.equal(rolled.dependencies['later-plugin'], 'file:./later');
      assert.ok(rolled.dsh.profile.bundles.includes('later-plugin'));
      if (custom) {
        for (const [name, value] of Object.entries(custom.dependencies)) assert.equal(rolled.dependencies[name], value);
        assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
        assert.equal(fs.realpathSync(link), fs.realpathSync(target));
        for (const [file, hash] of preserved) assert.equal(digest(file), hash);
      }
      const rolledComp = json(path.join(profile, 'compatibility.json'));
      assert.deepEqual(rolledComp['later-plugin@1.0.0'], ['0.2.1-rc.5']);
      if (custom) {
        assert.deepEqual(rolledComp['dsh-session-control@0.8.5-dsh021.2'], ['0.2.1-rc.2', '0.2.1-rc.3']);
        assert.deepEqual(rolledComp['dsh-remote-control@0.3.3-dsh021.3'], ['0.2.1-rc.3']);
      }
      assert.match(invoke(home, 'Rollback').stdout, /ALREADY_ROLLED_BACK/);
      evidence.push({ shell, kind, root, nonAdmin: true, installed: true, idempotent: true, rollbackPreservedLaterEdits: true, pnpmLinkPreserved: !!link, realProviderCalls: 0 });
      write(path.join(base, 'consumer-results.json'), JSON.stringify(evidence, null, 2));
    }
  });
}
