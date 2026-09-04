/**
 * Answering "which models can this provider serve?" for the configuration
 * surface's "fetch available models" action.
 *
 * A route the installed pi-ai catalog ships is answered **from that catalog**,
 * with no network call at all: pi-ai's registry is the authoritative list for
 * its own providers, and it carries the capacities a listing endpoint would
 * not disclose. Only a route the catalog does not describe — a gateway, a
 * self-hosted server — is interrogated over the wire.
 *
 * Neither path is a catalog refresh. Nothing here is stored: the request
 * carries a draft the user is still editing, and the reply is candidate
 * metadata the surface offers for adoption. `settings.yaml` remains the only
 * thing that decides what a route serves.
 *
 * Only OpenAI-compatible protocols are interrogated. Their listing is the one
 * shape a gateway, a self-hosted server, and the official endpoints all agree
 * on, which is the case this action exists for; every other protocol reports
 * that it cannot be interrogated so the surface falls back to hand-entry
 * rather than guessing a response shape.
 *
 * @module dsh-llm-pi-ai/discovery
 */
import { INVALID_CREDENTIAL_CODE, LlmError, normalizeApiKey } from '@deepseek-ai/dsh-llm';
import { attributionHeaders } from '@deepseek-ai/dsh-llm';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { catalogModels, catalogProvider, MODALITIES, THINKING_LEVELS } from "./catalog.js";
/**
 * Protocols whose model listing this module can read: the two that speak
 * OpenAI's `GET /models` shape with bearer auth. Azure is absent despite its
 * OpenAI lineage — it authenticates with an `api-key` header and requires an
 * `api-version` query — and Codex authenticates through OAuth; guessing at
 * either would report an authentication failure as a provider with no models.
 * pi-ai's remaining protocols are absent for the same reason.
 */
const LISTABLE_PROTOCOLS = new Set([
    'openai-completions',
    'openai-responses',
]);
/**
 * Endpoint replies larger than this are refused. The endpoint is whatever URL
 * the user typed, so the ceiling holds on the bytes actually read rather than
 * on the length the server claims — the same two-stage shape `dsh-web-fetch`
 * uses for its own caller-supplied URLs, except that a truncated model listing
 * is not parseable, so overflow rejects instead of truncating.
 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** A positive integer field of a listing entry, or `undefined` when absent or unusable. */
function capacity(...candidates) {
    for (const candidate of candidates) {
        if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0)
            return candidate;
    }
    return undefined;
}
/** A non-empty string field of a listing entry, or `undefined`. */
function label(...candidates) {
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.length > 0)
            return candidate;
    }
    return undefined;
}
/** Normalize a listing's explicitly advertised input modalities. */
function listingInput(...candidates) {
    for (const candidate of candidates) {
        if (!Array.isArray(candidate))
            continue;
        const input = [...new Set(candidate.filter((value) => typeof value === 'string' && MODALITIES.includes(value)))];
        if (input.length > 0)
            return input;
    }
    return undefined;
}
/** Normalize explicitly advertised reasoning levels without guessing missing ones. */
function listingReasoningEfforts(...candidates) {
    for (const candidate of candidates) {
        if (candidate === false)
            return false;
        const pairs = [];
        if (Array.isArray(candidate)) {
            for (const value of candidate)
                if (typeof value === 'string')
                    pairs.push([value, value]);
        }
        else if (typeof candidate === 'object' && candidate !== null) {
            for (const [level, wire] of Object.entries(candidate)) {
                if (typeof wire === 'string' || wire === null)
                    pairs.push([level, wire]);
            }
        }
        else {
            continue;
        }
        const efforts = {};
        for (const [rawLevel, rawWire] of pairs) {
            const level = rawLevel === 'none' || rawLevel === 'disabled' ? 'off' : rawLevel;
            if (!THINKING_LEVELS.includes(level))
                continue;
            efforts[level] = level === 'off' ? null : rawWire;
        }
        if (Object.keys(efforts).some(level => level !== 'off'))
            return efforts;
    }
    return undefined;
}
/** Normalize one advertised default effort to DSH's vocabulary. */
function listingDefaultReasoningEffort(...candidates) {
    for (const candidate of candidates) {
        if (typeof candidate !== 'string')
            continue;
        const level = candidate === 'none' || candidate === 'disabled' ? 'off' : candidate;
        if (THINKING_LEVELS.includes(level))
            return level;
    }
    return undefined;
}
/** Convert an installed pi-ai model's reasoning metadata to editable settings form. */
function installedReasoningEfforts(model) {
    if (!model.reasoning)
        return false;
    const efforts = {};
    for (const level of getSupportedThinkingLevels(model)) {
        efforts[level] = level === 'off' ? null : model.thinkingLevelMap?.[level] ?? level;
    }
    return efforts;
}
/** Catalog routes whose live model directory should refresh the bundled snapshot. */
const LIVE_CATALOG_DISCOVERY_POLICIES = new Map([
    ['opencode-go', 'configured'],
    ['openrouter', 'configured-or-catalog'],
]);
/** Resolve the live listing base for one explicitly registered catalog route. */
function liveCatalogBaseURL(request) {
    if (request.provider === undefined)
        return undefined;
    const policy = LIVE_CATALOG_DISCOVERY_POLICIES.get(request.provider);
    if (policy === undefined)
        return undefined;
    if (request.baseURL !== undefined && request.baseURL.length > 0)
        return request.baseURL;
    if (policy === 'configured-or-catalog')
        return catalogProvider(request.provider)?.baseUrl;
    return undefined;
}
/** Return one installed catalog in the same editable shape as a live listing. */
function installedCatalogListing(provider) {
    if (provider === undefined)
        return undefined;
    const installed = catalogModels(provider);
    if (installed.size === 0)
        return undefined;
    return [...installed.values()].map(model => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        input: [...model.input],
        reasoningEfforts: installedReasoningEfforts(model),
    }));
}
/**
 * Join the endpoint base with the listing path. The base is treated as a
 * prefix rather than a URL to resolve against, so a deployment path such as
 * `https://gateway.example/openai/v1` keeps its segments instead of losing
 * them to `URL` resolution.
 */
