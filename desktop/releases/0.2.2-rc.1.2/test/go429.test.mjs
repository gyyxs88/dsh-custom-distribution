import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { useOfficial } from '../../../official-runtime.mjs';

if (!process.versions.electron) throw Error('Official Electron required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv.includes('--baseline');
if (!process.argv[2] || !process.argv[3]) throw Error('Explicit official ASAR and isolated output required');
const output = path.join(path.resolve(process.argv[3]), baseline ? 'baseline.json' : 'regression.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
const { official } = useOfficial(process.argv[2]);
const load = name => import(pathToFileURL(`${official}@deepseek-ai/${name}/lib/index.js`));
const { Context } = await load('cordis');
const { default: Llm, resolveRetryPolicy } = await load('dsh-llm');
const Pi = await load('dsh-llm-pi-ai');
const Retry = await load('dsh-llm-retry');
const source = baseline ? fileURLToPath(new URL('../../../../sources/dsh-desktop-0.2.2-rc.1.1/build-inputs/packages/dsh-desktop-compat/lib/index.js', import.meta.url)) : path.join(root, 'build-inputs/dsh-desktop-compat/lib/index.js');
const compat = await import(pathToFileURL(source));
const Errors = await import(new URL('./errors.js', pathToFileURL(source)));
const result = { baseline, realProviderRequests: 0, productionWrites: 0, cases: [] };
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert.equal(url.hostname, '127.0.0.1', 'All test transport must stay on loopback');
  return nativeFetch(input, init);
};
let mode = {}, requestCount = 0;
const wires = [];
const server = createServer(async (req, res) => {
  requestCount++;
  const wire = { sid: req.headers['x-opencode-session'], native: req.headers['x-deepseek-harness-session-id'], ua: req.headers['user-agent'], closed: false };
  wires.push(wire); res.on('close', () => { wire.closed = true; });
  for await (const _ of req) { /* Consume only synthetic test input. */ }
  const current = mode.bySid?.[wire.sid] ?? mode;
  if (current.hold) return;
  if (current.delay) await new Promise(resolve => setTimeout(resolve, current.delay));
  if (current.status) {
    res.writeHead(current.status, { 'content-type': 'application/json', ...current.headers });
    if (current.bodyHold) { res.write('{"error":'); return; }
    res.end(current.bodyText ?? JSON.stringify({ error: current.error })); return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] })}\n\n`);
  if (current.streamHold) return;
  res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: {}, finish_reason: current.finishReason ?? 'stop' }] })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/v1`;
