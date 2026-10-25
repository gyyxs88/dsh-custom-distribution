// Isolated consumer acceptance: launch the actual official Desktop Host over IPC.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [app, home, evidence] = process.argv.slice(2);
assert.ok(home.includes('desktop-install-'));
assert.equal(process.env.DSH_HOME, home);
const runtime = path.join(app, 'resources/app.asar/dsh');
const profile = path.join(home, 'profiles/desktop');
const result = { status: 'RUNNING', officialHost: true, realProviderCalls: 0, sshCalls: 0, externalCodingCalls: 0 };
let output = '';
const child = spawn(path.join(app, 'DeepSeek Harness.exe'), ['--expose-internals', '--import', pathToFileURL(fileURLToPath(new URL('./desktop-install-network.mjs', import.meta.url))).href, path.join(runtime, 'node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'), runtime, profile, path.join(app, 'resources/runtime/primary-runtime')], {
  cwd: path.dirname(home), env: { ...process.env, DSH_CLIENT_VERSION: '0.2.1-rc.3', USERPROFILE: path.dirname(home), HOME: path.dirname(home), APPDATA: path.join(home, 'test-appdata'), LOCALAPPDATA: path.join(home, 'test-localappdata'), DSH_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
});
child.stdout.on('data', b => output += b);
child.stderr.on('data', b => output += b);
const timer = setTimeout(() => { result.status = 'FAILED_TIMEOUT'; child.send({ type: 'quit-inspection', requestId: 1 }); }, 45000);
child.on('message', async message => {
  try {
    if (message.type === 'ready') {
      const login = await fetch(message.url, { redirect: 'manual' });
      assert.equal(login.status, 303);
      const cookie = login.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie);
      async function rpc(method, args) {
        const response = await fetch(new URL('/api/' + method, message.url), { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args } }) });
        assert.equal(response.status, 200);
        const envelope = await response.json();
        assert.equal(envelope.result?.ok, true);
        return envelope.result.value;
      }
      const inventory = await rpc('pluginInventory/list', {});
      result.entries = inventory.entries.map(({ entryId, moduleName, enabled, fiberPhase }) => ({ entryId, moduleName, enabled, fiberPhase }));
      for (const name of ['dsh-session-control', 'dsh-remote-control/plugin', 'dsh-subagent-code-agents', '@omdsh-dev/dsh-genui', 'dsh-desktop-compat']) assert.ok(result.entries.some(e => e.moduleName === name && e.enabled && e.fiberPhase === 'active'), name);
      for (const name of ['tps-correction-021', 'tps-trajectory-021']) assert.ok(result.entries.some(e => e.entryId.endsWith(':' + name) && e.enabled && e.fiberPhase === 'active'), name);
      const sessions = await rpc('session/list', { _request: {} });
      assert.equal(sessions.items.length, 0);
      result.status = 'PASSED'; result.authenticatedHttp = true; result.syntheticEmptySessions = true;
      child.send({ type: 'quit-inspection', requestId: 2 });
    } else if (message.type === 'quit-inspection') {
      assert.ok(!message.activeTasks && !message.error);
      result.idleShutdown = true;
      child.send({ type: 'shutdown' });
    } else if (message.type === 'fatal') {
      result.status = 'FAILED'; result.error = message.message;
      child.disconnect();
    }
  } catch (error) {
    result.status = 'FAILED'; result.error = error.message;
    child.send({ type: 'quit-inspection', requestId: 3 });
  }
});
await new Promise(resolve => child.once('exit', code => {
  clearTimeout(timer); result.exitCode = code;
  fs.writeFileSync(evidence, JSON.stringify(result, null, 2));
  fs.writeFileSync(evidence + '.log', output.replace(/([?&]token=)[^\s"&]+/g, '$1[REDACTED]'));
  if (result.status !== 'PASSED' || code !== 0) process.exitCode = 1;
  console.log(JSON.stringify({ ...result, entries: undefined })); resolve();
}));