function listingUrl(baseURL) {
    return `${baseURL.replace(/\/+$/, '')}/models`;
}
/**
 * Read a reply body, refusing one that outgrows the ceiling. A declared length
 * is checked first so an honest server is turned away without transferring
 * anything; the accumulated total is what actually enforces the bound, because
 * a server that under-declares (or streams) tells us nothing up front.
 */
async function readBounded(response, url) {
    const oversized = () => new LlmError(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`, 'DISCOVERY_FAILED');
    const declared = Number(response.headers.get('content-length') ?? Number.NaN);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        await response.body?.cancel();
        throw oversized();
    }
    /* v8 ignore next -- fetch always exposes a body stream on a 2xx Response; the null guard is defensive. */
    if (response.body === null)
        return '';
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            total += value.byteLength;
            if (total > MAX_RESPONSE_BYTES)
                throw oversized();
            chunks.push(value);
        }
    }
    finally {
        /* v8 ignore next 4 -- cancel() after a completed or abandoned read settles without rejecting; unobserved best-effort cleanup. */
        await reader.cancel().catch(() => {
            // Cancel after a drained read, or after this function walked away from
            // an oversized one, is cleanup; the reply is already decided either way.
        });
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(body);
}
/**
 * Read one OpenAI-compatible listing reply. Entries without a usable id are
 * skipped rather than failing the whole interrogation: a single malformed row
 * should not deny the user the rest of a working endpoint's catalog.
 */
function readListing(body) {
    const data = body?.data;
    if (!Array.isArray(data)) {
        throw new LlmError('the endpoint\'s model listing has no "data" array; enter this provider\'s models by hand', 'DISCOVERY_FAILED');
    }
    const models = [];
    for (const raw of data) {
        const entry = raw;
        const id = label(entry?.id);
        if (id === undefined)
            continue;
        const name = label(entry?.name, entry?.display_name);
        const contextWindow = capacity(entry?.context_window, entry?.context_length);
        const maxTokens = capacity(entry?.max_output_tokens, entry?.max_tokens, entry?.top_provider?.max_completion_tokens);
        const input = listingInput(entry?.architecture?.input_modalities, entry?.input_modalities);
        const reasoningEfforts = listingReasoningEfforts(entry?.reasoning_efforts, entry?.supported_reasoning_efforts, entry?.architecture?.reasoning_efforts, entry?.reasoning === false ? false : undefined);
        const reasoningRecord = typeof entry?.reasoning === 'object' && entry.reasoning !== null
            ? entry.reasoning
            : undefined;
        const advertisedDefault = listingDefaultReasoningEffort(entry?.default_reasoning_effort, reasoningRecord?.default_effort);
        const defaultReasoningEffort = typeof reasoningEfforts === 'object'
            && advertisedDefault !== undefined
            && advertisedDefault in reasoningEfforts
            ? advertisedDefault
            : undefined;
        models.push({
            id,
            ...name === undefined ? {} : { name },
            ...contextWindow === undefined ? {} : { contextWindow },
            ...maxTokens === undefined ? {} : { maxTokens },
            ...input === undefined ? {} : { input },
            ...reasoningEfforts === undefined ? {} : { reasoningEfforts },
            ...defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort },
        });
    }
    return models;
}
/**
 * Accept one probe key, or refuse it before the header is built. Without this
 * the `fetch` below would throw a ByteString `TypeError` that this function's
 * catch reports as `could not reach <url>` — blaming the network for a local,
 * deterministic fault.
 * @param raw - the key typed into the form or read from storage.
 * @returns the trimmed, usable key.
 */
function usableProbeKey(raw) {
    const checked = normalizeApiKey(raw);
    if (checked.ok)
        return checked.value;
    throw new LlmError(checked.reason === 'empty'
        ? 'this provider\'s API key is blank; enter it on the Models page, or clear it to probe unauthenticated'
        : 'this provider\'s API key contains characters no HTTP header can carry; paste the raw key only', INVALID_CREDENTIAL_CODE);
}
/**
 * Interrogate one draft provider endpoint for the models it advertises.
 * @param request - the endpoint, protocol, and one-shot credential to use.
 * @param storedProfile - Host-owned headers and lazy credential resolution for
 *   the named route. It is read only on the path that reaches the network; the
 *   credential is resolved only when the draft carries none.
 * @returns the advertised models in endpoint order.
 * @throws LlmError when the protocol has no readable listing, the endpoint
 *   refuses or fails the request, or the reply is not a model listing.
 */
export async function discoverModels(request, storedProfile) {
    const installed = installedCatalogListing(request.provider);
    const liveCatalogBase = installed === undefined ? undefined : liveCatalogBaseURL(request);
    const endpointBaseURL = installed === undefined ? request.baseURL : liveCatalogBase;
    const preferLiveCatalog = installed !== undefined && liveCatalogBase !== undefined;
    const fallback = () => preferLiveCatalog ? installed : undefined;
    if (!preferLiveCatalog && installed !== undefined)
        return installed;
    if (endpointBaseURL === undefined || endpointBaseURL.length === 0) {
        const catalogFallback = fallback();
        if (catalogFallback !== undefined)
            return catalogFallback;
        throw new LlmError(`pi-ai ships no catalog for provider "${request.provider ?? ''}", so its models can only come from its`
            + " endpoint; set a baseURL, or enter this provider's models by hand", 'DISCOVERY_FAILED');
    }
    // A draft that has not chosen a protocol yet is asked as OpenAI Chat
    // Completions: it is the shape a gateway is overwhelmingly likely to speak,
    // and the alternative — refusing until the field is filled — would withhold
    // the action from the case it exists for. The cost is a misdirected message
    // when the endpoint speaks something else (an Anthropic gateway answers 401,
    // which reads as a credential problem), and hand-entry remains the way out.
    const api = request.api ?? 'openai-completions';
    if (!LISTABLE_PROTOCOLS.has(api)) {
        const catalogFallback = fallback();
        if (catalogFallback !== undefined)
            return catalogFallback;
        throw new LlmError(`pi-ai protocol "${api}" has no model listing this build can read; enter this provider's models by hand`, 'DISCOVERY_UNSUPPORTED');
    }
    const url = listingUrl(endpointBaseURL);
    // A key typed into the form wins: it may replace the stored key that is
    // failing. The stored profile is asked past the catalog and protocol checks,
    // and its credential resolver remains lazy so a typed key cannot fail over a
    // stored credential it supersedes. A route may still authenticate through a
    // deployment-owned Authorization header when neither key exists.
    const stored = storedProfile?.();
    const supplied = request.apiKey ?? await stored?.resolveApiKey();
    const apiKey = supplied === undefined ? undefined : usableProbeKey(supplied);
    let response;
    try {
        const headers = new Headers(stored?.headers === undefined ? undefined : Object.entries(stored.headers));
        headers.set('accept', 'application/json');
        if (apiKey !== undefined)
            headers.set('authorization', `Bearer ${apiKey}`);
        for (const [name, value] of Object.entries(attributionHeaders()))
            headers.set(name, value);
        response = await fetch(url, {
            method: 'GET',
            headers,
            ...request.signal === undefined ? {} : { signal: request.signal },
        });
    }
    catch (error) {
        if (request.signal?.aborted) {
            throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error });
        }
        const catalogFallback = fallback();
        if (catalogFallback !== undefined)
            return catalogFallback;
        throw new LlmError(`could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error });
    }
    if (!response.ok) {
        const catalogFallback = fallback();
        if (response.status !== 401 && response.status !== 403 && catalogFallback !== undefined)
            return catalogFallback;
        throw new LlmError(`${url} answered ${response.status}${response.status === 401 || response.status === 403 ? '; check the API key' : ''}`, 'DISCOVERY_FAILED');
    }
    let text;
    try {
        text = await readBounded(response, url);
    }
    catch (error) {
        // Cancellation during the body read rejects with the abort reason, which
        // may be any value; the caller gets the same coded failure it would have
        // for a cancellation before the request went out.
        if (request.signal?.aborted) {
            throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error });
        }
        const catalogFallback = fallback();
        if (catalogFallback !== undefined)
            return catalogFallback;
        throw error;
    }
    let body;
    try {
        body = JSON.parse(text);
    }
    catch (error) {
        const catalogFallback = fallback();
        if (catalogFallback !== undefined)
            return catalogFallback;
        throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error });
    }
    try {
        return readListing(body);
    }
    catch (error) {
        const catalogFallback = fallback();
        if (catalogFallback !== undefined)
            return catalogFallback;
        throw error;
    }
}
//# sourceMappingURL=discovery.js.map