async function setup(api = 'openai-completions') {
  const ctx = new Context();
  ctx.provide('credentials', { resolve: async () => ({ value: 'mock-offline-key' }), readRecord: async () => undefined, listRecords: async () => [] });
  const llm = ctx.plugin(Llm); await llm;
  const profile = { api, baseURL: base, apiKeyEnv: 'OFFLINE_MOCK_ONLY', streamIdleTimeoutMs: 150,
    headers: { 'X-OpenCode-Session': 'stale', 'User-Agent': 'generic-sdk' }, models: [{ id: 'mock-model', input: ['text'], contextWindow: 8192, maxTokens: 32 }] };
  const pi = ctx.plugin(Pi, { providers: { 'opencode-go': profile, 'opencode-go-response': structuredClone(profile), fixture: structuredClone(profile) } }); await pi;
  const supplement = ctx.plugin(compat); await supplement;
  return { ctx, adapter: ctx.llm.registration('opencode-go').adapter,
    async close() { await supplement.dispose(); await pi.dispose(); await llm.dispose(); } };
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function call(fixture, sid = 'session-offline', extra = {}, prepared) {
  const options = { provider: 'opencode-go', model: 'mock-model', sessionId: sid, maxTokens: 16, signal: AbortSignal.timeout(3000),
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic offline probe' }] }], ...extra };
  let finish;
  for await (const chunk of prepared ? prepared.stream(options) : fixture.ctx.llm.stream(options)) if (chunk.type === 'finish') finish = chunk.reason;
  assert.ok(finish); return finish;
}
function clean(failure) {
  const serialized = JSON.stringify(failure);
  for (const forbidden of ['private-body-marker', 'Bearer', 'https://private', 'metadata', 'raw', 'cause']) assert.ok(!serialized.includes(forbidden), forbidden);
}
async function check(label, fn) {
  try { const details = await fn(); result.cases.push({ label, passed: true, ...details }); console.log(`PASS ${label}`); }
  catch (error) { result.cases.push({ label, passed: false, assertion: error.message }); console.log(`FAIL ${label}: ${error.message}`); }
}
let fixture;
try {
  fixture = await setup();
  await check('HTTP429 header Retry-After and request-id survive final LLM boundary', async () => {
    mode = { status: 429, headers: { 'retry-after': '0.025', 'x-request-id': 'req-offline-429' }, error: { type: 'rate_limit_error', code: 'too_many_requests', message: 'private-body-marker', metadata: { raw: 'Bearer private-body-marker' } } };
    const f = (await call(fixture)).failure;
    assert.equal(f.code, 'RATE_LIMIT'); assert.equal(f.status, 429); clean(f);
    if (baseline) { assert.equal(f.providerRetryAfterMs, undefined); assert.equal(f.requestId, undefined); assert.ok(!f.message.includes('rate_limit_error')); }
    else { assert.equal(f.providerRetryAfterMs, 25); assert.equal(f.requestId, 'req-offline-429'); assert.match(f.message, /provider\.type=rate_limit_error/); assert.match(f.message, /provider\.code=too_many_requests/); }
    return { failure: f, confirmedBaselineLoss: baseline };
  });
  await check('long HTTP429 insufficient_quota is not retried as generic rate limit', async () => {
    mode = { status: 429, error: { message: 'private-body-marker'.repeat(260), type: 'insufficient_quota' } };
    const f = (await call(fixture)).failure; clean(f);
    assert.equal(f.code, baseline ? 'RATE_LIMIT' : 'QUOTA');
    return { failure: f, confirmedBaselineMisclassification: baseline };
  });
  await check('short structured quota with metadata remains QUOTA', async () => {
    mode = { status: 429, error: { type: 'insufficient_quota', message: 'private-body-marker', metadata: { raw: 'private-body-marker-upstream' } } };
    const f = (await call(fixture)).failure; clean(f);
    assert.equal(f.code, 'QUOTA'); return { failure: f };
  });
  await check('unknown429 stays unspecified; unapproved body types are not retained', async () => {
    mode = { status: 429, error: { type: 'private-body-marker', code: 'https://private/key', message: 'private-body-marker' } };
    const f = (await call(fixture)).failure; assert.equal(f.code, 'RATE_LIMIT'); clean(f); assert.ok(!/并发|额度/.test(f.message)); return { failure: f };
  });
  await check('numeric429 in HTTP400 body cannot override authoritative HTTP status', async () => {
    mode = { status: 400, error: { code: 429, type: 'invalid_request_error', message: 'private-body-marker' } };
    const f = (await call(fixture)).failure; assert.equal(f.code, 'INVALID_REQUEST'); assert.equal(f.status, 400); clean(f);
  });
  await check('arbitrary numeric429 prose does not establish HTTP429', async () => {
    const chunk = Errors.correctedChunk({ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'Provider finish_reason: private-body-marker 429' } } }, 'opencode-go');
    assert.equal(chunk.reason.failure.code, 'PI_AI_ERROR'); assert.equal(chunk.reason.failure.status, undefined); clean(chunk.reason.failure);
  });
  await check('official owned UA and both session headers are on actual loopback wire', async () => {
    mode = {}; assert.equal((await call(fixture, 'session-wire')).kind, 'stop');
    assert.equal(wires.at(-1).sid, 'session-wire'); assert.equal(wires.at(-1).native, 'session-wire');
    assert.equal(wires.at(-1).ua, 'deepseek-harness/0.2.2-rc.1 (+https://github.com/deepseek-ai/deepseek-harness)');
    return { userAgent: wires.at(-1).ua };
  });
  await check('idle TIMEOUT aborts pending HTTP transport; SDK does not retry', async () => {
    mode = { hold: true }; const before = requestCount;
    const reason = await call(fixture); assert.equal(reason.failure.code, 'TIMEOUT');
    await wait(50); assert.equal(wires.at(-1).closed, true); assert.equal(requestCount - before, 1);
    return { transportClosed: true, wireRequests: 1 };
  });
  await check('caller abort closes transport and remains ABORTED', async () => {
    mode = { hold: true }; const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 50);
    try { assert.equal((await call(fixture, 'session-abort', { signal: controller.signal })).failure.code, 'ABORTED'); }
    finally { clearTimeout(timer); }
    await wait(50); assert.equal(wires.at(-1).closed, true);
  });
  await check('incomplete HTTP error body cannot delay cancellation or override TIMEOUT', async () => {
    mode = { status: 429, bodyHold: true, headers: { 'retry-after': '1' } };
    const f = (await call(fixture)).failure; assert.equal(f.code, 'TIMEOUT'); await wait(50); assert.equal(wires.at(-1).closed, true);
  });
  await check('consumer stopping the stream closes transport', async () => {
    mode = { streamHold: true };
    const iterator = fixture.ctx.llm.stream({ provider: 'opencode-go', model: 'mock-model', sessionId: 'session-consumer', maxTokens: 16,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic' }] }], signal: AbortSignal.timeout(2000) })[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).done, false); await iterator.return(); await wait(50); assert.equal(wires.at(-1).closed, true);
  });
  await check('network_error remains TRANSPORT', async () => {
    mode = { finishReason: 'network_error' }; assert.equal((await call(fixture)).failure.code, 'TRANSPORT');
  });
  await check('parallel request facts stay isolated', async () => {
    mode = { bySid: {
      'session-a': { status: 429, delay: 30, headers: { 'retry-after': '0.02', 'x-request-id': 'req-a' }, error: { type: 'rate_limit_error' } },
      'session-b': { status: 429, headers: { 'retry-after': '0.03', 'x-request-id': 'req-b' }, error: { type: 'insufficient_quota' } },
    } };
    const [a,b] = await Promise.all(['session-a','session-b'].map(sid => call(fixture, sid)));
    assert.equal(a.failure.code, 'RATE_LIMIT'); assert.equal(b.failure.code, 'QUOTA');
    if (!baseline) { assert.equal(a.failure.requestId, 'req-a'); assert.equal(b.failure.requestId, 'req-b'); assert.equal(a.failure.providerRetryAfterMs, 20); assert.equal(b.failure.providerRetryAfterMs, 30); }
  });
  await check('snapshot and prepared-call semantics remain immutable', async () => {
    mode = { status: 429, error: { type: 'rate_limit_error' } };
    const snapshot = fixture.adapter.current(), method = snapshot.models.streamSimple;
    const prepared = await fixture.ctx.llm.prepareCall({ provider: 'opencode-go', model: 'mock-model', maxTokens: 16 });
    assert.equal((await call(fixture, 'session-prepared', {}, prepared)).failure.code, 'RATE_LIMIT');
    assert.strictEqual(fixture.adapter.current(), snapshot); assert.strictEqual(snapshot.models.streamSimple, method);
  });
  await check('actual Retry-After overrides body metadata and unsafe request-id is rejected', async () => {
    mode = { status: 429, headers: { 'retry-after': '0.035', 'x-request-id': 'Bearer private-body-marker' }, error: { type: 'rate_limit_error', metadata: { headers: { 'Retry-After': '0.001' } } } };
    const f = (await call(fixture)).failure; clean(f); assert.equal(f.providerRetryAfterMs, baseline ? 1 : 35); assert.equal(f.requestId, undefined);
  });
  await check('invalid actual Retry-After does not authorize body-supplied retry timing', async () => {
    mode = { status: 429, headers: { 'retry-after': 'private-body-marker' }, error: { type: 'rate_limit_error', metadata: { headers: { 'retry-after': '0.001' } } } };
    const f = (await call(fixture)).failure; assert.equal(f.providerRetryAfterMs, baseline ? 1 : undefined); clean(f);
  });
  await check('Retry-After HTTP date survives with its remaining interval', async () => {
    const future = new Date(Date.now() + 10000).toUTCString();
    mode = { status: 429, headers: { 'retry-after': future }, error: { type: 'rate_limit_error' } };
    const f = (await call(fixture)).failure;
    if (baseline) assert.equal(f.providerRetryAfterMs, undefined);
    else assert.ok(f.providerRetryAfterMs > 8000 && f.providerRetryAfterMs <= 10000);
  });
  await check('oversize/non-JSON HTTP error does not expose raw content or infer quota', async () => {
    for (const bodyText of ['private-body-marker', JSON.stringify({ error: { message: 'private-body-marker'.repeat(4000), type: 'insufficient_quota' } })]) {
      mode = { status: 429, bodyText }; const f = (await call(fixture)).failure;
      assert.equal(f.code, 'RATE_LIMIT'); assert.equal(f.status, 429); clean(f);
    }
  });
  await check('non-Go provider transport and public summary are unchanged', async () => {
    mode = { status: 429, headers: { 'retry-after': '1', 'x-request-id': 'req-other' }, error: { type: 'rate_limit_error' } };
    const f = (await call(fixture, 'session-other', { provider: 'fixture' })).failure;
    assert.equal(f.code, 'RATE_LIMIT'); assert.equal(f.providerRetryAfterMs, undefined); assert.equal(f.requestId, undefined); assert.ok(!f.message.includes('provider.type'));
  });
  for (const protocol of ['openai-responses', 'anthropic-messages']) await check(`real SDK ${protocol} HTTP429 headers and quota correction`, async () => {
    const other = await setup(protocol);
    try {
      mode = { status: 429, headers: { 'retry-after': '0.04', 'x-request-id': 'req-protocol' }, error: { type: 'rate_limit_error', message: 'private-body-marker' } };
      const f = (await call(other, 'session-protocol', { provider: 'opencode-go-response' })).failure;
      assert.equal(f.code, 'RATE_LIMIT'); clean(f);
      if (!baseline) { assert.equal(f.providerRetryAfterMs, 40); assert.equal(f.requestId, 'req-protocol'); assert.match(f.message, /provider.type=rate_limit_error/); }
      mode = { status: 429, error: { type: 'insufficient_quota' } };
      assert.equal((await call(other)).failure.code, 'QUOTA');
    } finally { await other.close(); }
  });
  await check('official retry executor respects preserved server hint and skips QUOTA', async () => {
    let recover; const effects = [];
    await Retry.apply({ fiber: { uid: 'offline' }, logger: { warn() {} }, sessionProjections: { async register() { return { stateOf() { return {}; } }; } },
      on(_name, fn) { recover = fn; return () => {}; }, effect(fn) { effects.push(fn()); } }, {}, { random: () => 0.5 });
    const policy = { ...resolveRetryPolicy(undefined, 'offline'), initialDelayMs: 1, maxDelayMs: 100, jitterRatio: 0 };
    const events = [];
    const payload = failure => ({ agent: { session: { append(type, data) { events.push({ type, data }); } } }, provider: 'opencode-go', turn: 'turn-offline', step: 'step-offline', signal: AbortSignal.timeout(2000), retryPolicy: policy, failure });
    try {
      mode = { status: 429, headers: { 'retry-after': '0.025' }, error: { type: 'rate_limit_error' } };
      await recover(payload((await call(fixture)).failure), async () => {});
      assert.equal(events.find(e => e.type === 'llm/retry').data.delayMs, baseline ? 1 : 25);
      events.length = 0;
      await recover(payload({ code: 'QUOTA', message: 'fixture' }), async () => {}); assert.equal(events.length, 0);
      await recover(payload({ code: 'RATE_LIMIT', message: 'fixture', providerRetryAfterMs: 101 }), async () => {}); assert.equal(events.length, 0);
    } finally { for (const dispose of effects) await dispose?.(); }
  });
} finally {
  await fixture?.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  globalThis.fetch = nativeFetch;
  result.status = result.cases.every(c => c.passed) ? 'PASSED' : 'FAILED';
  result.loopbackRequests = requestCount;
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ status: result.status, cases: result.cases.length, output }));
  if (result.status !== 'PASSED') process.exitCode = 1;
}
