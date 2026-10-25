/** Usage-calibrated receive estimate. This is NOT a server decode measurement. */
export const STREAM_METRIC_VERSION = 2;
export const STREAM_LABEL = '输出速度（估算）';
export const STREAM_UNAVAILABLE = '暂无法计算';
const unavailable = reason => ({ version: 2, status: 'unavailable', reason, tps: null });
const validIdentity = value => typeof value === 'string' && value.trim().length > 0;
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) :
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

/** Packed dt includes empty fragments; return metadata only, never output text. */
export function receiptMetadata(stream, content) {
  if (!Array.isArray(stream)) throw Error('missing-stream');
  const receipts = [], blocks = new Map();
  let previousTime = -Infinity;
  function read(time, chunk) {
    if (!Number.isSafeInteger(time) || time < 0 || time < previousTime) throw Error('invalid-stream-time');
    previousTime = time;
    const c = chunk;
    if (!c || typeof c.type !== 'string') throw Error('invalid-stream-chunk');
    const channel = c.type === 'text-delta' ? 'text' : c.type === 'reasoning-delta' ? 'reasoning' :
      c.type === 'tool-call-delta' ? 'tool-call' : null;
    if (!channel) return;
    if (!Number.isSafeInteger(c.index) || c.index < 0) throw Error('invalid-block-index');
    let block = blocks.get(c.index);
    if (!block) { block = { channel, text: '', name: '', id: '', frames: [] }; blocks.set(c.index, block); }
    if (block.channel !== channel) throw Error('conflicting-output-channel');
    const text = channel === 'tool-call' ? c.argumentsDelta : c.text;
    if (typeof text !== 'string') throw Error('invalid-delta-text');
    block.text += text;
    if (text !== '') block.frames.push({ time, text });
    if (channel === 'tool-call') {
      if (typeof c.id !== 'string' || (block.id && c.id && block.id !== c.id)) throw Error('conflicting-tool-call');
      block.id ||= c.id;
      if (c.name !== undefined) {
        if (typeof c.name !== 'string' || (block.name && c.name && block.name !== c.name)) throw Error('conflicting-tool-name');
        block.name ||= c.name;
      }
    }
  }
  for (const record of stream) {
    if (!record || typeof record !== 'object') throw Error('invalid-stream-record');
    if (record.type === 'chunk') { read(record.time, record.chunk); continue; }
    const field = record.type === 'tool-call-chunks' ? 'args' : 'texts';
    if (!['text-chunks', 'reasoning-chunks', 'tool-call-chunks'].includes(record.type) ||
        !Array.isArray(record[field]) || record[field].length === 0 || !Array.isArray(record.dt) ||
        record.dt.length !== record[field].length - 1) throw Error('invalid-packed-stream');
    let time = record.time0;
    for (let i = 0; i < record[field].length; i++) {
      if (i) { if (!Number.isSafeInteger(record.dt[i - 1])) throw Error('invalid-packed-time'); time += record.dt[i - 1]; }
      read(time, record.type === 'tool-call-chunks' ? { type: 'tool-call-delta', index: record.index, id: record.id,
        ...(record.name === undefined ? {} : { name: record.name }), argumentsDelta: record.args[i] } :
        { type: record.type === 'text-chunks' ? 'text-delta' : 'reasoning-delta', index: record.index, text: record.texts[i] });
    }
  }
  // Compare final content with accumulated deltas. End snapshots must not add
  // buffered/unobserved text or arguments to an otherwise long text stream.
  if (content !== undefined) {
    if (!Array.isArray(content)) throw Error('invalid-final-content');
    const actual = [...blocks.values()].filter(b => b.text !== '' || b.name !== '');
    const final = content.filter(b => (b.type !== 'text' && b.type !== 'reasoning') || b.text !== '');
    if (actual.length !== final.length) throw Error('unobserved-final-content');
    for (let i = 0; i < actual.length; i++) {
      const a = actual[i], b = final[i];
      if (a.channel !== b.type) throw Error('unobserved-final-channel');
      if (b.type === 'tool-call') {
        if (a.name !== b.name || !a.text || JSON.stringify(canonical(JSON.parse(a.text))) !== JSON.stringify(canonical(typeof b.arguments === 'string' ? JSON.parse(b.arguments) : b.arguments))) {
          throw Error('unobserved-final-tool-content');
        }
      } else if (a.text !== b.text) throw Error('unobserved-final-content');
    }
  }
  const batches = new Map();
  function add(time, channel) {
    const key = `${time}:${channel}`;
    let row = batches.get(key);
    if (!row) batches.set(key, row = { time, units: 0, channel });
    row.units++;
  }
  for (const block of blocks.values()) {
    let pending = null;
    for (const frame of block.frames) for (let i = 0; i < frame.text.length; i++) {
      const code = frame.text.charCodeAt(i);
      if (pending !== null) {
        if (code >= 0xdc00 && code <= 0xdfff) { add(frame.time, block.channel); pending = null; continue; }
        add(pending, block.channel); pending = null;
      }
      if (code >= 0xd800 && code <= 0xdbff) pending = frame.time;
      else add(frame.time, block.channel);
    }
    if (pending !== null) add(pending, block.channel);
  }
  receipts.push(...[...batches.values()].sort((a, b) => a.time - b.time));
  return { receipts, units: receipts.reduce((n, r) => n + r.units, 0), channels: [...new Set(receipts.map(r => r.channel))] };
}

