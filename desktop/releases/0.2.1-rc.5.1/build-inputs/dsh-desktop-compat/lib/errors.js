import { LlmError } from '@deepseek-ai/dsh-llm';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const statusOf = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
const token = value => typeof value === 'string' ? value.toLowerCase() : '';
const regions = new Set(['regionerror', 'region_restricted', 'unsupported_country_region_territory', 'country_not_supported', 'unsupported_country']);
const quotas = new Set(['insufficient_quota', 'insufficient_balance', 'insufficient_credit', 'insufficient_credits', 'quota_exceeded', 'credit_balance_exhausted', 'billing_hard_limit', 'billing_hard_limit_reached', 'enforced_spend_limit_reached', 'payment_required']);
const budgets = new Set(['openrouter_guardrail_budget', 'openrouter_workspace_budget', 'openrouter_key_limit', 'openrouter_credits']);
const rates = new Set(['rate_limit_error', 'rate_limit_exceeded', 'too_many_requests']);
const invalidKeys = new Set(['invalid_api_key', 'invalid_key', 'invalid_x_api_key']);
const permissions = new Set(['permission_error', 'permission_denied', 'access_denied', 'forbidden']);
const storageQuotas = new Set(['storage_quota_exceeded', 'storage_limit_exceeded', 'file_count_limit_exceeded', 'too_many_files']);
const canonicalFailures = new WeakSet();
const messages = {
  REGION_RESTRICTED: '该模型在当前地区不可用，请手动切换其他模型。',
  QUOTA: '当前请求的额度、余额或支出上限不足，请检查服务商的账单与预算设置。',
  ACCOUNT_QUOTA: '当前账号的额度或支出上限不足，请检查账号用量与预算。',
  FORBIDDEN: '服务商拒绝访问，请检查模型权限、组织策略或访问限制。',
  AUTHENTICATION_FAILED: '身份验证未通过，请检查登录状态、凭据和服务商的访问设置。',
  AUTH: 'API 密钥无效，请检查服务商的密钥设置。',
  RATE_LIMIT: '请求暂时受限，请稍后重试。',
  SERVER: '服务商暂时不可用，请稍后重试。',
  TIMEOUT: '模型请求超时，请稍后重试。',
  TRANSPORT: '模型连接中断，请稍后重试。',
  ACCOUNT_TOKEN_INVALID: '账号登录状态已失效，请重新登录。',
  ACCOUNT_SIGN_IN_REQUIRED: '请先登录账号后重试。',
  ACCOUNT_SIGNED_OUT: '账号已退出，请重新登录。',
  ABORTED: '请求已取消。',
  INVALID_REQUEST: '服务商无法接受此请求，请检查请求参数。',
  CONTEXT_WINDOW_EXCEEDED: '请求内容超出模型的上下文容量，请缩短内容后重试。',
};

function json(text) {
  if (typeof text !== 'string' || text.length > 65536) return;
  try { const value = JSON.parse(text); return object(value) ? value : undefined; } catch { /* No partial JSON or prose scanning. */ }
}
function detailOf(raw) {
  let detail = object(raw) ? raw : {};
  for (let i = 0; i < 3 && object(detail.error); i++) detail = detail.error;
  return detail;
}

// These are the three reviewed SDK error envelopes, anchored to the entire message.
// Numeric provider error.code and numbers in prose are never HTTP statuses.
export function piFacts(failure, provider) {
  const text = failure.message ?? '';
  const escaped = String(provider).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const response = new RegExp(`^${escaped} API error \\((\\d{3})\\):\\s*([\\s\\S]*)$`).exec(text);
  const sdk = response ?? /^(\d{3})(?::\s*|\s+)([\s\S]*)$/.exec(text);
  let raw = json(sdk?.[2] ?? text);
  if (!raw && response) {
    // Responses can append the SDK's own "status JSON" diagnostic when the
    // top error lacks a message. The inner status must agree with the outer.
    const nested = /^(\d{3})(?::\s*|\s+)([\s\S]*)$/.exec(response[2]);
    if (nested?.[1] === response[1]) raw = json(nested[2]);
  }
  if (!raw) {
    // Responses SSE retains a typed prefix. Chat SSE can retain only its message.
    const typed = /^([a-zA-Z_]+): ([\s\S]*)$/.exec(text);
    raw = typed ? { type: typed[1], message: typed[2] } : { message: sdk?.[2] ?? text };
  }
  return { status: statusOf(failure.status) ?? statusOf(Number(sdk?.[1])), raw };
}

