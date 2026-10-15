import { estimateReceiptTps } from './metric.js';

const identity = value => typeof value === 'string' && value.trim().length > 0;
const failure = reason => ({ version: 1, status: 'unavailable', reason, tps: null });

/**
 * Use rc.2's PUBLIC expandAssistantStream as the reader, injected by the caller.
 * Read strings transiently to decide nonempty output, then retain only counts,
 * times, channels and route identity. No message text or tool arguments escape.
 * This adapter NEVER fabricates receipt token counters from terminal usage.
 */
export function inspectRc2Attempt(input, expandAssistantStream) {
  const { provider, model, attemptId, status = 'completed', stream, usage } = input ?? {};
  let expanded;
  try {
    if (!Array.isArray(stream) || typeof expandAssistantStream !== 'function') throw Error('missing stream reader');
    expanded = expandAssistantStream(stream);
  } catch {
    return { estimate: failure('invalid-stream'), metadata: null };
  }
  const receipts = [];
  let previous = -Infinity;
  for (const entry of expanded) {
    if (!Number.isSafeInteger(entry.time) || entry.time < 0 || entry.time < previous) {
      return { estimate: failure('invalid-stream-time'), metadata: null };
    }
    previous = entry.time;
    const c = entry.chunk;
    let channel;
    if ((c.type === 'text-delta' || c.type === 'reasoning-delta') && c.text !== '') {
      channel = c.type === 'text-delta' ? 'text' : 'reasoning';
    } else if (c.type === 'tool-call-delta' && (c.argumentsDelta !== '' || (typeof c.name === 'string' && c.name !== ''))) {
      channel = 'tool-call';
    } else if (c.type === 'block-end' && c.block?.type && !['text', 'reasoning', 'tool-call'].includes(c.block.type)) {
      return { estimate: failure('unsupported-output-channel'), metadata: null };
    }
    if (channel) receipts.push({ time: entry.time, channel });
  }
  const metadata = {
    provider: identity(provider) ? provider : null,
    model: identity(model) ? model : null,
    attemptId: identity(attemptId) ? attemptId : null,
    receiptCount: receipts.length,
    distinctTimes: new Set(receipts.map(r => r.time)).size,
    firstTime: receipts[0]?.time ?? null,
    lastTime: receipts.at(-1)?.time ?? null,
    streamMilliseconds: receipts.length ? receipts.at(-1).time - receipts[0].time : null,
    channels: [...new Set(receipts.map(r => r.channel))],
    outputTokens: Number.isSafeInteger(usage?.outputTokens) && usage.outputTokens >= 0 ? usage.outputTokens : null,
    hasReceiptTokenCounters: false,
  };
  if (status !== 'completed') return { estimate: failure('attempt-not-completed'), metadata };
  if (metadata.distinctTimes < 3) return { estimate: failure('insufficient-receipt-times'), metadata };
  if (metadata.streamMilliseconds < 200) return { estimate: failure('short-receipt-burst'), metadata };
  return {
    estimate: estimateReceiptTps({ provider, model, attemptId, status, usage, receipts }),
    metadata,
  };
}
