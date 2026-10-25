// Preloaded only in the isolated official Host consumer test.
const original = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return Promise.reject(Error('Offline installer acceptance: external fetch refused.'));
  return original(input, init);
};
