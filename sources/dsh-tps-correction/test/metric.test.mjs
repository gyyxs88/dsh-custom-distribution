import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateReceiptTps, currentReceiptEstimate, formatReceiptEstimate } from '../lib/metric.js';

// Independent accounting oracle: six receipts each deliver 20 tokens over
// five seconds. The first 20 precede the measurement interval. Exactly
// 100 tokens arrived inside [1000,6000], so the answer is 20, not 24 TPS.
function sample(overrides = {}) {
  return {
    provider: 'fixture-provider', model: 'fixture-model', attemptId: 'attempt-2', status: 'completed',
    usage: { outputTokens: 120 },
    alignment: { kind: 'receipt-cumulative-output-tokens-v1', complete: true,
      provider: 'fixture-provider', model: 'fixture-model', attemptId: 'attempt-2' },
    receipts: [1000, 2000, 3000, 4000, 5000, 6000].map((time, i) =>
      ({ time, outputTokens: (i + 1) * 20, channel: 'text', meaningful: true })),
    ...overrides,
  };
}
const rejected = (input, reason) => {
  const estimate = estimateReceiptTps(input);
  assert.equal(estimate.status, 'unavailable');
  assert.equal(estimate.tps, null);
  if (reason) assert.equal(estimate.reason, reason);
  assert.deepEqual(formatReceiptEstimate(estimate), { label: '输出速度（估算）', value: '暂无法计算' });
};

test('long stream uses tokens received strictly after first receipt; ignores completion wait', () => {
  const input = sample({ completedTime: 999999, requestStartTime: 0 });
  const before = structuredClone(input);
  const result = estimateReceiptTps(input);
  assert.equal(result.tps, 20);
  assert.equal(result.tokens, 100);
  assert.equal(result.milliseconds, 5000);
  assert.equal(result.firstTime, 1000);
  assert.equal(result.lastTime, 6000);
  assert.deepEqual(formatReceiptEstimate(result), { label: '输出速度（估算）', value: '20.0 tok/s' });
  assert.deepEqual(input, before, 'billing and input must not be rewritten');
});

test('short reply can be measured when three accounted receipts span 500ms', () => {
  const result = estimateReceiptTps(sample({ usage: { outputTokens: 3 }, receipts: [1000, 1250, 1500].map((time, i) =>
    ({ time, outputTokens: i + 1, meaningful: true, channel: 'text' })) }));
  assert.equal(result.tps, 4); // Two tokens after the first receipt in half a second.
  assert.equal(result.tokens, 2);
});

test('a single batch or timestamp is unavailable even with positive usage', () => {
  rejected(sample({ receipts: [{ time: 1000, outputTokens: 120, channel: 'tool-call', meaningful: true }] }), 'insufficient-receipt-times');
  rejected(sample({ receipts: [20, 60, 120].map(outputTokens => ({ time: 1000, outputTokens, channel: 'text', meaningful: true })) }), 'insufficient-receipt-times');
});

test('many deltas in a 10ms burst cannot masquerade as streaming', () => {
  rejected(sample({ receipts: [1000, 1005, 1010].map((time, i) => ({ time, outputTokens: (i + 1) * 40, channel: 'tool-call', meaningful: true })) }), 'short-receipt-burst');
});

test('long silent gap plus dominant burst is unavailable even above 200ms', () => {
  rejected(sample({ receipts: [
    { time: 1000, outputTokens: 1, channel: 'text', meaningful: true },
    { time: 5000, outputTokens: 2, channel: 'text', meaningful: true },
    { time: 5001, outputTokens: 120, channel: 'text', meaningful: true },
  ] }), 'dominant-receipt-burst');
});

test('large buffered first batch cannot be hidden by later spaced crumbs', () => {
  rejected(sample({ receipts: [1000, 2000, 3000].map((time, i) => ({ time, outputTokens: [118, 119, 120][i], channel: 'text', meaningful: true })) }), 'buffered-first-receipt');
});

