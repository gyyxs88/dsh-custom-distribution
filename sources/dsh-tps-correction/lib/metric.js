/** A receipt rate, never a model decode rate. Inputs contain metadata only. */
export const METRIC_VERSION = 1;
export const LABEL = '输出速度（估算）';
export const UNAVAILABLE = '暂无法计算';
const channels = new Set(['text', 'reasoning', 'tool-call']);
const safeCount = value => Number.isSafeInteger(value) && value >= 0;
const identity = value => typeof value === 'string' && value.trim().length > 0;
const unavailable = reason => ({ version: METRIC_VERSION, status: 'unavailable', reason, tps: null });

/**
 * Boundary contract for a future adapter with actual receipt token counters.
 * Each counter is the cumulative ALL-output-token count immediately after
 * that meaningful receipt, for exactly one attempt/provider/model. The adapter
 * must certify complete coverage, including reasoning and tool arguments.
 * Terminal usage alone, token/chunk guesses, and text lengths are NOT witnesses.
 * The first counter is subtracted: tokens already present at the first time
 * cannot be attributed to the subsequent first-to-last interval.
 */
export function estimateReceiptTps(sample) {
  if (!sample || typeof sample !== 'object') return unavailable('invalid-sample');
  const { provider, model, attemptId, status, usage, receipts, alignment } = sample;
  if (![provider, model, attemptId].every(identity)) return unavailable('missing-identity');
  if (status !== 'completed') return unavailable('attempt-not-completed');
  if (!safeCount(usage?.outputTokens) || usage.outputTokens === 0) return unavailable('missing-or-invalid-usage');
  if (alignment?.kind !== 'receipt-cumulative-output-tokens-v1' || alignment.complete !== true ||
      alignment.provider !== provider || alignment.model !== model || alignment.attemptId !== attemptId) {
    return unavailable('unproven-token-timing-alignment');
  }
  if (!Array.isArray(receipts)) return unavailable('invalid-receipts');
  const meaningful = [];
  let previousTime = -Infinity, previousCount = 0;
  for (const receipt of receipts) {
    if (!receipt || !Number.isSafeInteger(receipt.time) || receipt.time < 0 || receipt.time < previousTime ||
        !safeCount(receipt.outputTokens) || receipt.outputTokens < previousCount ||
        receipt.outputTokens > usage.outputTokens || !channels.has(receipt.channel) ||
        typeof receipt.meaningful !== 'boolean') return unavailable('invalid-receipt-boundary');
    if (!receipt.meaningful && receipt.outputTokens !== previousCount) return unavailable('tokens-without-output');
    if (receipt.meaningful && receipt.outputTokens <= previousCount) return unavailable('output-without-token-accounting');
    if (receipt.meaningful) meaningful.push(receipt);
    previousTime = receipt.time;
    previousCount = receipt.outputTokens;
  }
  if (previousCount !== usage.outputTokens) return unavailable('usage-counter-mismatch');
  if (meaningful.length < 3 || new Set(meaningful.map(r => r.time)).size < 3) return unavailable('insufficient-receipt-times');
  const first = meaningful[0], last = meaningful.at(-1);
  const milliseconds = last.time - first.time;
  if (milliseconds < 200) return unavailable('short-receipt-burst');
  // Every output channel must itself be observed across time. A long text
  // prefix must not hide one buffered reasoning/tool batch in a mixed stream.
  for (const channel of new Set(meaningful.map(r => r.channel))) {
    const times = meaningful.filter(r => r.channel === channel).map(r => r.time);
    if (new Set(times).size < 3 || times.at(-1) - times[0] < 200) return unavailable('buffered-output-channel');
  }
  if (first.outputTokens / usage.outputTokens > 0.8) return unavailable('buffered-first-receipt');
  const tokens = last.outputTokens - first.outputTokens;
  if (!safeCount(tokens) || tokens <= 0) return unavailable('empty-paired-interval');
  // Quality heuristic, not a throughput cap: reject a dominant <=200ms burst
  // even when several timestamps or a long silent gap make the full span long.
  let left = 1, windowTokens = 0, peakTokens = 0;
  for (let right = 1; right < meaningful.length; right += 1) {
    windowTokens += meaningful[right].outputTokens - meaningful[right - 1].outputTokens;
    while (meaningful[right].time - meaningful[left].time > 200) {
      windowTokens -= meaningful[left].outputTokens - meaningful[left - 1].outputTokens;
      left += 1;
    }
    peakTokens = Math.max(peakTokens, windowTokens);
  }
  if (peakTokens / tokens > 0.8) return unavailable('dominant-receipt-burst');
  return {
    version: METRIC_VERSION, status: 'estimated', reason: null,
    provider, model, attemptId, tokens, milliseconds,
    firstTime: first.time, lastTime: last.time, firstCounter: first.outputTokens, lastCounter: last.outputTokens,
    tps: tokens * 1000 / milliseconds,
  };
}

/** Latest attempt only: never pool models/providers or resurrect an older rate. */
export function currentReceiptEstimate(samples, route) {
  if (!Array.isArray(samples) || !identity(route?.provider) || !identity(route?.model)) return unavailable('missing-current-route');
  const sample = samples.findLast(s => s?.provider === route.provider && s?.model === route.model);
  return sample ? estimateReceiptTps(sample) : unavailable('no-current-route-sample');
}

/** One display value; unavailable never falls back to usage / elapsed time. */
export function formatReceiptEstimate(estimate) {
  return {
    label: LABEL,
    value: estimate?.version === METRIC_VERSION && estimate.status === 'estimated' &&
      Number.isFinite(estimate.tps) && estimate.tps > 0 ? `${estimate.tps.toFixed(1)} tok/s` : UNAVAILABLE,
  };
}
