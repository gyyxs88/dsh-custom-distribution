import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import { LlmError } from '@deepseek-ai/dsh-llm';
import { createRequire } from 'node:module';
import { discover } from './discovery.js';
import { assertOfficial } from './contract.js';

const require = createRequire(import.meta.url);
const versions = ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-llm-pi-ai'].map(pkg => require(`${pkg}/package.json`).version);
export const name = 'dsh-desktop-compat';
export const inject = ['llm'];
const routes = new Set(['opencode-go', 'opencode-go-response']);
const identityHeaders = new Set(['x-opencode-session', 'x-deepseek-harness-session-id']);
const owner = Symbol.for('dsh-desktop-compat.owner');
const oldOwner = Symbol.for('dsh-desktop-opencode-session.owner');

function scopedSnapshot(snapshot, provider, sessionId) {
  if (typeof sessionId !== 'string' || !/^[\x21-\x7e]+$/.test(sessionId)) {
    throw new LlmError('OpenCode Go requires this request\'s valid DSH sessionId', 'MISSING_SESSION_ID');
  }
  const profile = snapshot.profiles.get(provider);
  if (!profile) throw new LlmError('OpenCode Go profile is absent from captured snapshot', 'NO_ADAPTER');
  const headers = Object.fromEntries(Object.entries(profile.headers ?? {}).filter(([key]) => !identityHeaders.has(key.toLowerCase())));
  headers['x-opencode-session'] = sessionId;
  headers['x-deepseek-harness-session-id'] = sessionId;
  const profiles = new Map(snapshot.profiles);
  profiles.set(provider, { ...profile, headers });
  return { ...snapshot, profiles };
}
function corrected(chunk) {
  const failure = chunk.type === 'finish' && chunk.reason?.kind === 'error' ? chunk.reason.failure : undefined;
  if (failure?.code !== 'PI_AI_ERROR' || !/\bnetwork_error\b/i.test(failure.message ?? '')) return chunk;
  return { ...chunk, reason: { ...chunk.reason, failure: { ...failure, code: 'TRANSPORT' } } };
}
export function apply(ctx) {
  assertOfficial();
  const llm = ctx.llm;
  if (versions.some(version => version !== '0.2.0-rc.2') ||
      require('@deepseek-ai/cordis/package.json').version !== '4.0.4' ||
      ['registration', 'listProviders', 'listConfigurableProviders', 'discoverModels'].some(method => typeof llm[method] !== 'function') ||
      ['current', 'profileOf', 'modelOf', 'stream', 'prepareCall', 'streamWithSnapshot'].some(method => typeof PiAiAdapter.prototype[method] !== 'function')) {
    throw new LlmError('Desktop compatibility supplement supports the verified official rc.2 shape only', 'UNSUPPORTED_ADAPTER');
  }
  if (llm[owner]) throw new LlmError('Desktop compatibility supplement already attached', 'DUPLICATE_SUPPLEMENT');
  const installed = new Map();
  const restore = () => {
    for (const [target, { method, descriptor, wrapper }] of installed) {
      // Cordis service access binds functions to the caller; inspect the raw descriptor.
      if (Object.getOwnPropertyDescriptor(target, method)?.value === wrapper) {
        if (descriptor) Object.defineProperty(target, method, descriptor);
        else Reflect.deleteProperty(target, method);
      }
      if (Object.getOwnPropertyDescriptor(target, owner)?.value === wrapper) Reflect.deleteProperty(target, owner);
    }
    installed.clear();
  };
  const wrap = (target, method, wrapper) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, method);
    target[method] = wrapper;
    target[owner] = wrapper;
    installed.set(target, { method, descriptor, wrapper });
  };
  ctx.effect(() => restore);
  const attach = () => {
    const adapters = new Set(llm.listProviders().map(entry => llm.registration(entry.id).adapter));
    for (const provider of routes) {
      if (llm.listProviders().some(entry => entry.id === provider) && !(llm.registration(provider).adapter instanceof PiAiAdapter)) {
        throw new LlmError('OpenCode Go requires the official rc.2 PiAiAdapter', 'UNSUPPORTED_ADAPTER');
      }
    }
    for (const adapter of adapters) {
      if (!(adapter instanceof PiAiAdapter)) continue;
      if (installed.has(adapter)) continue;
      if (adapter[oldOwner] || adapter[owner]) throw new LlmError('Remove the old session supplement before enabling desktop compatibility', 'DUPLICATE_SUPPLEMENT');
      if (typeof adapter.config?.resolveApiKey !== 'function' || typeof adapter.config?.profiles !== 'function' ||
          !(adapter.current()?.profiles instanceof Map) || !adapter.current()?.models) {
        throw new LlmError('Unsupported rc.2 snapshot or credential boundary', 'UNSUPPORTED_ADAPTER');
      }
      const original = adapter.streamWithSnapshot;
      wrap(adapter, 'streamWithSnapshot', function(options, snapshot) {
        const self = this;
        return (async function* () {
          if (!(snapshot?.profiles instanceof Map) || !snapshot.models) throw new LlmError('Unsupported rc.2 snapshot', 'UNSUPPORTED_ADAPTER');
          const scoped = routes.has(options.provider) ? scopedSnapshot(snapshot, options.provider, options.sessionId) : snapshot;
          for await (const chunk of original.call(self, options, scoped)) yield corrected(chunk);
        })();
      });
    }
  };
  const originalDiscovery = llm.discoverModels;
  wrap(llm, 'discoverModels', async function(settingsNs, request, signal) {
    // The standard official namespace owns new drafts as well as configured routes.
    if (settingsNs !== 'llm-pi-ai') return originalDiscovery.call(this, settingsNs, request, signal);
    const catalog = async () => {
      if (request.provider === undefined) return [];
      try { return await originalDiscovery.call(this, settingsNs, { provider: request.provider }, signal); }
      catch (error) {
        if (error instanceof LlmError && error.code === 'DISCOVERY_FAILED' &&
            error.message.startsWith('pi-ai ships no catalog for provider ')) return [];
        throw error;
      }
    };
    const stored = () => {
      if (!llm.listProviders().some(entry => entry.id === request.provider)) return undefined;
      const adapter = llm.registration(request.provider).adapter;
      if (!(adapter instanceof PiAiAdapter)) return undefined;
      const snapshot = adapter.current(), profile = snapshot.profiles.get(request.provider);
      return profile ? { headers: profile.headers, resolveApiKey: () => adapter.config.resolveApiKey(request.provider, profile) } : undefined;
    };
    const models = await discover(request, signal, catalog, stored);
    if (!models.length && (request.baseURL === undefined || request.baseURL === '')) {
      // Preserve the official no-catalog diagnostic on provider-only prefetch.
      return originalDiscovery.call(this, settingsNs, request, signal);
    }
    return models;
  });
  ctx.on('llm/adapters-updated', attach);
  attach();
}