function codeOf(failure, { status, raw }, pi) {
  const detail = detailOf(raw);
  const types = [detail.type, detail.code, detail.details?.error_code].map(token);
  const has = set => types.some(value => set.has(value));
  const message = typeof detail.message === 'string' ? detail.message.trim() : '';
  if (failure.code === 'ABORTED' || failure.code?.startsWith('ACCOUNT_') && failure.code !== 'ACCOUNT_QUOTA') return failure.code;
  if (status === 401) return has(invalidKeys) || /^(?:Invalid API key|Incorrect API key provided)\.?$/i.test(message) ? 'AUTH' : 'AUTHENTICATION_FAILED';
  if (status >= 500) return 'SERVER';
  if (regions.has(token(detail.type)) || has(regions) || /^This model is not available in your country\.?$/i.test(message)) return 'REGION_RESTRICTED';
  // OpenRouter explicitly documents this 402 as transient, before generic payment/quota.
  if (detail.metadata?.limit_source === 'openrouter_in_flight_budget') return 'RATE_LIMIT';
  if (has(quotas) || budgets.has(detail.metadata?.limit_source) || status === 402 ||
      has(storageQuotas) ||
      /^(?:Insufficient (?:balance|credits?)|You exceeded your current quota, please check your plan and billing details\.)$/i.test(message)) return 'QUOTA';
  if (has(rates) || status === 429 || /^(?:Too many requests|Rate limit (?:reached|exceeded))\.?$/i.test(message)) return 'RATE_LIMIT';
  if (has(permissions) || status === 403) return 'FORBIDDEN';
  if (has(invalidKeys)) return 'AUTH';
  if (types.some(type => ['api_error', 'overloaded_error', 'server_error'].includes(type))) return 'SERVER';
  if (types.some(type => ['invalid_request_error', 'request_too_large', 'request_too_large_error'].includes(type))) return 'INVALID_REQUEST';
  if (types.includes('authentication_error') || !pi && failure.code === 'AUTH') return 'AUTHENTICATION_FAILED';
  if (pi && failure.code === 'AUTH') return 'PI_AI_ERROR';
  if (status === 400 || status === 413) return 'INVALID_REQUEST';
  if (pi && failure.code === 'PI_AI_ERROR' && /\bnetwork_error\b/i.test(message)) return 'TRANSPORT';
  // Do not keep classifications created solely by pi-ai's arbitrary-number regex.
  if (pi && ['RATE_LIMIT', 'SERVER', 'INVALID_REQUEST', 'QUOTA'].includes(failure.code)) return 'PI_AI_ERROR';
  return failure.code;
}

function safeFacts(failure) {
  return {
    ...(statusOf(failure.status) === undefined ? {} : { status: failure.status }),
    ...(typeof failure.requestId === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(failure.requestId) ? { requestId: failure.requestId } : {}),
    ...(Number.isFinite(failure.providerRetryAfterMs) && failure.providerRetryAfterMs > 0 ? { providerRetryAfterMs: failure.providerRetryAfterMs } : {}),
    ...(Number.isSafeInteger(failure.offloadImages) && failure.offloadImages > 0 ? { offloadImages: failure.offloadImages } : {}),
  };
}