/** Calibrate token allocation by final attempt usage, proportional to content units. */
export function estimateStreamMetadata(sample) {
  if (!sample || ![sample.provider, sample.model, sample.attemptId].every(validIdentity)) return unavailable('missing-identity');
  if (sample.status !== 'completed') return unavailable('attempt-not-completed');
  const outputTokens = sample.usage?.outputTokens;
  if (!Number.isSafeInteger(outputTokens) || outputTokens <= 0) return unavailable('missing-or-invalid-usage');
  if (!Array.isArray(sample.receipts) || !sample.receipts.length) return unavailable('missing-stream');
  const frames = [], channels = new Map();
  let previous = -Infinity, units = 0;
  for (const r of sample.receipts) {
    if (!r || !Number.isSafeInteger(r.time) || r.time < 0 || r.time < previous ||
        !Number.isSafeInteger(r.units) || r.units <= 0) return unavailable('invalid-receipt-metadata');
    previous = r.time; units += r.units;
    if (frames.at(-1)?.time === r.time) frames.at(-1).units += r.units;
    else frames.push({ time: r.time, units: r.units });
    let group = channels.get(r.channel ?? 'metadata'); if (!group) channels.set(r.channel ?? 'metadata', group = []);
    if (group.at(-1)?.time === r.time) group.at(-1).units += r.units; else group.push({ time: r.time, units: r.units });
  }
  if (!Number.isSafeInteger(units) || units <= 0) return unavailable('invalid-content-units');
  if (sample.usage.reasoningTokens > 0 && !channels.has('reasoning')) return unavailable('unobserved-reasoning');
  if (frames.length < 4) return unavailable('insufficient-receipt-times');
  const first = frames[0], last = frames.at(-1), milliseconds = last.time - first.time;
  if (milliseconds < 200) return unavailable('short-receipt-burst');
  if (first.units / units > 0.8) return unavailable('buffered-first-receipt');
  const intervalUnits = units - first.units;
  function peakShare(start, denominator) {
    let left = start, sum = 0, peak = 0;
    for (let right = start; right < frames.length; right++) {
      sum += frames[right].units;
      while (frames[right].time - frames[left].time > 200) sum -= frames[left++].units;
      peak = Math.max(peak, sum);
    }
    return peak / denominator;
  }
  const totalBurstShare = peakShare(0, units), afterFirstBurstShare = peakShare(1, intervalUnits);
  if (totalBurstShare > 0.8 || afterFirstBurstShare > 0.8) return unavailable('dominant-receipt-burst');
  const tokens = outputTokens * (intervalUnits / units);
  return { version: 2, status: 'estimated', reason: null, provider: sample.provider, model: sample.model,
    attemptId: sample.attemptId, units, firstUnits: first.units, intervalUnits, outputTokens,
    tokens, milliseconds, firstTime: first.time, lastTime: last.time,
    tps: tokens * 1000 / milliseconds, totalBurstShare, afterFirstBurstShare, batchCount: frames.length,
    allocation: 'usage-proportional-unicode-codepoints' };
}

export function estimateStream(input) {
  try { return estimateStreamMetadata({ ...input, ...receiptMetadata(input?.stream, input?.content) }); }
  catch (error) {
    const reasons = new Set(['missing-stream', 'invalid-stream-time', 'invalid-stream-chunk', 'invalid-block-index',
      'conflicting-output-channel', 'invalid-delta-text', 'conflicting-tool-call', 'conflicting-tool-name',
      'invalid-stream-record', 'invalid-packed-stream', 'invalid-packed-time', 'invalid-final-content',
      'unobserved-final-content', 'unobserved-final-channel', 'unobserved-final-tool-content']);
    return unavailable(reasons.has(error.message) ? error.message : 'invalid-stream-content');
  }
}

export function estimateAssistantEvent(event) {
  const d = event?.data, source = d?.message?.source;
  return estimateStream({ provider: source?.provider, model: source?.model,
    attemptId: `${d?.turn}:${d?.step}:${event?.seq}`, status: d?.interrupted ? 'cancelled' : 'completed',
    usage: d?.usage, stream: d?.stream, content: d?.message?.content });
}

export function formatStreamEstimate(estimate) {
  return { label: STREAM_LABEL, value: estimate?.version === 2 && estimate.status === 'estimated' &&
    Number.isFinite(estimate.tps) && estimate.tps > 0 ? `${estimate.tps.toFixed(1)} tok/s` : STREAM_UNAVAILABLE };
}

export function initialStreamState() {
  return { route: null, groups: {}, latest: unavailable('no-completed-attempt') };
}
/** Pure whole-log projection, no raw content retained. Every pair is atomic. */
export function foldStreamEvent(state, event) {
  if (event.type !== 'assistant/message') return state;
  const source = event.data.message?.source;
  const route = source && validIdentity(source.provider) && validIdentity(source.model) ? { provider: source.provider, model: source.model } : null;
  const estimate = estimateAssistantEvent(event);
  if (!route) return { ...state, route: null, latest: estimate };
  const key = JSON.stringify([route.provider, route.model]);
  const group = state.groups[key] ?? { pairedTokens: 0, pairedMs: 0, eligible: 0, rejected: 0 };
  const next = estimate.status === 'estimated' ? { pairedTokens: group.pairedTokens + estimate.tokens,
    pairedMs: group.pairedMs + estimate.milliseconds, eligible: group.eligible + 1, rejected: group.rejected } :
    { ...group, rejected: group.rejected + 1 };
  return { route, latest: estimate, groups: { ...state.groups, [key]: next } };
}
export function streamStateView(state) {
  const group = state.route && state.groups[JSON.stringify([state.route.provider, state.route.model])];
  return { version: 2, route: state.route, eligible: group?.eligible ?? 0, rejected: group?.rejected ?? 0,
    estimate: group?.pairedMs > 0 ?
      { version: 2, status: 'estimated', tps: group.pairedTokens * 1000 / group.pairedMs, tokens: group.pairedTokens,
        milliseconds: group.pairedMs, reason: null } : state.latest };
}
