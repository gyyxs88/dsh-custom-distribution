import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

import { useOfficial } from '../desktop/official-runtime.mjs';
import test from 'node:test';
if (!process.argv[2] || !process.argv[3]) {
  await test('Desktop integration requires the dedicated Electron runner', { skip: true }, () => {});
} else {
const output = process.argv[3];
const { official } = useOfficial(process.argv[2]);
const peer = new Map(['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-llm-pi-ai']
  .map(pkg => [pkg, pathToFileURL(`${official}${pkg}/lib/index.js`).href]));
const { Context } = await import(pathToFileURL(`${official}@deepseek-ai/cordis/lib/index.js`));
const { default: Llm } = await import(peer.get('@deepseek-ai/dsh-llm'));
const Pi = await import(peer.get('@deepseek-ai/dsh-llm-pi-ai'));
const candidateEntry = process.argv[4] ?? new URL('../sources/dsh-desktop-compat/lib/index.js', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const supplement = await import(pathToFileURL(candidateEntry));
const requireOfficial = createRequire(`${official}@deepseek-ai/dsh-llm-pi-ai/package.json`);
const code = fs.readFileSync(`${official}@deepseek-ai/dsh-llm-pi-ai/lib/index.js`);
assert.equal(code.toString('utf8').length, 113888, 'must test the identified official rc.2 character length');
const evidence = { official: { llm: requireOfficial('@deepseek-ai/dsh-llm/package.json').version,
  piAdapter: requireOfficial('@deepseek-ai/dsh-llm-pi-ai/package.json').version,
  piSdk: JSON.parse(fs.readFileSync(`${official}@earendil-works/pi-ai/package.json`, 'utf8')).version,
  adapterBytes: code.length, adapterCharacters: code.toString('utf8').length,
  adapterSha256: createHash('sha256').update(code).digest('hex') }, cases: [] };
const received = [];
const discoveries = [];
let discoveryMode = 'live', streamError;
const server = createServer(async (req, res) => {
  if (req.method === 'GET') {
    // Mock keys are asserted in memory only; never copied to evidence.
    assert.ok(!req.headers.authorization || /^Bearer mock-/.test(req.headers.authorization));
    assert.ok(!req.headers['x-api-key'] || /^mock-/.test(req.headers['x-api-key']));
    discoveries.push({ path: req.url, identity: req.headers['accept-encoding'], preserved: req.headers['x-test-preserved'] });
    if (discoveryMode === 'reset') { req.socket.destroy(); return; }
    if (discoveryMode === 'hold') return;
    if (Number.isInteger(discoveryMode)) { res.writeHead(discoveryMode); res.end('{}'); return; }
    res.writeHead(200, { 'content-type': 'application/json', ...(discoveryMode === 'oversize' ? { 'content-length': 5 * 1024 * 1024 } : {}) });
    if (discoveryMode === 'oversize') { res.end(); return; }
    if (discoveryMode === 'bad-json') { res.end('not-json'); return; }
    if (discoveryMode === 'bad-list') { res.end('{"data":"wrong","models":[]}'); return; }
    if (discoveryMode === 'body-reset') { res.write('{"data":['); setImmediate(() => req.socket.destroy()); return; }
    if (discoveryMode === 'map') { res.end(JSON.stringify({ models: { alias: { id: 'canonical', limit: { context: 999, output: 99 }, architecture: { input_modalities: ['image', 'image'] } }, metadata: 123 } })); return; }
    res.end(JSON.stringify({ data: [{ id: 'live-model', name: 'Live', context_length: 8888,
      top_provider: { max_completion_tokens: 777 }, architecture: { input_modalities: ['text', 'image', 'audio', 'text'] } },
      { id: 'live-model' }, { id: '' }, { id: 'plain' }] })); return;
  }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  // Do not copy, persist, or print authentication headers.
  const identity = { openCode: req.headers['x-opencode-session'], native: req.headers['x-deepseek-harness-session-id'],
    userAgent: req.headers['user-agent'], preserved: req.headers['x-test-preserved'] };
  received.push({ path: req.url, identity, marker: body.messages?.at(-1)?.content ?? body.input?.at(-1)?.content });
  if (Number.isInteger(streamError)) { res.writeHead(streamError, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: `fixture ${streamError} network_error` } })); return; }
  // Reproduce the server's contract without sending requests to a provider.
  if (req.url.startsWith('/go/') && (!identity.openCode || identity.openCode.startsWith('stale-'))) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'MissingSessionID: x-opencode-session required', type: 'MissingSessionID' } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ ...data, type })}\n\n`);
  if (req.url.endsWith('/chat/completions')) {
    for (const delta of [{ role: 'assistant', content: 'OK' }, {}]) res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta, finish_reason: delta.content ? null : streamError ?? 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  } else if (req.url.split('?')[0].endsWith('/messages')) {
    event('message_start', { message: { id: 'mock', type: 'message', role: 'assistant', model: 'mock-model', content: [], usage: { input_tokens: 1, output_tokens: 0 } } });
    event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'OK' } });
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
    event('message_stop', {}); res.end();
  } else {
    const item = { id: 'msg_mock', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] };
    event('response.created', { response: { id: 'resp_mock', status: 'in_progress', output: [] } });
    event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
    event('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: 'OK' });
    event('response.output_item.done', { output_index: 0, item });
    event('response.completed', { response: { id: 'resp_mock', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } });
    res.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const protocols = ['openai-completions', 'openai-responses', 'anthropic-messages'];
const routes = ['opencode-go', 'opencode-go-response'];
const add = (label, details = {}) => { evidence.cases.push({ label, passed: true, ...details }); console.log(`PASS ${label}`); };

async function setup(api, candidate = false, early = false) {
  const ctx = new Context();
  // This in-memory mock has no access to saved credentials or launch environment.
  ctx.provide('credentials', { resolve: async () => ({ value: 'mock-not-a-real-key' }),
    readRecord: async () => undefined, listRecords: async () => [] });
  const runtime = ctx.plugin(Llm); await runtime;
  let patch;
  if (candidate && early) { patch = ctx.plugin(supplement); await patch; }
  const headers = { 'X-OpenCode-Session': 'stale-upper', 'x-OPENCODE-session': 'stale-mixed',
    'X-DeepSeek-Harness-Session-ID': 'stale-native', 'x-DEEPSEEK-harness-session-id': 'stale-native-mixed',
    'X-Test-Preserved': 'yes', 'User-Agent': 'stale-generic-sdk' };
  const providers = Object.fromEntries([...routes, 'fixture'].map(provider => [provider, { api,
    baseURL: `${base}/${provider === 'fixture' ? 'other' : 'go'}/${provider}/v1`,
    apiKeyEnv: 'OFFLINE_MOCK_ONLY', headers, models: [{ id: 'mock-model', input: ['text'], contextWindow: 8192, maxTokens: 32 }] }]));
  let pi = ctx.plugin(Pi, { providers }); await pi;
  if (candidate && !early) { patch = ctx.plugin(supplement); await patch; }
  const adapter = ctx.llm.registration(routes[0]).adapter;
  return { ctx, adapter, headers, patch, async replacePi() { await pi.dispose(); pi = ctx.plugin(Pi, { providers }); await pi; },
    async close() { await patch?.dispose(); await pi.dispose(); await runtime.dispose(); } };
}
async function call(ctx, provider, sessionId, purpose = 'agent', prepared) {
  const options = { provider, model: 'mock-model', sessionId, purpose,
    messages: [{ role: 'user', content: [{ type: 'text', text: sessionId ?? 'missing' }] }], maxTokens: 16,
    signal: AbortSignal.timeout(10000) };
  const chunks = [];
  if (prepared) Object.assign(options, prepared.config);
  for await (const chunk of (prepared ? prepared.stream(options) : ctx.llm.stream(options))) chunks.push(chunk);
  return chunks.findLast(chunk => chunk.type === 'finish')?.reason;
}
function wire(expected) {
  const request = received.at(-1);
  assert.equal(request.identity.openCode, expected);
  assert.equal(request.identity.native, expected);
  assert.equal(request.identity.preserved, 'yes');
  assert.match(request.identity.userAgent, /deepseek|harness|dsh/i);
}

async function discoveryIntegration() {
  const ctx = new Context();
  let credentialReads = 0;
  ctx.provide('credentials', { resolve: async () => { credentialReads++; return { value: 'mock-stored-key' }; }, readRecord: async () => undefined, listRecords: async () => [] });
  const llmPlugin = ctx.plugin(Llm); await llmPlugin;
  let pi = ctx.plugin(Pi, { providers: { openrouter: { api: 'openai-completions',
    baseURL: `${base}/discovery/v1`, apiKeyEnv: 'OFFLINE_MOCK_ONLY', headers: { 'X-Test-Preserved': 'stored' } } } }); await pi;
  const originalDescriptor = Object.getOwnPropertyDescriptor(ctx.llm, 'discoverModels');
  const request = { provider: 'openrouter', baseURL: `${base}/discovery/v1` };
  const probe = (extra = {}, signal) => ctx.llm.discoverModels('llm-pi-ai', { ...request, ...extra }, signal);
  const catalog = await ctx.llm.discoverModels('llm-pi-ai', { provider: 'openrouter' });
  assert.ok(catalog.length);
  assert.equal(credentialReads, 0);
  const count = discoveries.length;
  assert.deepEqual(await probe(), catalog); assert.equal(discoveries.length, count);
  evidence.baseline = { discoveryEndpointIgnored: true, liveInputsAbsent: true, retirementEligible: false };
  const uncatalogued = await probe({ provider: 'unknown-fixture', apiKey: 'mock-draft-key' });
  add('official-catalog-first-retirement-baseline');
  const patch = ctx.plugin(supplement); await patch;
  try {
    assert.deepEqual(await ctx.llm.discoverModels('llm-pi-ai', { provider: 'openrouter' }), catalog);
    assert.equal(credentialReads, 0); add('provider-only-prefetch-no-http-no-key-resolution');
    await assert.rejects(ctx.llm.discoverModels('llm-pi-ai', { provider: 'unknown-fixture' }), { code: 'DISCOVERY_FAILED' });
    add('unknown-provider-only-no-invented-catalog');
    discoveryMode = 'live';
    const live = await probe();
    assert.deepEqual(live, [{ id: 'live-model', name: 'Live', contextWindow: 8888, maxTokens: 777, inputModalities: ['text', 'image'] }, { id: 'plain', name: 'plain' }]);
    assert.equal(credentialReads, 1); assert.equal(discoveries.at(-1).identity, 'identity'); assert.equal(discoveries.at(-1).preserved, 'stored');
    add('real-discovery-live-inputs-capacities-dedup-identity-lazy-key');
    await probe({ apiKey: 'mock-draft-key' }); assert.equal(credentialReads, 1); add('draft-key-overrides-stored-credential');
    for (const api of protocols) {
      await probe({ api, apiKey: 'mock-draft-key' });
      assert.equal(discoveries.at(-1).path, api === 'anthropic-messages' ? '/discovery/v1/models?limit=1000' : '/discovery/v1/models');
      add(`real-discovery-protocol ${api}`);
    }
    discoveryMode = 'map';
    assert.deepEqual(await probe({ apiKey: 'mock-draft-key' }), [{ id: 'alias', name: 'alias', contextWindow: 999, maxTokens: 99, inputModalities: ['image'] }]); add('real-discovery-model-map-alias-inputs');
    for (const mode of [401, 403, 429, 400, 'bad-json', 'bad-list', 'oversize']) {
      discoveryMode = mode;
      await assert.rejects(probe({ apiKey: 'mock-draft-key' }), { code: 'DISCOVERY_FAILED' }); add(`discovery-no-fallback ${mode}`);
    }
    for (const mode of [500, 503, 599, 'reset', 'body-reset']) {
      discoveryMode = mode; assert.deepEqual(await probe({ apiKey: 'mock-draft-key' }), catalog); add(`discovery-safe-fallback ${mode}`);
    }
    discoveryMode = 503;
    await assert.rejects(probe({ provider: 'unknown-fixture', apiKey: 'mock-draft-key' }), { code: 'DISCOVERY_FAILED' }); add('503-unknown-provider-no-catalog');
    const closedServer = createServer();
    await new Promise(resolve => closedServer.listen(0, '127.0.0.1', resolve));
    const closedPort = closedServer.address().port;
    await new Promise(resolve => closedServer.close(resolve));
    assert.deepEqual(await probe({ baseURL: `http://127.0.0.1:${closedPort}/v1`, apiKey: 'mock-draft-key' }), catalog); add('real-connection-refused-catalog-fallback');
    const start = discoveries.length, reads = credentialReads;
    for (const baseURL of ['invalid', 'file:///fixture', ' http://127.0.0.1/', `${base}/?x=1`, `${base}/#x`, `http://user:pass@127.0.0.1/`]) {
      await assert.rejects(probe({ baseURL }), { code: 'DISCOVERY_FAILED' });
    }
    for (const apiKey of ['', 'bad\r\nkey', '中文']) await assert.rejects(probe({ apiKey }), { code: 'INVALID_CREDENTIAL' });
    assert.equal(discoveries.length, start); assert.equal(credentialReads, reads); add('invalid-url-key-no-http-no-fallback');
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(probe({ apiKey: 'mock-draft-key' }, cancelled.signal), { code: 'ABORTED' });
    assert.equal(discoveries.length, start); add('pre-cancel-no-http-no-catalog');
    discoveryMode = 'hold';
    await assert.rejects(probe({ apiKey: 'mock-draft-key' }, AbortSignal.timeout(30)), { code: 'ABORTED' }); add('inflight-cancel-no-fallback');
    assert.deepEqual(await probe({ api: 'google-generative-ai', apiKey: 'mock-draft-key' }), catalog); add('unsupported-list-protocol-prefetch-catalog');
    await assert.rejects(probe({ provider: 'unknown-fixture', api: 'google-generative-ai', apiKey: 'mock-draft-key' }), { code: 'DISCOVERY_UNSUPPORTED' }); add('unsupported-list-no-invented-catalog');
    const otherDispose = ctx.llm.registerModelDiscovery('fixture-other', async () => [{ id: 'untouched' }]);
    assert.deepEqual(await ctx.llm.discoverModels('fixture-other', { provider: 'other' }), [{ id: 'untouched' }]); otherDispose(); add('other-discovery-namespace-unchanged');
    // Native fetch with a mock Undici transport in this isolated test process.
    // Global fetch is never replaced; restore the dispatcher after every matrix.
    const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = requireOfficial('undici');
    const dispatcher = getGlobalDispatcher(), mock = new MockAgent(); mock.disableNetConnect();
    try {
      setGlobalDispatcher(mock);
      const transport = mock.get('http://127.0.0.1:31337');
      for (const code of ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']) {
        const cause = Object.assign(new Error('offline timeout fixture'), { code });
        transport.intercept({ path: '/v1/models', method: 'GET' }).replyWithError(cause);
        assert.deepEqual(await probe({ baseURL: 'http://127.0.0.1:31337/v1', apiKey: 'mock-draft-key' }), catalog);
        add(`native-fetch-recognized-timeout-fallback ${code}`);
      }
      for (const code of ['ENOTFOUND', 'CERT_HAS_EXPIRED', 'UNKNOWN_FIXTURE']) {
        transport.intercept({ path: '/v1/models', method: 'GET' }).replyWithError(Object.assign(new Error('offline fixture'), { code }));
        await assert.rejects(probe({ baseURL: 'http://127.0.0.1:31337/v1', apiKey: 'mock-draft-key' }), { code: 'DISCOVERY_FAILED' });
        add(`native-fetch-unapproved-transport-no-fallback ${code}`);
      }
    } finally { setGlobalDispatcher(dispatcher); await mock.close(); }
    await pi.dispose();
    pi = ctx.plugin(Pi, { providers: { openrouter: { api: 'openai-completions', baseURL: `${base}/discovery/v1`,
      apiKeyEnv: 'OFFLINE_MOCK_ONLY', headers: { 'X-Test-Preserved': 'replacement' },
      models: [{ id: live[0].id, input: live[0].inputModalities, contextWindow: live[0].contextWindow, maxTokens: live[0].maxTokens }] } } }); await pi;
    discoveryMode = 'live';
    await probe({ apiKey: 'mock-draft-key' });
    assert.equal(discoveries.at(-1).preserved, 'replacement'); add('discovery-replacement-instance-uses-current-profile');
    const adopted = await ctx.llm.registration('openrouter').adapter.resolveModel('openrouter', 'live-model');
    assert.deepEqual(adopted.inputModalities, ['text', 'image']);
    assert.equal(adopted.context.contextWindow, 8888); add('discovered-inputs-adopted-by-real-official-model-resolution');
    await patch.dispose(); assert.deepEqual(Object.getOwnPropertyDescriptor(ctx.llm, 'discoverModels'), originalDescriptor);
    assert.deepEqual(await probe(), catalog); add('discovery-unload-restores-official');
  } finally { discoveryMode = 'live'; await patch.dispose(); await pi.dispose(); await llmPlugin.dispose(); }
}

