import test from 'node:test';
import assert from 'node:assert/strict';
import { expandAssistantStream } from '../../../../sdk/official-0.2.0-rc.2/node_modules/@deepseek-ai/dsh-llm/lib/types/assistant-stream.js';
import { inspectRc2Attempt } from '../lib/rc2.js';

const input = stream => ({ provider: 'fixture', model: 'fixture-model', attemptId: 'one', status: 'completed',
  usage: { outputTokens: 1000 }, stream });
const inspect = value => inspectRc2Attempt(value, expandAssistantStream);
const packed = (type = 'text-chunks') => ({ type, index: 0, time0: 1000, dt: [1000, 1000], texts: ['a', 'b', 'c'] });

test('actual official packed reader reconstructs every dt, including empty members', () => {
  const stream = [{ type: 'text-chunks', index: 0, time0: 100, dt: [400, 100, 300, 500], texts: ['', 'a', '', 'b', 'c'] }];
  const result = inspect(input(stream));
  assert.deepEqual([result.metadata.firstTime, result.metadata.lastTime, result.metadata.receiptCount], [500, 1400, 3]);
  assert.equal(result.metadata.streamMilliseconds, 900);
  assert.equal(result.estimate.reason, 'unproven-token-timing-alignment');
});

test('raw, packed and multiple packed runs agree after history reload', () => {
  const run = input([packed()]);
  const raw = input(expandAssistantStream(run.stream).map(({ time, chunk }) => ({ type: 'chunk', time, chunk })));
  const runs = input([{ ...packed(), dt: [1000], texts: ['a', 'b'] }, { ...packed(), time0: 3000, dt: [], texts: ['c'] }]);
  assert.deepEqual(inspect(run), inspect(raw));
  assert.deepEqual(inspect(run), inspect(runs));
  assert.deepEqual(inspect(run), inspect(JSON.parse(JSON.stringify(run))));
});

test('long native rc.2 streams have timing but no aligned receipt token counters', () => {
  const value = input([packed()]);
  const original = structuredClone(value);
  const result = inspect(value);
  assert.equal(result.metadata.distinctTimes, 3);
  assert.equal(result.metadata.hasReceiptTokenCounters, false);
  assert.equal(result.estimate.tps, null);
  assert.equal(result.estimate.reason, 'unproven-token-timing-alignment');
  assert.deepEqual(value, original);
});

test('single tool batch and many deltas in a short tool burst are unavailable', () => {
  const tool = { type: 'tool-call-chunks', time0: 1000, index: 0, id: 'call', name: 'synthetic', dt: [], args: ['{}'] };
  assert.equal(inspect(input([tool])).estimate.reason, 'insufficient-receipt-times');
  assert.equal(inspect(input([{ ...tool, dt: [5, 5], args: ['{', 'x', '}'] }])).estimate.reason, 'short-receipt-burst');
});

test('mixed reasoning/text/tool metadata includes all meaningful channels and no bodies', () => {
  const value = input([
    packed('reasoning-chunks'),
    { ...packed(), time0: 4000, texts: ['private-fixture-text', 'e', 'f'] },
    { type: 'tool-call-chunks', time0: 7000, index: 2, id: 'call', name: 'synthetic', dt: [1000, 1000], args: ['{', 'private-fixture-args', '}'] },
  ]);
  const result = inspect(value);
  assert.deepEqual(result.metadata.channels, ['reasoning', 'text', 'tool-call']);
  assert.equal(result.metadata.receiptCount, 9);
  assert.doesNotMatch(JSON.stringify(result), /private-fixture|synthetic|texts|args/);
  assert.equal(result.estimate.tps, null);
});

test('malformed packed dt, reversed time and missing usage stay unavailable', () => {
  assert.equal(inspect(input([{ ...packed(), dt: [] }])).estimate.reason, 'invalid-stream');
  assert.equal(inspect(input([{ ...packed(), dt: [-1, 1000] }])).estimate.reason, 'invalid-stream-time');
  assert.equal(inspect({ ...input([packed()]), usage: undefined }).estimate.reason, 'missing-or-invalid-usage');
});

test('retry/partial cancellation never borrows a prior attempt usage or interval', () => {
  for (const status of ['cancelled', 'failed', 'running']) assert.equal(inspect({ ...input([packed()]), status }).estimate.reason, 'attempt-not-completed');
  const success = inspect(input([{ ...packed(), time0: 20000 }]));
  assert.equal(success.metadata.firstTime, 20000);
  assert.equal(success.metadata.lastTime, 22000);
  assert.equal(success.estimate.tps, null);
});
