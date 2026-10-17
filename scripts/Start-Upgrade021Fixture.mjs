import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(repo, 'temp/upgrade-021rc2-20261017'));
const fixtureName = process.argv[3] ?? 'fixture';
if (!/^fixture(?:-[a-z0-9]+)*$/.test(fixtureName)) throw Error('Invalid fixture name');
const config = JSON.parse(fs.readFileSync(path.join(root, fixtureName, 'fixture.json')));
if (config.home.includes('C:/Users/Administrator/.dsh') || !config.home.startsWith(root)) throw Error('Isolation boundary invalid');
const log = fs.openSync(path.join(config.fixture, 'host.log'), 'a');
let requests = 0;
const mock = createServer(async (req, res) => {
  if (!req.url.startsWith('/v1/')) { res.writeHead(404); res.end(); return; }
  if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); res.end('{"data":[{"id":"fixture-model"}]}'); return; }
  let body = '';
  for await (const chunk of req) { body += chunk; }
  requests++;
  const prompt = body.toLowerCase();
  const error = prompt.includes('fixture:region') ? { status: 403, type: 'RegionError', message: 'This model is not available in your country' }
    : prompt.includes('fixture:forbidden') ? { status: 403, type: 'permission_error', message: 'Insufficient permissions' }
    : prompt.includes('fixture:quota') ? { status: 403, type: 'insufficient_quota', message: 'Insufficient balance' }
    : prompt.includes('fixture:auth') ? { status: 401, type: 'invalid_api_key', message: 'Invalid API key' } : undefined;
  if (error) { res.writeHead(error.status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error })); return; }
  const genui = { items: [
    { type: 'text', content: 'GENUI_FIXTURE_OK' },
    { type: 'callout', text: '流式结束后仍应显示为组件', tone: 'info' },
    { type: 'table', columns: ['项目', '结果'], rows: [['组件', '保留'], ['普通代码', '保持代码'], ['速度', '估算'], ['会话', '隔离'], ['ASAR', '官方原包']] },
  ] };
  const text = prompt.includes('genui') ? '隔离验证样本。\n\n```dsh-ui\n' + JSON.stringify(genui) + '\n```\n\n```json\n{"ordinaryCode":true}\n```' : 'Fixture response: controlled chunked output with terminal usage only. '.repeat(12);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (let offset = 0; offset < text.length; offset += 24) {
    if (res.destroyed) return;
    res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta: { ...(offset ? {} : { role: 'assistant' }), content: text.slice(offset, offset + 24) }, finish_reason: null }] })}\n\n`);
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  await new Promise(resolve => setTimeout(resolve, 350));
  res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 32, completion_tokens: 128, total_tokens: 160 } })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
const patchFile = path.join(config.profile, 'cordis.patch.yml');
fs.writeFileSync(patchFile, fs.readFileSync(patchFile, 'utf8').replace(/baseURL: http:\/\/127\.0\.0\.1:\d+\/v1/, `baseURL: http://127.0.0.1:${mock.address().port}/v1`));
const runtime = `${config.archive}/dsh`, entry = `${runtime}/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js`;
const env = { SystemRoot: 'C:/Windows', WINDIR: 'C:/Windows', PATH: 'C:/Windows/System32;C:/Windows',
  ELECTRON_RUN_AS_NODE: '1', USERPROFILE: config.fixture, HOME: config.fixture,
  APPDATA: path.join(config.fixture, 'AppData/Roaming'), LOCALAPPDATA: path.join(config.fixture, 'AppData/Local'),
  DSH_HOME: config.home, TEMP: config.fixture, TMP: config.fixture,
  DSH_CLIENT_VERSION: '0.2.1-rc.2', DSH_OFFLINE_MOCK_KEY: 'mock-offline-only' };
const child = spawn(config.electron, ['--expose-internals', entry, runtime, config.profile,
  path.join(path.dirname(config.electron), 'resources/runtime/primary-runtime')],
  { cwd: config.profile, env, windowsHide: true, stdio: ['ignore', log, log, 'ipc'] });
const privateFile = path.join(config.fixture, 'ready-private.json');
let stopping = false, ready = false;
child.on('message', message => {
  if (message.type === 'ready') {
    ready = true;
    fs.writeFileSync(privateFile, JSON.stringify({ ...message, pid: child.pid, controllerPid: process.pid, mockPort: mock.address().port }, null, 2));
    console.log(JSON.stringify({ status: 'READY', pid: child.pid, privateReadyFile: privateFile, productionModified: false }));
  } else if (message.type === 'fatal') {
    fs.writeFileSync(path.join(config.fixture, 'fatal-private.json'), JSON.stringify(message, null, 2));
    console.error('Official Host startup failed; see protected fatal-private.json');
    process.exitCode = 1;
  } else if (message.type === 'quit-inspection') {
    if (message.activeTasks || message.error) { console.error('Fixture is active or unknown; stop refused'); return; }
    stopping = true; child.send({ type: 'shutdown' });
  }
});
child.once('exit', (code) => { clearInterval(timer); mock.closeAllConnections(); mock.close(); fs.closeSync(log);
  fs.writeFileSync(path.join(config.fixture, 'lifecycle.json'), JSON.stringify({ ready, stopped: stopping, code, requests, productionModified: false }, null, 2));
  if (code) process.exitCode = code;
});
const timer = setInterval(() => {
  const stop = path.join(config.fixture, 'stop-request');
  if (!stopping && ready && fs.existsSync(stop)) { fs.unlinkSync(stop); child.send({ type: 'quit-inspection', requestId: Date.now() }); }
}, 500);
process.on('SIGINT', () => { if (ready && !stopping) child.send({ type: 'quit-inspection', requestId: Date.now() }); });