async function retryIntegration() {
  const fixture = await setup('openai-completions');
  const LlmModule = await import(peer.get('@deepseek-ai/dsh-llm'));
  const retry = await import(pathToFileURL(`${official}@deepseek-ai/dsh-llm-retry/lib/index.js`));
  let recover, projection;
  const disposers = [];
  // Real official retry plugin; only its agent/session host is an in-memory fixture.
  const host = { logger: { warn() {} }, sessionProjections: { register(definition) { projection = definition; }, stateOf() { return {}; } },
    on(event, callback) { assert.equal(event, 'agent/request-error'); recover = callback; return () => {}; },
    effect(effect) { disposers.push(effect()); } };
  retry.apply(host, {}, { random: () => 0.5 });
  const events = [];
  const agent = { session: { append: (type, data) => events.push({ type, data }) } };
  const policy = LlmModule.resolveRetryPolicy(undefined, 'fixture');
  async function decision(failure) {
    return recover({ agent, turn: 'fixture-turn', step: 'fixture-step', provider: 'opencode-go', failure,
      retryPolicy: { ...policy, initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }, signal: new AbortController().signal }, async () => undefined);
  }
  try {
    // Baseline exact error comes from a real SDK response, not an extracted classifier.
    streamError = 'network_error';
    const baseline = await call(fixture.ctx, 'fixture', 'session-error');
    assert.equal(baseline.kind, 'error'); assert.equal(baseline.failure.code, 'PI_AI_ERROR');
    assert.equal(await decision(baseline.failure), undefined); add('official-network_error-not-retryable-baseline');
    const patch = fixture.ctx.plugin(supplement); await patch;
    try {
      const count = received.length;
      const fixed = await call(fixture.ctx, 'fixture', 'session-error');
      assert.equal(fixed.failure.code, 'TRANSPORT'); assert.equal(received.length, count + 1);
      assert.deepEqual(await decision(fixed.failure), { kind: 'retry' });
      assert.equal(events.at(-1).type, 'llm/retry-started'); assert.ok(projection);
      add('real-sdk-network_error-official-retry-eligible-no-plugin-retry');
      for (const [status, code] of [[401, 'AUTH'], [403, 'AUTH'], [429, 'RATE_LIMIT'], [400, 'INVALID_REQUEST'], [503, 'SERVER']]) {
        streamError = status;
        const reason = await call(fixture.ctx, 'fixture', 'session-error');
        assert.equal(reason.failure.code, code);
        const result = await decision(reason.failure);
        assert.equal(result?.kind, policy.retryableCodes.includes(code) ? 'retry' : undefined);
        add(`official-other-error-and-retry-policy-preserved ${status}`);
      }
      streamError = 'unexpected-fixture';
      const unrelated = await call(fixture.ctx, 'fixture', 'session-error');
      assert.equal(unrelated.failure.code, 'PI_AI_ERROR'); assert.equal(await decision(unrelated.failure), undefined);
      add('unrelated-PI_AI_ERROR-not-corrected');
    } finally { await patch.dispose(); }
  } finally { streamError = undefined; for (const dispose of disposers) await dispose(); await fixture.close(); }
}
await test('real rc2 ASAR adapter compatibility', async () => {
try {
  for (const api of protocols) {
    const old = await setup(api);
    try {
      for (const provider of routes) {
        assert.equal((await call(old.ctx, provider, 'session-fixture-a')).kind, 'error');
        assert.notEqual(received.at(-1).identity.openCode, 'session-fixture-a');
        add(`official-unpatched-400 ${api} ${provider}`);
      }
    } finally { await old.close(); }
    const fixture = await setup(api, true, api === 'openai-responses');
    try {
      const before = fixture.adapter.current();
      const originalProfile = before.profiles.get(routes[0]);
      for (const provider of routes) {
        assert.notEqual((await call(fixture.ctx, provider, 'session-fixture-a')).kind, 'error'); wire('session-fixture-a');
        const prepared = await fixture.ctx.llm.prepareCall({ provider, model: 'mock-model', maxTokens: 16 });
        assert.notEqual((await call(fixture.ctx, provider, 'session-fixture-a', 'session-title', prepared)).kind, 'error'); wire('session-fixture-a');
        add(`main-and-prepared-title ${api} ${provider}`);
        const start = received.length;
        const reasons = await Promise.all(['session-fixture-a', 'session-fixture-b'].map(sid => call(fixture.ctx, provider, sid)));
        assert.ok(reasons.every(reason => reason.kind !== 'error'));
        assert.deepEqual(received.slice(start).map(r => r.identity.openCode).sort(), ['session-fixture-a', 'session-fixture-b']);
        for (const r of received.slice(start)) {
          assert.equal(r.identity.native, r.identity.openCode);
          const marker = typeof r.marker === 'string' ? r.marker : JSON.stringify(r.marker);
          assert.ok(marker.includes(r.identity.openCode));
        }
        add(`concurrent-isolation ${api} ${provider}`);
        const count = received.length;
        for (const sid of [undefined, '', 'bad\r\nidentity']) {
          const reason = await call(fixture.ctx, provider, sid);
          assert.equal(reason.kind, 'error'); assert.equal(reason.failure.code, 'MISSING_SESSION_ID');
        }
        assert.equal(received.length, count); add(`missing-invalid-sid-no-http ${api} ${provider}`);
      }
      assert.strictEqual(fixture.adapter.current(), before);
      assert.strictEqual(before.profiles.get(routes[0]), originalProfile);
      assert.equal(originalProfile.headers['X-OpenCode-Session'], 'stale-upper');
      assert.equal(fixture.headers['X-DeepSeek-Harness-Session-ID'], 'stale-native');
      // The control intentionally has static headers: the extension must leave them alone.
      assert.notEqual((await call(fixture.ctx, 'fixture', 'session-fixture-other')).kind, 'error');
      assert.ok(received.at(-1).identity.openCode.startsWith('stale-'));
      assert.notEqual(received.at(-1).identity.native, 'session-fixture-other');
      add(`snapshot-immutable-and-non-go-control ${api}`);
      // Capture a generation, change the next-generation source, dispatch the old call.
      const prepared = await fixture.ctx.llm.prepareCall({ provider: routes[0], model: 'mock-model', maxTokens: 16 });
      const source = fixture.adapter.config.profiles;
      const nextProfiles = new Map(source());
      nextProfiles.set(routes[0], { ...nextProfiles.get(routes[0]), headers: { 'X-Test-Preserved': 'next-generation' } });
      fixture.adapter.config.profiles = () => nextProfiles;
      assert.notStrictEqual(fixture.adapter.current(), before);
      assert.notEqual((await call(fixture.ctx, routes[0], 'session-fixture-c', 'session-title', prepared)).kind, 'error');
      wire('session-fixture-c');
      fixture.adapter.config.profiles = source;
      add(`prepared-snapshot-generation ${api}`);
      await fixture.replacePi();
      const replacement = fixture.ctx.llm.registration(routes[0]).adapter;
      assert.notStrictEqual(replacement, fixture.adapter);
      assert.notEqual((await call(fixture.ctx, routes[1], 'session-fixture-replacement')).kind, 'error'); wire('session-fixture-replacement');
      add(`new-instance-rebind ${api}`);
      await fixture.patch.dispose();
      assert.strictEqual(replacement.streamWithSnapshot, Pi.PiAiAdapter.prototype.streamWithSnapshot);
      assert.strictEqual(fixture.adapter.streamWithSnapshot, Pi.PiAiAdapter.prototype.streamWithSnapshot);
      assert.equal((await call(fixture.ctx, routes[0], 'session-fixture-rollback')).kind, 'error');
      add(`unload-restores-official-baseline ${api}`);
    } finally { await fixture.close(); }
  }
  await discoveryIntegration();
  await retryIntegration();
  evidence.status = 'PASSED'; evidence.requests = received.length;
  evidence.discoveryRequests = discoveries;
  evidence.identityCapture = received;
  console.log(`RC2_SESSION_HEADERS=PASSED checks=${evidence.cases.length} requests=${received.length} protocols=3 routes=2`);
} catch (error) {
  evidence.status = 'FAILED'; evidence.error = { name: error.name, message: error.message };
  throw error;
} finally {
  fs.writeFileSync(`${output}/test-results.json`, JSON.stringify(evidence, null, 2));
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

});
}
