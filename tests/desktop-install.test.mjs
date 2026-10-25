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
  const zip = path.join(path.dirname(bundle), 'dsh-desktop-v0.2.1-rc.3.1-win-x64.zip');
  const bytes = fs.readFileSync(zip);
  let downloads = 0;
  const server = createServer((request, response) => {
    assert.equal(request.url, '/dsh-desktop-v0.2.1-rc.3.1-win-x64.zip');
    downloads++;
    response.writeHead(200, { 'content-length': bytes.length, 'content-type': 'application/zip' });
    response.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    // Only the URL is redirected in this test copy, because publication is not
    // authorized yet. The built digest and downloaded ZIP bytes are unchanged.
    let bootstrap = fs.readFileSync(path.join(path.dirname(bundle), 'Install-Desktop.ps1'), 'utf8');
    assert.ok(!bootstrap.includes('__DESKTOP_BUNDLE_SHA256__'));
    bootstrap = bootstrap.replace('$releaseBase = "https://github.com/gyyxs88/dsh-custom-distribution/releases/download/$releaseTag"', `$releaseBase = "http://127.0.0.1:${port}"`);
    const script = path.join(root, 'Install-Desktop.ps1');
    write(script, bootstrap);
    const home = path.join(root, '全新 home');
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-DesktopPath', app, '-DshHome', home];
    let output = '';
    const child = spawn('powershell.exe', args, { cwd: root, env: cleanEnv({ LOCALAPPDATA: path.join(root, 'LocalAppData') }), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', b => output += b);
    child.stderr.on('data', b => output += b);
    const code = await new Promise(resolve => child.once('exit', resolve));
    assert.equal(code, 0, output);
    assert.equal(downloads, 1);
    assert.match(output, /"status":"INSTALLED"/);
    const result = { status: 'PASSED', source: 'built standalone bootstrap; only release URL redirected to loopback', downloads, zipSha256: digest(zip), nonAdmin: true, home, realProviderCalls: 0, githubDownloadNotYetTested: true };
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
  if (result.error) throw result.error;
  assert.equal(result.status, expected, `${file}: ${result.stdout}\n${result.stderr}`);
  return result;
}
const evidence = [];
for (const shell of ['powershell.exe', 'pwsh.exe']) {
  test(`Desktop install / verify / repeat / rollback on ${shell}`, { skip: !enabled }, () => {
    const root = path.join(base, `desktop-install-${shell}-` + Date.now() + '-空格 中文');
    fs.mkdirSync(root, { recursive: true });
    // Run downloaded/built contents under a fresh path with Unicode and spaces.
    const consume = path.join(root, '解压 发行包');
    run(shell, ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${path.join(path.dirname(bundle), 'dsh-desktop-v0.2.1-rc.3.1-win-x64.zip').replaceAll("'", "''")}' -DestinationPath '${consume.replaceAll("'", "''")}'`]);
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
          ['compatibility.json', JSON.stringify({ 'user-plugin@1.0.0': ['0.2.1-rc.2'], 'dsh-session-control@0.8.5-dsh021.2': ['0.2.1-rc.2'] })],
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
      comp['later-plugin@1.0.0'] = ['0.2.1-rc.3'];
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
      assert.deepEqual(rolledComp['later-plugin@1.0.0'], ['0.2.1-rc.3']);
      if (custom) assert.deepEqual(rolledComp['dsh-session-control@0.8.5-dsh021.2'], ['0.2.1-rc.2']);
      assert.match(invoke(home, 'Rollback').stdout, /ALREADY_ROLLED_BACK/);
      evidence.push({ shell, kind, root, nonAdmin: true, installed: true, idempotent: true, rollbackPreservedLaterEdits: true, pnpmLinkPreserved: !!link, realProviderCalls: 0 });
      write(path.join(base, 'consumer-results.json'), JSON.stringify(evidence, null, 2));
    }
  });
}
