import fs from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { useOfficial } from '../desktop/official-runtime.mjs';
import test from 'node:test';

// Independent official probe. No supplement import, version/hash or expected failure assertion.
if (!process.argv[2] || !process.argv[3]) {
  await test('Desktop retirement requires the dedicated Electron runner', { skip: true }, () => {});
} else {
const output = process.argv[3];
const report = { status: 'PROBING', supplementalImported: false, supplementalApplied: false, checks: [], unknownShape: false };
let server, ctx, runtime, pi;
const received = [], discoveries = [];
let discoveryMode = 'live', streamMode = 'stop';
const protocols = ['openai-completions', 'openai-responses', 'anthropic-messages'];
const routes = ['opencode-go', 'opencode-go-response'];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function check(capability, probe) {
  try {
    const result = await probe();
    if (typeof result.covered !== 'boolean') throw Error('Unknown probe result');
    report.checks.push({ capability, ...result });
  } catch (error) {
    report.checks.push({ capability, covered: false, error: error.message, code: error.code });
    if (!['DISCOVERY_FAILED', 'DISCOVERY_UNSUPPORTED', 'INVALID_CREDENTIAL', 'ABORTED', 'MISSING_SESSION_ID', 'NO_ADAPTER'].includes(error.code)) report.unknownShape = true;
  }
}
try {
  const { official } = useOfficial(process.argv[2]);
  const { Context } = await import(pathToFileURL(`${official}@deepseek-ai/cordis/lib/index.js`));
  const { default: Llm, resolveRetryPolicy } = await import(pathToFileURL(`${official}@deepseek-ai/dsh-llm/lib/index.js`));
  const Pi = await import(pathToFileURL(`${official}@deepseek-ai/dsh-llm-pi-ai/lib/index.js`));
  if (typeof Context !== 'function' || typeof Llm !== 'function' || typeof Pi.apply !== 'function' || typeof resolveRetryPolicy !== 'function') throw Error('Unknown official export API');
  server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      discoveries.push({ path: req.url, encoding: req.headers['accept-encoding'] });
      if (discoveryMode === 'reset') { req.socket.destroy(); return; }
      if (discoveryMode === 'hold') return;
      if (Number.isInteger(discoveryMode)) { res.writeHead(discoveryMode); res.end('{}'); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(discoveryMode === 'bad-json' ? 'broken' : discoveryMode === 'bad-list' ? '{"data":"broken"}' : JSON.stringify({ data: [{ id: 'retirement-live', name: 'Live', context_length: 8888,
        top_provider: { max_completion_tokens: 777 }, architecture: { input_modalities: ['text', 'image', 'audio', 'text'] } }] })); return;
    }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    received.push({ native: req.headers['x-deepseek-harness-session-id'], go: req.headers['x-opencode-session'], marker: body.messages?.at(-1)?.content ?? body.input?.at(-1)?.content });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ ...data, type })}\n\n`);
    if (req.url.endsWith('/chat/completions')) {
      for (const delta of [{ role: 'assistant', content: 'OK' }, {}]) res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta, finish_reason: delta.content ? null : streamMode }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    } else if (req.url.split('?')[0].endsWith('/messages')) {
      event('message_start', { message: { id: 'mock', type: 'message', role: 'assistant', model: 'mock-model', content: [], usage: { input_tokens: 1, output_tokens: 0 } } });
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'OK' } });
      event('content_block_stop', { index: 0 });
      event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
      event('message_stop', {}); res.end();
    } else if (req.url.endsWith('/responses')) {
      const item = { id: 'msg_mock', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] };
      event('response.created', { response: { id: 'resp_mock', status: 'in_progress', output: [] } });
      event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
      event('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: 'OK' });
      event('response.output_item.done', { output_index: 0, item });
      event('response.completed', { response: { id: 'resp_mock', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } }); res.end();
    } else { report.unknownShape = true; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  ctx = new Context();
  ctx.provide('credentials', { resolve: async () => ({ value: 'mock-offline-key' }), readRecord: async () => undefined, listRecords: async () => [] });
  runtime = ctx.plugin(Llm); await runtime;
  if (['stream', 'prepareCall', 'discoverModels', 'registration'].some(method => typeof ctx.llm?.[method] !== 'function')) throw Error('Unknown official LLM service API');
  async function install(api) {
    await pi?.dispose();
    pi = ctx.plugin(Pi, { providers: Object.fromEntries([...routes, 'fixture', 'openrouter'].map(provider => [provider, { api, baseURL: `${base}/${provider}/v1`, apiKeyEnv: 'OFFLINE_MOCK_ONLY',
      headers: { 'X-OpenCode-Session': 'stale-upper', 'x-OPENCODE-session': 'stale-mixed', 'X-DeepSeek-Harness-Session-ID': 'stale-native' },
      ...(provider === 'openrouter' ? {} : { models: [{ id: 'mock-model', input: ['text'], contextWindow: 8192, maxTokens: 32 }] }) }])) }); await pi;
  }
  async function call(provider, sid, prepared, purpose = 'agent') {
    const options = { provider, model: 'mock-model', sessionId: sid, purpose, maxTokens: 16, messages: [{ role: 'user', content: [{ type: 'text', text: sid }] }], signal: AbortSignal.timeout(3000), ...prepared?.config };
    const chunks = [];
    for await (const chunk of prepared ? prepared.stream(options) : ctx.llm.stream(options)) chunks.push(chunk);
    const reason = chunks.findLast(chunk => chunk.type === 'finish')?.reason;
    if (!reason || !['error', 'stop', 'max-tokens', 'tool-calls'].includes(reason.kind)) throw Error('Unknown terminal stream shape');
    if (reason.kind === 'error' && typeof reason.failure?.code !== 'string') throw Error('Unknown terminal failure shape');
    return reason;
  }
  for (const api of protocols) {
    await install(api);
    for (const provider of routes) {
      const wire = sid => received.at(-1)?.go === sid && received.at(-1)?.native === sid;
      await check(`SID main ${api} ${provider}`, async () => {
        const reason = await call(provider, 'session-main');
        return { covered: reason.kind !== 'error' && wire('session-main'), observed: received.at(-1), failureCode: reason.failure?.code };
      });
      await check(`SID prepared-title ${api} ${provider}`, async () => {
        const prepared = await ctx.llm.prepareCall({ provider, model: 'mock-model', maxTokens: 16 });
        if (typeof prepared?.stream !== 'function') throw Error('Unknown prepared call shape');
        const reason = await call(provider, 'session-title', prepared, 'session-title');
        return { covered: reason.kind !== 'error' && wire('session-title'), observed: received.at(-1), failureCode: reason.failure?.code };
      });
      await check(`SID concurrent ${api} ${provider}`, async () => {
        const start = received.length, reasons = await Promise.all(['session-a', 'session-b'].map(sid => call(provider, sid)));
        const batch = received.slice(start);
        return { covered: reasons.every(reason => reason.kind !== 'error') && batch.length === 2 && equal(batch.map(row => row.go).sort(), ['session-a', 'session-b']) &&
          batch.every(row => row.native === row.go && JSON.stringify(row.marker).includes(row.go)), observed: batch };
      });
    }
  }
  await install('openai-completions');
  const request = { provider: 'openrouter', baseURL: `${base}/discovery/v1`, apiKey: 'mock-draft-key' };
  const discover = async (extra = {}, signal) => {
    const models = await ctx.llm.discoverModels('llm-pi-ai', { ...request, ...extra }, signal);
    if (!Array.isArray(models) || models.some(model => typeof model.id !== 'string')) throw Error('Unknown discovery result shape');
    return models;
  };
  const catalog = await ctx.llm.discoverModels('llm-pi-ai', { provider: 'openrouter' });
  if (!Array.isArray(catalog) || !catalog.length) throw Error('Official catalog fixture unavailable; adapt probe');
  await check('provider-only catalog prefetch', async () => {
    const start = discoveries.length, result = await ctx.llm.discoverModels('llm-pi-ai', { provider: 'openrouter' });
    return { covered: equal(result, catalog) && discoveries.length === start };
  });
  for (const api of protocols) await check(`live endpoint + text/image + identity ${api}`, async () => {
    discoveryMode = 'live'; const start = discoveries.length, models = await discover({ api });
    return { covered: equal(models, [{ id: 'retirement-live', name: 'Live', contextWindow: 8888, maxTokens: 777, inputModalities: ['text', 'image'] }]) && discoveries.length === start + 1 && discoveries.at(-1).encoding === 'identity', observedCount: models.length, endpointRequests: discoveries.length - start };
  });
  for (const mode of [500, 503, 599, 'reset']) await check(`safe fallback ${mode}`, async () => {
    discoveryMode = mode; const start = discoveries.length, models = await discover();
    return { covered: equal(models, catalog) && discoveries.length === start + 1, endpointRequests: discoveries.length - start };
  });
  const mockApi = createRequire(`${official}@deepseek-ai/dsh-llm-pi-ai/package.json`)('undici');
  if (typeof mockApi.MockAgent !== 'function' || typeof mockApi.setGlobalDispatcher !== 'function') throw Error('Unknown native-fetch mock transport API; adapt probe');
  const originalDispatcher = mockApi.getGlobalDispatcher(), mock = new mockApi.MockAgent(); mock.disableNetConnect();
  try {
    mockApi.setGlobalDispatcher(mock);
    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']) {
      await check(`recognized transport fallback ${code}`, async () => {
        mock.get('http://127.0.0.1:31337').intercept({ path: '/v1/models', method: 'GET' }).replyWithError(Object.assign(new Error('mock transport'), { code }));
        const models = await discover({ baseURL: 'http://127.0.0.1:31337/v1' });
        let consumed = true;
        try { mock.assertNoPendingInterceptors(); } catch { consumed = false; }
        return { covered: equal(models, catalog) && consumed, mockTransportConsumed: consumed };
      });
    }
  } finally { mockApi.setGlobalDispatcher(originalDispatcher); await mock.close(); }
  async function rejection(extra, signal, code, noHttp = false) {
    const start = discoveries.length;
    try { const models = await discover(extra, signal); return { covered: false, returnedModels: models.length }; }
    catch (error) {
      if (!['DISCOVERY_FAILED', 'DISCOVERY_UNSUPPORTED', 'INVALID_CREDENTIAL', 'ABORTED'].includes(error.code)) report.unknownShape = true;
      return { covered: error.code === code && (!noHttp || discoveries.length === start), observedCode: error.code, endpointRequests: discoveries.length - start };
    }
  }
  for (const mode of [401, 403, 429, 'bad-json', 'bad-list']) await check(`no fallback ${mode}`, async () => {
    discoveryMode = mode; return rejection({}, undefined, 'DISCOVERY_FAILED');
  });
  discoveryMode = 503;
  await check('unknown provider no invented fallback', () => rejection({ provider: 'unknown-fixture' }, undefined, 'DISCOVERY_FAILED'));
  for (const baseURL of ['invalid', 'file:///fixture', `${base}/?x=1`, `${base}/#x`, 'http://user:pass@127.0.0.1/', ` ${base}`]) await check(`invalid URL ${baseURL}`, () => rejection({ baseURL }, undefined, 'DISCOVERY_FAILED', true));
  for (const apiKey of ['', 'bad\r\nkey', '中文']) await check('invalid key never falls back', () => rejection({ apiKey }, undefined, 'INVALID_CREDENTIAL', true));
  const cancelled = new AbortController(); cancelled.abort();
  await check('pre-cancel never falls back', () => rejection({}, cancelled.signal, 'ABORTED', true));
  discoveryMode = 'hold';
  await check('inflight cancel never falls back', () => rejection({}, AbortSignal.timeout(30), 'ABORTED'));
  streamMode = 'network_error';
  await check('network_error TRANSPORT and official normal retry eligible', async () => {
    const reason = await call('fixture', 'session-network-error'), policy = resolveRetryPolicy(undefined, 'retirement');
    if (!Array.isArray(policy?.retryableCodes)) throw Error('Unknown official retry policy shape');
    return { covered: reason.kind === 'error' && reason.failure?.code === 'TRANSPORT' && policy.retryableCodes.includes(reason.failure.code), observedCode: reason.failure?.code };
  });
  report.status = report.unknownShape ? 'NEEDS_ADAPTATION' : report.checks.every(check => check.covered) ? 'ELIGIBLE' : 'NOT_ELIGIBLE';
} catch (error) { report.status = 'NEEDS_ADAPTATION'; report.error = error.message; }
finally {
  await pi?.dispose(); await runtime?.dispose();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  report.inferenceRequests = received.length; report.discoveryRequests = discoveries.length;
  fs.writeFileSync(`${output}/retirement.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failed: report.checks.filter(check => !check.covered).length }));
  process.exitCode = report.status === 'ELIGIBLE' ? 0 : report.status === 'NOT_ELIGIBLE' ? 2 : 1;
}
}
