import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { useOfficial } from '../desktop/official-runtime.mjs';

if (!process.argv[2] || !process.argv[3]) {
  await test('Error integration requires the isolated Electron runner', { skip: true }, () => {});
} else {
const output = process.argv[3];
fs.mkdirSync(output, { recursive: true });
const { official } = useOfficial(process.argv[2]);
const load = pkg => import(pathToFileURL(`${official}@deepseek-ai/${pkg}/lib/index.js`));
const { Context } = await load('cordis');
const { default: Llm, LlmError, resolveRetryPolicy } = await load('dsh-llm');
const Native = await load('dsh-llm-deepseek');
const Account = await load('dsh-llm-deepseek-account');
const supplement = await import(pathToFileURL(process.argv[4]));
const Errors = await import(new URL('./errors.js', pathToFileURL(process.argv[4])));
const Retry = await load('dsh-llm-retry');
const evidence = { status: 'RUNNING', cases: [], requests: [], cleanup: {} }, ui = [];
const add = (label, data = {}) => { evidence.cases.push({ label, passed: true, ...data }); };
const secret = randomBytes(24).toString('hex'); // Random mock, never saved or printed.
let current = {}, uploads = 0, deletes = 0, lists = 0;
const server = createServer(async (req, res) => {
  let bytes = 0, text = '';
  for await (const part of req) { bytes += part.length; if (!req.url.includes('/files')) text += part; }
  evidence.requests.push({ method: req.method, path: req.url, bytes });
  if (req.url.includes('/files')) {
    if (req.method === 'DELETE') { deletes++; res.writeHead(204); res.end(); return; }
    if (req.method === 'GET') { lists++; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[],"has_more":false}'); return; }
    uploads++;
  }
  const mode = req.url.includes('/files') ? current.file ?? current : current;
  const headers = { 'content-type': 'application/json', 'x-request-id': 'request-mock', 'retry-after': '0.025' };
  if (mode.status) { res.writeHead(mode.status, headers); res.end(JSON.stringify({ error: mode.error ?? {} })); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const emit = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ ...data, type })}\n\n`);
  if (mode.sse) { emit('error', { error: mode.sse }); res.end(); return; }
  emit('message_start', { message: { id: 'mock', type: 'message', role: 'assistant', model: 'mock-model', content: [], usage: { input_tokens: 1, output_tokens: 0 } } });
  emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'OK' } });
  emit('content_block_stop', { index: 0 });
  emit('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } });
  emit('message_stop', {}); res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
const models = [{ id: 'mock-model', inputModalities: ['text', 'image'], contextWindow: 8192, maxTokens: 32 }];
let recover;
const effects = [];
Retry.apply({ logger: { warn() {} }, sessionProjections: { register() {}, stateOf() { return {}; } },
  on(event, callback) { assert.equal(event, 'agent/request-error'); recover = callback; return () => {}; },
  effect(fn) { effects.push(fn()); } }, {}, { random: () => 0.5 });
async function decision(failure, mode = 'normal') {
  const policy = { ...resolveRetryPolicy({ mode }, 'fixture'), initialDelayMs: 1, maxDelayMs: 1000, jitterRatio: 0 };
  const start = performance.now(); let downstream = 0;
  const result = await recover({ agent: { session: { append() {} } }, turn: 'mock-turn', step: 'mock-step', provider: 'fixture', failure,
    retryPolicy: policy, signal: AbortSignal.timeout(1000) }, async () => { downstream++; });
  return { result, elapsed: performance.now() - start, downstream };
}
function clean(failure) {
  const serialized = JSON.stringify(failure);
  assert.ok(!serialized.includes(secret)); assert.ok(!serialized.includes('Bearer')); assert.ok(!serialized.includes('userinfo'));
  assert.ok(!serialized.includes('https://')); assert.ok(!serialized.includes('cause'));
}
async function setup(account = false, early = false) {
  const ctx = new Context();
  let rejectedTokens = 0;
  ctx.provide('deepseekAccount', { resolveToken: async () => 'mock-token', rejectToken: async () => { rejectedTokens++; } });
  const runtime = ctx.plugin(Llm); await runtime;
  let patch, registration, accountPlugin, adapter;
  if (early) { patch = ctx.plugin(supplement); await patch; }
  const connection = Native.resolveAdapterOptions({ baseURL, models, maxTokens: 32, thinking: 'disabled' });
  const store = new Native.DeepSeekFileStore({ index: { get: async () => undefined } });
  const attach = () => {
    adapter = new Native.DeepSeekAdapter({ options: () => connection, resolveAuth: async () => ({ headers: { 'x-api-key': 'mock-offline' } }),
      prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
      resolveUserId: () => 'mock-user', resolveFiles: () => store });
    registration = ctx.llm.registerAdapter(['fixture'], adapter);
  };
  if (account) { accountPlugin = ctx.plugin(Account, { baseURL, models, maxTokens: 32, thinking: 'disabled' }); await accountPlugin; adapter = ctx.llm.registration('deepseek-account').adapter; }
  else attach();
  if (!early) { patch = ctx.plugin(supplement); await patch; }
  return { ctx, adapter, patch, store, connection, get rejectedTokens() { return rejectedTokens; },
    replace() { registration(); attach(); return adapter; },
    async close() { await patch.dispose(); registration?.(); await accountPlugin?.dispose(); await runtime.dispose(); } };
}
async function call(fixture, prepared, signal, messages) {
  const provider = fixture.ctx.llm.listProviders()[0].id;
  const options = { provider, model: 'mock-model', maxTokens: 16, sessionId: 'mock-session', purpose: prepared ? 'session-title' : 'agent',
    messages: messages ?? [{ role: 'user', content: [{ type: 'text', text: 'offline' }] }], signal: signal ?? AbortSignal.timeout(5000), ...(prepared?.config ?? {}) };
  const chunks = [];
  for await (const chunk of prepared ? prepared.stream(options) : fixture.ctx.llm.stream(options)) chunks.push(chunk);
  return chunks.findLast(chunk => chunk.type === 'finish').reason;
}
await test('actual native HTTP/SSE, Files, account, lifetime and official retry', async () => {
try {
  const fixture = await setup(false, true);
  try {
    const cases = [
      ['region', 403, { type: 'RegionError', message: 'Request rejected' }, 'REGION_RESTRICTED'],
      ['quota', 403, { type: 'insufficient_quota', message: 'Request rejected' }, 'QUOTA'],
      ['permission', 403, { type: 'permission_error', message: `Bearer ${secret} https://userinfo:${secret}@host/?key=${secret}` }, 'FORBIDDEN'],
      ['auth', 401, { type: 'authentication_error', message: secret }, 'AUTHENTICATION_FAILED'],
      ['invalid-key', 401, { code: 'invalid_api_key', message: secret }, 'AUTH'],
      ['rate', 429, { type: 'rate_limit_error', code: 401, message: `403 ${secret}` }, 'RATE_LIMIT'],
      ['server', 503, { type: 'api_error', message: `401 ${secret}` }, 'SERVER'],
      ['payment', 402, {}, 'QUOTA'],
      ['spend', 429, { type: 'rate_limit_error', details: { error_code: 'enforced_spend_limit_reached' } }, 'QUOTA'],
      ['budget', 403, { metadata: { limit_source: 'openrouter_guardrail_budget' } }, 'QUOTA'],
      ['in-flight', 402, { metadata: { limit_source: 'openrouter_in_flight_budget' } }, 'RATE_LIMIT'],
    ];
    for (const [label, status, error, code] of cases) {
      current = { status, error }; const before = evidence.requests.length;
      const reason = await call(fixture); assert.equal(reason.kind, 'error'); assert.equal(reason.failure.code, code, label);
      assert.equal(reason.failure.status, status); assert.equal(reason.failure.requestId, 'request-mock');
      assert.equal(reason.failure.providerRetryAfterMs, 25); assert.equal(evidence.requests.length, before + 1); clean(reason.failure);
      const retry = await decision(reason.failure);
      assert.equal(retry.result?.kind, ['RATE_LIMIT', 'SERVER'].includes(code) ? 'retry' : undefined, label);
      if (retry.result) assert.ok(retry.elapsed >= 20, 'provider delay retained by real retry hook');
      if (['region', 'quota', 'permission', 'auth', 'rate', 'server'].includes(label)) ui.push({ label, failure: reason.failure });
      const prepared = await fixture.ctx.llm.prepareCall({ provider: 'fixture', model: 'mock-model', maxTokens: 16 });
      assert.equal((await call(fixture, prepared)).failure.code, code, `prepared ${label}`);
      add(`native-HTTP-main-prepared-retry-${label}`, { code });
    }
    current = { sse: { type: 'rate_limit_error', message: 'Too many requests' } };
    assert.equal((await call(fixture)).failure.code, 'RATE_LIMIT'); add('native-SSE-known-rate-message');
    current = { sse: { type: 'permission_error', message: 'This model is not available in your country' } };
    assert.equal((await call(fixture)).failure.code, 'REGION_RESTRICTED'); add('native-SSE-exact-region-message');
    current = { sse: { type: 'permission_error', message: 'arbitrary region and country reference' } };
    assert.equal((await call(fixture)).failure.code, 'AUTHENTICATION_FAILED'); add('native-SSE-lost-type-no-invented-reason');
    const cancel = new AbortController(); cancel.abort();
    assert.equal((await call(fixture, undefined, cancel.signal)).kind, 'aborted'); add('native-cancel');
    current = {}; assert.equal((await call(fixture)).kind, 'stop'); add('native-success');

    // The real generate catch boundary with the real FilesClient upload. Its
    // request method is replaced only in this test to surface an upload error;
    // the ordinary native image path instead catches it and falls back inline.
    const originalRequest = fixture.adapter.request;
    fixture.adapter.request = async function* () {
      await this.files.client({ baseURL, headers: { 'x-api-key': 'mock-offline' } }).upload({ data: Buffer.from('mock-image'), mediaType: 'image/png', filename: 'mock.png', expiresAfterSeconds: 3600 });
    };
    for (const [type, code] of [['RegionError', 'REGION_RESTRICTED'], ['insufficient_quota', 'QUOTA']]) {
      current = { status: 403, error: { type, message: secret } };
      assert.equal((await call(fixture)).failure.code, code); add(`real-Files-upload-through-generate-canonical-${type}`);
    }
    fixture.adapter.request = originalRequest;

    const version = { variantId: 'mock-variant', attachment: { attachmentId: 'mock-attachment' }, data: Buffer.from('image'), bytes: 5, mediaType: 'image/png' };
    let reclaims = 0;
    fixture.store.reclaimOldestOwned = async () => { reclaims++; return 1; };
    current = { status: 403, error: { type: 'insufficient_quota', message: 'quota exhausted' } };
    let before = uploads;
    await assert.rejects(fixture.store.ensureUploaded(version, { baseURL, headers: {} }, fixture.connection.filePolicy, AbortSignal.timeout(2000)), { code: 'QUOTA' });
    assert.equal(uploads - before, 1); assert.equal(reclaims, 0); assert.equal(deletes, 0); assert.equal(lists, 0);
    add('billing-quota-no-reclaim-delete-list-reupload');
    current = { status: 429, error: { type: 'storage_quota_exceeded', message: 'Storage quota exceeded' } };
    before = uploads;
    await assert.rejects(fixture.store.ensureUploaded(version, { baseURL, headers: {} }, fixture.connection.filePolicy, AbortSignal.timeout(2000)), { code: 'QUOTA' });
    assert.equal(uploads - before, 2); assert.equal(reclaims, 1); add('storage-quota-retains-one-official-cleanup-retry');

    const replacement = fixture.replace();
    current = { status: 403, error: { type: 'RegionError' } };
    assert.equal((await call(fixture)).failure.code, 'REGION_RESTRICTED');
    await fixture.patch.dispose();
    assert.equal(replacement.generate, Native.DeepSeekAdapter.prototype.generate);
    assert.equal(fixture.adapter.generate, Native.DeepSeekAdapter.prototype.generate);
    assert.equal(fixture.store.client, Native.DeepSeekFileStore.prototype.client);
    assert.equal((await call(fixture)).failure.code, 'AUTH'); add('native-replacement-and-dispose');
  } finally { await fixture.close(); }
  const account = await setup(true);
  try {
    current = { status: 402, error: { type: 'insufficient_quota' } };
    assert.equal((await call(account)).failure.code, 'ACCOUNT_QUOTA'); add('real-account-wrapper-retains-account-quota');
    current = { status: 401, error: { type: 'authentication_error', message: secret } };
    assert.equal((await call(account)).failure.code, 'ACCOUNT_TOKEN_INVALID'); assert.equal(account.rejectedTokens, 1); add('real-account-wrapper-reject-token-semantics');
    current = { status: 403, error: { type: 'RegionError' } };
    assert.equal((await call(account)).failure.code, 'REGION_RESTRICTED'); add('real-account-wrapper-region');
  } finally { await account.close(); }
  for (const [type, code] of [['invalid_request_error', 'INVALID_REQUEST'], ['request_too_large', 'INVALID_REQUEST'], ['api_error', 'SERVER'], ['overloaded_error', 'SERVER']]) {
    const failure = { code: code === 'SERVER' ? 'SERVER' : 'INVALID_REQUEST', message: `${type}: reason 401 403` };
    assert.equal(Errors.correctedFailure(failure, Errors.piFacts(failure, 'provider.+'), true).code, code); add(`pi-SSE-typed-${type}`);
  }
  const normal = await decision(ui.find(row => row.label === 'quota').failure);
  assert.equal(normal.result, undefined);
  const always = await decision(ui.find(row => row.label === 'quota').failure, 'always');
  assert.equal(always.result.kind, 'retry'); assert.equal(always.downstream, 1); add('normal-permanent-stops-always-user-semantics-retained');
  evidence.status = 'PASSED';
} catch (error) {
  evidence.status = 'FAILED'; evidence.error = { name: error.name, message: error.message }; throw error;
} finally {
  for (const dispose of effects) await dispose();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  evidence.cleanup = { loopbackClosed: !server.listening, noGlobalFetchReplacement: true };
  fs.writeFileSync(path.join(output, 'error-test-results.json'), JSON.stringify(evidence, null, 2));
  fs.writeFileSync(path.join(output, 'ui-failures.json'), JSON.stringify(ui, null, 2));
}
});
}
