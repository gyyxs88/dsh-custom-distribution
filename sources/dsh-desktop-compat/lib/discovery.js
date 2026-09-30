import { LlmError, normalizeApiKey, INVALID_CREDENTIAL_CODE, attributionHeaders } from '@deepseek-ai/dsh-llm';

const protocols = new Set(['openai-completions', 'openai-responses', 'anthropic-messages']);
const transientCodes = new Set(['EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH',
  'ENETUNREACH', 'ETIMEDOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET']);
const limit = 4 * 1024 * 1024;

// Error text alone never authorizes catalog fallback. Bound and deduplicate cause traversal.
function transient(error) {
  if (!(error instanceof TypeError)) return false;
  const queue = [error.cause], seen = new Set();
  for (let i = 0; i < queue.length && i < 64; i++) {
    const cause = queue[i];
    if (!cause || typeof cause !== 'object' || seen.has(cause)) continue;
    seen.add(cause);
    if (transientCodes.has(cause.code)) return true;
    queue.push(cause.cause);
    if (Array.isArray(cause.errors)) queue.push(...cause.errors.slice(0, 64));
  }
  return false;
}
function aborted(signal, cause) {
  if (signal?.aborted) throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause });
}
const label = (...values) => values.find(value => typeof value === 'string' && value.length > 0);
const capacity = (...values) => values.find(value => Number.isInteger(value) && value > 0);
function listing(body) {
  let rows;
  if (Array.isArray(body?.data)) rows = body.data.map(raw => ({ raw }));
  else {
    if (!body?.models || typeof body.models !== 'object' || Array.isArray(body.models)) {
      throw new LlmError('endpoint model listing has neither a data array nor a models object', 'DISCOVERY_FAILED');
    }
    rows = Object.entries(body.models).filter(([, raw]) => raw && typeof raw === 'object' && !Array.isArray(raw))
      .map(([key, raw]) => ({ key, raw }));
  }
  const models = [], seen = new Set();
  for (const { key, raw } of rows) {
    const id = label(key, raw?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const contextWindow = capacity(raw?.contextWindow, raw?.context_window, raw?.context_length, raw?.max_input_tokens, raw?.limit?.context);
    const maxTokens = capacity(raw?.maxOutputTokens, raw?.max_output_tokens, raw?.maxTokens, raw?.max_tokens, raw?.limit?.output, raw?.top_provider?.max_completion_tokens);
    const inputs = Array.isArray(raw?.architecture?.input_modalities)
      ? [...new Set(raw.architecture.input_modalities.filter(item => item === 'text' || item === 'image'))] : [];
    models.push({ id, name: label(raw?.name, raw?.display_name, raw?.displayName) ?? id,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(inputs.length ? { inputModalities: inputs } : {}) });
  }
  return models;
}
async function bounded(response) {
  const oversized = () => new LlmError(`endpoint answered with more than ${limit} bytes`, 'DISCOVERY_FAILED');
  if (Number(response.headers.get('content-length') ?? NaN) > limit) {
    await response.body?.cancel(); throw oversized();
  }
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw oversized();
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

// catalog() delegates provider-only prefetch to the original official service.
// stored() captures the official adapter's current generation once, without resolving its key.
export async function discover(request, signal, catalog, stored) {
  aborted(signal);
  if (request.baseURL === undefined || request.baseURL === '') return catalog();
  let base;
  try { base = new URL(request.baseURL); }
  catch (cause) { throw new LlmError('model discovery needs a valid absolute baseURL', 'DISCOVERY_FAILED', { cause }); }
  if (typeof request.baseURL !== 'string' || request.baseURL.trim() !== request.baseURL ||
      !['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new LlmError('model discovery needs an HTTP(S) baseURL without credentials, query or fragment', 'DISCOVERY_FAILED');
  }
  const api = request.api ?? 'openai-completions';
  if (!protocols.has(api)) {
    const models = await catalog();
    if (models.length) return models;
    throw new LlmError(`pi-ai protocol "${api}" has no readable listing`, 'DISCOVERY_UNSUPPORTED');
  }
  const profile = stored();
  const rawKey = request.apiKey ?? await profile?.resolveApiKey();
  let key;
  if (rawKey !== undefined) {
    const checked = normalizeApiKey(rawKey);
    if (!checked.ok) throw new LlmError('model discovery API key is blank or cannot be carried by HTTP headers', INVALID_CREDENTIAL_CODE);
    key = checked.value;
  }
  const prefix = request.baseURL.replace(/\/+$/, '');
  const url = api === 'anthropic-messages'
    ? `${prefix.endsWith('/v1') ? prefix.slice(0, -3) : prefix}/v1/models?limit=1000` : `${prefix}/models`;
  const headers = new Headers(profile?.headers);
  headers.set('accept', 'application/json');
  headers.set('accept-encoding', 'identity');
  if (api === 'anthropic-messages') {
    headers.set('anthropic-version', '2023-06-01');
    if (key !== undefined) headers.set('x-api-key', key);
  } else if (key !== undefined) headers.set('authorization', `Bearer ${key}`);
  for (const [name, value] of Object.entries(attributionHeaders())) headers.set(name, value);
  const fallback = async cause => {
    aborted(signal, cause);
    const models = await catalog();
    aborted(signal, cause);
    if (models.length) return models;
    throw new LlmError('endpoint discovery failed and this provider has no installed catalog', 'DISCOVERY_FAILED', { cause });
  };
  aborted(signal);
  let response;
  try { response = await fetch(url, { method: 'GET', headers, ...(signal ? { signal } : {}) }); }
  catch (cause) {
    aborted(signal, cause);
    if (transient(cause)) return fallback(cause);
    throw new LlmError('could not reach model listing endpoint', 'DISCOVERY_FAILED', { cause });
  }
  aborted(signal);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status >= 500 && response.status <= 599) return fallback();
    throw new LlmError(`model listing endpoint answered ${response.status}`, 'DISCOVERY_FAILED');
  }
  let text;
  try { text = await bounded(response); }
  catch (cause) {
    aborted(signal, cause);
    if (transient(cause)) return fallback(cause);
    throw cause;
  }
  aborted(signal);
  let body;
  try { body = JSON.parse(text); }
  catch (cause) { throw new LlmError('model listing endpoint did not answer with JSON', 'DISCOVERY_FAILED', { cause }); }
  return listing(body);
}