test('fully accounted reasoning/text/tool streams share ONE rate', () => {
  const input = sample({ usage: { outputTokens: 180 }, receipts: Array.from({ length: 9 }, (_, i) =>
    ({ time: 1000 + i * 500, outputTokens: (i + 1) * 20,
      channel: ['reasoning', 'text', 'tool-call'][i % 3], meaningful: true })) });
  const result = estimateReceiptTps(input);
  assert.equal(result.tps, 40); // 160 tokens in 4 seconds, across all three channels.
  assert.equal(result.tokens, 160);
});

test('buffered tool or reasoning tail poisons an otherwise good mixed candidate', () => {
  for (const channel of ['tool-call', 'reasoning']) {
    const input = sample();
    input.receipts.at(-1).channel = channel;
    rejected(input, 'buffered-output-channel');
  }
});

test('terminal usage and many well spaced deltas alone provide no alignment proof', () => {
  rejected(sample({ alignment: undefined }), 'unproven-token-timing-alignment');
  const input = sample();
  input.alignment.complete = false;
  rejected(input, 'unproven-token-timing-alignment');
});

test('missing, nonfinite, fractional or negative usage never falls back', () => {
  for (const outputTokens of [undefined, null, Infinity, NaN, -1, 1.5, 0]) rejected(sample({ usage: { outputTokens } }), 'missing-or-invalid-usage');
  rejected(sample({ usage: undefined }), 'missing-or-invalid-usage');
});

test('attempt identity is mandatory and retry counts cannot cross attempts', () => {
  const input = sample(); input.alignment.attemptId = 'failed-attempt-1';
  rejected(input, 'unproven-token-timing-alignment');
  rejected(sample({ attemptId: '' }), 'missing-identity');
  for (const status of ['cancelled', 'failed', 'retrying', 'running']) rejected(sample({ status }), 'attempt-not-completed');
  assert.equal(estimateReceiptTps(sample({ priorAttemptTokens: 99999, retryWait: 900000 })).tps, 20);
});

test('counter mismatch, reversals and wrong receipt units are rejected', () => {
  rejected(sample({ usage: { outputTokens: 121 } }), 'usage-counter-mismatch');
  for (const mutation of [r => { r[2].time = 500; }, r => { r[2].outputTokens = 1; },
    r => { r[2].outputTokens = 60.5; }, r => { r[2].channel = 'image'; },
    r => { r[2].time = Infinity; }, r => { delete r[2].outputTokens; }]) {
    const input = sample(); mutation(input.receipts); rejected(input, 'invalid-receipt-boundary');
  }
});

test('empty receipts do not move measurement endpoints or create stream duration', () => {
  const input = sample();
  input.receipts.unshift({ time: 0, outputTokens: 0, channel: 'text', meaningful: false });
  input.receipts.push({ time: 900000, outputTokens: 120, channel: 'text', meaningful: false });
  assert.equal(estimateReceiptTps(input).tps, 20);
  input.receipts.at(-1).outputTokens = 121; input.usage.outputTokens = 121;
  rejected(input, 'tokens-without-output');
});

test('current route and latest retry dominate; no different-model accumulation or old fallback', () => {
  const route = { provider: 'fixture-provider', model: 'fixture-model' };
  const badLatest = sample({ attemptId: 'attempt-3', status: 'cancelled' });
  const unrelated = sample({ provider: 'other-provider', model: 'other-model', attemptId: 'attempt-4' });
  assert.equal(currentReceiptEstimate([sample(), unrelated], route).tps, 20);
  assert.equal(currentReceiptEstimate([sample(), badLatest, unrelated], route).reason, 'attempt-not-completed');
  assert.equal(currentReceiptEstimate([sample()], { provider: 'other', model: route.model }).tps, null);
});

test('history JSON reload yields identical values; rebasing times changes no rate', () => {
  const input = sample();
  const result = estimateReceiptTps(input);
  assert.deepEqual(estimateReceiptTps(JSON.parse(JSON.stringify(input))), result);
  for (const receipt of input.receipts) receipt.time += 1000000;
  assert.equal(estimateReceiptTps(input).tps, result.tps);
});

test('presentation accepts only the metric version and has no second speed', () => {
  for (const bad of [undefined, { status: 'estimated', tps: 999 }, { version: 1, status: 'estimated', tps: Infinity },
    { version: 1, status: 'unavailable', tps: 999 }]) assert.equal(formatReceiptEstimate(bad).value, '暂无法计算');
});