function retryAfter(value) {
  if (typeof value !== 'string') return;
  const ms = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

export function correctedFailure(failure, facts, pi = false) {
  if (canonicalFailures.has(failure)) return failure;
  const code = codeOf(failure, facts, pi);
  const delay = retryAfter(detailOf(facts.raw).metadata?.headers?.['Retry-After'] ?? detailOf(facts.raw).metadata?.headers?.['retry-after']);
  const corrected = Object.freeze({ ...(delay === undefined ? {} : { providerRetryAfterMs: delay }), ...safeFacts(failure), ...(facts.status === undefined ? {} : { status: facts.status }),
    code: code === 'QUOTA' && failure.code === 'ACCOUNT_QUOTA' ? 'ACCOUNT_QUOTA' : code,
    // Fixed summaries intentionally exclude raw body, metadata, URL and cause.
    message: messages[code] ?? '模型请求失败，请检查请求与服务商状态后重试。' });
  canonicalFailures.add(corrected);
  return corrected;
}

export function correctedChunk(chunk, provider) {
  if (chunk.type !== 'finish' || !['error', 'aborted'].includes(chunk.reason?.kind) || !chunk.reason.failure) return chunk;
  const failure = chunk.reason.failure;
  return { ...chunk, reason: { ...chunk.reason, failure: correctedFailure(failure, piFacts(failure, provider), true) } };
}

export function nativeFacts(error) {
  const failure = error.failure;
  let raw;
  // Account wrappers retain the original LlmError as cause. Only this reviewed
  // chain and complete JSON from its native HTTP cause are classification inputs.
  let current = error;
  for (let i = 0; i < 4 && current instanceof LlmError; i++) {
    if (current.cause instanceof LlmError) current = current.cause;
    else { if (current.cause instanceof Error) raw = json(current.cause.message); break; }
  }
  if (!raw && error.name === 'DeepSeekFilesError' && typeof error.detail === 'string') {
    const fields = error.detail.split(' ');
    raw = { code: fields[0], type: fields[1], message: failure.message };
  }
  return { status: statusOf(failure.status), raw: raw ?? { message: failure.message } };
}

export function correctedError(error, signal, facts) {
  if (!(error instanceof LlmError)) return new LlmError(signal?.aborted ? messages.ABORTED : '模型请求失败，请检查请求与服务商状态后重试。', signal?.aborted ? 'ABORTED' : 'UNKNOWN');
  if (signal?.aborted || error.code === 'ABORTED') return new LlmError(messages.ABORTED, 'ABORTED', safeFacts(error.failure));
  const failure = correctedFailure(error.failure, facts ?? nativeFacts(error));
  return errorWithFailure(failure);
}

function errorWithFailure(failure) {
  const error = new LlmError(failure.message, failure.code, failure);
  canonicalFailures.add(error.failure);
  return error;
}

async function errorBody(response) {
  const reader = response.clone().body?.getReader();
  if (!reader) return;
  let size = 0; const chunks = [];
  try {
    while (true) {
      const item = await reader.read(); if (item.done) return json(Buffer.concat(chunks).toString('utf8'));
      size += item.value.length; if (size > 65536) return;
      chunks.push(Buffer.from(item.value));
    }
  } catch { /* Original request retains body/abort/transport semantics. */ }
  finally { void reader.cancel().catch(() => {}); }
}

// A per-client facade captures only unsuccessful responses through the client's
// existing injectable transport. It never replaces fetch or a prototype.
export function filesClient(client) {
  const facade = Object.create(client);
  facade.request = async function(path, init, signal) {
    let facts, response;
    const request = Object.create(client);
    request.fetchImpl = async (...args) => {
      response = await client.fetchImpl(...args);
      if (!response.ok) facts = { status: response.status, raw: await errorBody(response) };
      return response;
    };
    try { return await client.request.call(request, path, init, signal); }
    catch (error) {
      if (!(error instanceof LlmError) || signal?.aborted) throw error;
      const headerDelay = retryAfter(response?.headers.get('retry-after'));
      const requestId = response?.headers.get('request-id') ?? response?.headers.get('x-request-id') ?? response?.headers.get('x-deepseek-request-id');
      const failure = correctedFailure({ ...error.failure, ...(headerDelay === undefined ? {} : { providerRetryAfterMs: headerDelay }),
        ...(requestId ? { requestId } : {}) }, facts ?? nativeFacts(error));
      const detail = detailOf(facts?.raw);
      const storage = [detail.code, detail.type].some(value => storageQuotas.has(token(value))) ||
        /^(?:Storage quota exceeded|Stored files quota exceeded|File count limit exceeded|Too many files)\.?$/i.test(detail.message ?? '');
      const billing = [detail.code, detail.type, detail.details?.error_code].some(value => quotas.has(token(value))) ||
        budgets.has(detail.metadata?.limit_source) || facts?.status === 402;
      if (storage && !billing && !['AUTH', 'AUTHENTICATION_FAILED', 'FORBIDDEN', 'REGION_RESTRICTED'].includes(failure.code)) {
        // Only proven storage/file-count exhaustion may enter official cleanup.
        error.code = failure.code; error.message = failure.message; error.failure = failure;
        throw error;
      }
      throw errorWithFailure(failure);
    }
  };
  return facade;
}
