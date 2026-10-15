// Derived from DeepSeek rc.2; MIT notice in LICENSE.deepseek.
window.__ModuleLoader__.load({ id: 'dsh-tps-correction', factory: (require) => {
const react = require('react'), react_dom = require('react-dom'), react_jsx_runtime = require('react/jsx-runtime');
const _deepseek_ai_dsh_client_ui_primitives = require('@deepseek-ai/dsh-client-ui-primitives');
const NS = 'tps-correction';
const TPS = (() => {
/** Usage-calibrated receive estimate. This is NOT a server decode measurement. */
const STREAM_METRIC_VERSION = 2;
const STREAM_LABEL = '输出速度（估算）';
const STREAM_UNAVAILABLE = '暂无法计算';
const unavailable = reason => ({ version: 2, status: 'unavailable', reason, tps: null });
const validIdentity = value => typeof value === 'string' && value.trim().length > 0;
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) :
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

/** Packed dt includes empty fragments; return metadata only, never output text. */
function receiptMetadata(stream, content) {
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
function estimateStreamMetadata(sample) {
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

function estimateStream(input) {
  try { return estimateStreamMetadata({ ...input, ...receiptMetadata(input?.stream, input?.content) }); }
  catch (error) {
    const reasons = new Set(['missing-stream', 'invalid-stream-time', 'invalid-stream-chunk', 'invalid-block-index',
      'conflicting-output-channel', 'invalid-delta-text', 'conflicting-tool-call', 'conflicting-tool-name',
      'invalid-stream-record', 'invalid-packed-stream', 'invalid-packed-time', 'invalid-final-content',
      'unobserved-final-content', 'unobserved-final-channel', 'unobserved-final-tool-content']);
    return unavailable(reasons.has(error.message) ? error.message : 'invalid-stream-content');
  }
}

function estimateAssistantEvent(event) {
  const d = event?.data, source = d?.message?.source;
  return estimateStream({ provider: source?.provider, model: source?.model,
    attemptId: `${d?.turn}:${d?.step}:${event?.seq}`, status: d?.interrupted ? 'cancelled' : 'completed',
    usage: d?.usage, stream: d?.stream, content: d?.message?.content });
}

function formatStreamEstimate(estimate) {
  return { label: STREAM_LABEL, value: estimate?.version === 2 && estimate.status === 'estimated' &&
    Number.isFinite(estimate.tps) && estimate.tps > 0 ? `${estimate.tps.toFixed(1)} tok/s` : STREAM_UNAVAILABLE };
}

function initialStreamState() {
  return { route: null, groups: {}, latest: unavailable('no-completed-attempt') };
}
/** Pure whole-log projection, no raw content retained. Every pair is atomic. */
function foldStreamEvent(state, event) {
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
function streamStateView(state) {
  const group = state.route && state.groups[JSON.stringify([state.route.provider, state.route.model])];
  return { version: 2, route: state.route, eligible: group?.eligible ?? 0, rejected: group?.rejected ?? 0,
    estimate: group?.pairedMs > 0 ?
      { version: 2, status: 'estimated', tps: group.pairedTokens * 1000 / group.pairedMs, tokens: group.pairedTokens,
        milliseconds: group.pairedMs, reason: null } : state.latest };
}

return { estimateAssistantEvent, formatStreamEstimate };
})();

		//#region lib/types/client/chat/token-format.js
		/**
		* Compact token count: 517 / 12.2K / 517K / 1.2M.
		* @param value - non-negative token count.
		* @param t - Chat locale seat.
		* @returns locale-owned compact display string.
		*/
		function formatTokens(value, t) {
			const scaled = (candidate) => candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10);
			if (value < 1e3) return String(value);
			if (value < 1e6) return t("number.thousand", { value: scaled(value / 1e3) });
			return t("number.million", { value: scaled(value / 1e6) });
		}
		/**
		* Exact integer token count with locale-owned digit grouping.
		* @param value - non-negative safe integer token count.
		* @param t - Chat locale seat.
		* @returns an unrounded display string.
		*/
		function formatExactTokens(value, t) {
			const digits = String(value);
			const groups = [];
			for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
			return groups.join(t("number.groupSeparator"));
		}
		/** Round a cache-read ratio to exact percentage units, with positive ties rounded up. */
		function roundedPercentUnits(cacheReadTokens, denominator, decimalPlaces) {
			const scale = (decimalPlaces === 0 ? 1 : 10) * 100;
			const doubledScale = scale * 2;
			const denominatorQuotient = Math.floor(denominator / doubledScale);
			const denominatorRemainder = denominator % doubledScale;
			let lower = 0;
			let upper = scale;
			while (lower < upper) {
				const candidate = Math.floor((lower + upper + 1) / 2);
				const factor = candidate * 2 - 1;
				if (cacheReadTokens >= factor * denominatorQuotient + Math.ceil(factor * denominatorRemainder / doubledScale)) lower = candidate;
				else upper = candidate - 1;
			}
			return lower;
		}
		function displayPercentUnits(units, decimalPlaces) {
			if (decimalPlaces === 0) return String(units);
			const whole = Math.floor(units / 10);
			const tenths = units % 10;
			return tenths === 0 ? String(whole) : `${whole}.${tenths}`;
		}
		/**
		* Display-ready cache-hit share without rounding a partial hit to 100%.
		* @param cacheReadTokens - exact prompt tokens served from cache.
		* @param promptTokens - exact aggregate prompt tokens.
		* @param decimalPlaces - ordinary-ratio precision; partial hits that would
		* round to 100 automatically use enough additional precision to stay honest.
		* @returns percentage text, or null when there was no prompt input.
		*/
		function formatCacheHitPercent(cacheReadTokens, promptTokens, decimalPlaces = 0) {
			if (promptTokens === 0) return null;
			const missedInputTokens = promptTokens - cacheReadTokens;
			if (missedInputTokens === 0) return "100";
			const roundedUnits = roundedPercentUnits(cacheReadTokens, promptTokens, decimalPlaces);
			if (roundedUnits < (decimalPlaces === 0 ? 100 : 1e3)) return displayPercentUnits(roundedUnits, decimalPlaces);
			let distinguishingPlaces = 1;
			let scaledDoubleGap = missedInputTokens * 200;
			const denominatorTens = Math.floor(promptTokens / 10);
			while (scaledDoubleGap <= denominatorTens) {
				scaledDoubleGap *= 10;
				distinguishingPlaces += 1;
			}
			const denominatorOnes = promptTokens % 10;
			let roundedLoss = 5;
			for (let loss = 1; loss < 5; loss += 1) {
				const factor = loss * 2 + 1;
				const threshold = factor * denominatorTens + Math.floor(factor * denominatorOnes / 10);
				if (scaledDoubleGap <= threshold) {
					roundedLoss = loss;
					break;
				}
			}
			return `99.${"9".repeat(distinguishingPlaces - 1)}${10 - roundedLoss}`;
		}
		//#endregion

		//#region lib/types/client/chat/stat-dialog.js
		/** Viewport margin the placement clamp keeps (the Menu portal margin). */
		const PANEL_MARGIN = 12;
		/** Distance between the trigger's top edge and the panel's bottom. */
		const PANEL_GAP = 8;
		/**
		* Unplaced portal panel: hidden but laid out so the clamp measures real
		* dimensions (the `useAnchoredPosition` measure pass).
		*/
		const MEASURE_STYLE = {
			visibility: "hidden",
			left: 0,
			top: 0
		};
		/**
		* One trigger-anchored dialog seat: open state, viewport-clamped placement, outside-close.
		* @param controlled - external open state; when given the seat reads and writes
		* it instead of owning its own, letting sibling dialogs share one exclusive slot.
		* @returns the seat; spread `pos ?? MEASURE_STYLE` onto the portaled panel.
		*/
		function useStatDialog(controlled) {
			const [ownOpen, setOwnOpen] = (0, react.useState)(false);
			const open = controlled?.open ?? ownOpen;
			const setOpen = controlled?.setOpen ?? setOwnOpen;
			const rootRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			const pos = (0, _deepseek_ai_dsh_client_ui_primitives.useAnchoredPosition)({
				open,
				anchorRef: rootRef,
				panelRef,
				side: "top",
				gap: PANEL_GAP,
				margin: PANEL_MARGIN
			});
			(0, _deepseek_ai_dsh_client_ui_primitives.useDismissOnOutsidePointer)(rootRef, open, setOpen, panelRef);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onKeyDown = (e) => {
					if (e.key === "Escape") setOpen(false);
				};
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open, setOpen]);
			return {
				open,
				setOpen,
				rootRef,
				panelRef,
				pos
			};
		}
		//#endregion

		const css$4 = ".Xt1eiG_panel{z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;padding:16px;font-size:12px;line-height:18px;position:fixed}.Xt1eiG_title{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}.Xt1eiG_titleRule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}.Xt1eiG_titleValue{font-variant-numeric:tabular-nums}.Xt1eiG_titleLabel{align-items:center;gap:6px;min-width:0;display:inline-flex}.Xt1eiG_titleLabel svg{flex:none;width:14px;height:14px}.Xt1eiG_details{color:var(--dsw-alias-label-tertiary);grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;display:grid}.Xt1eiG_details dt,.Xt1eiG_details dd{min-width:0;margin:0}.Xt1eiG_details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}.Xt1eiG_details .Xt1eiG_route{overflow-wrap:anywhere}.Xt1eiG_reasoning{color:var(--dsw-alias-label-tertiary);white-space:nowrap}";
		const tagId$4 = "@deepseek-ai/dsh-client-ui-chat/stat-dialog.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$4) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-chat";
			tag.dataset.pluginCss = tagId$4;
			tag.textContent = css$4;
			document.head.appendChild(tag);
		}
		var stat_dialog_module_css_default = {
			"details": "Xt1eiG_details",
			"panel": "Xt1eiG_panel",
			"reasoning": "Xt1eiG_reasoning",
			"route": "Xt1eiG_route",
			"title": "Xt1eiG_title",
			"titleLabel": "Xt1eiG_titleLabel",
			"titleRule": "Xt1eiG_titleRule",
			"titleValue": "Xt1eiG_titleValue"
		};

		const css$1 = ".iq1doa_root{box-sizing:border-box;min-width:0;max-width:100%;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));justify-content:center;gap:12px;display:flex}.iq1doa_anchor{min-width:0;display:inline-flex}.iq1doa_pill{box-sizing:border-box;corner-shape:round;max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;border-radius:999px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}.iq1doa_pill svg{flex:none;width:14px;height:14px}button.iq1doa_pill{cursor:pointer}button.iq1doa_pill:hover,button.iq1doa_pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.iq1doa_label{text-overflow:ellipsis;min-width:0;overflow:hidden}.iq1doa_sep{color:var(--dsw-alias-separator-primary);margin:0 6px}";
		const tagId$1 = "@deepseek-ai/dsh-client-ui-chat/StatsPills.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-chat";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var StatsPills_module_css_default = {
			"anchor": "iq1doa_anchor",
			"label": "iq1doa_label",
			"pill": "iq1doa_pill",
			"root": "iq1doa_root",
			"sep": "iq1doa_sep"
		};

function assistantStepReading(node) { const t = node.timing; return { ttftMs: t && t.stepStartTime !== null && t.firstTokenTime !== null ? Math.max(0, t.firstTokenTime-t.stepStartTime) : null }; }
		//#region lib/types/client/chat/StatsPills.js
		/**
		* Fold assistant and tool-result nodes into window-scoped display totals —
		* the FALLBACK for assemblies without the `sessionStats` projection.
		*
		* Every displayed figure rides that durable whole-log projection (and token
		* accounting rides `tokenUsage`) because the window is paged and compaction
		* rewrites it; this fold answers "what is on screen" only when no projection
		* value is served. Its field names deliberately mirror the projection's so
		* the two swap wholesale.
		* @param nodes - snapshot nodes.
		* @returns fallback counts and summed wall times.
		*/
		function deriveStats(nodes) {
			const turns = /* @__PURE__ */ new Set();
			let steps = 0;
			let llmMs = 0;
			let toolMs = 0;
			let ttftMs = 0;
			let ttftSteps = 0;
			let decodeMs = 0;
			let decodeTokens = 0;
			for (const node of nodes) {
				if (node.kind === "tool-result") {
					if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime);
					continue;
				}
				if (node.kind !== "assistant") continue;
				turns.add(node.turn);
				steps += 1;
				if (node.timing !== void 0 && node.timing.stepStartTime !== null) llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime);
				const reading = assistantStepReading(node);
				if (reading.ttftMs !== null) {
					ttftMs += reading.ttftMs;
					ttftSteps += 1;
				}

			}
			return {
				turns: turns.size,
				steps,
				llmMs,
				toolMs,
				ttftMs,
				ttftSteps,
				decodeMs,
				decodeTokens
			};
		}
		/**
		* Compact duration: 45.2s under a minute, 2m42s from there on.
		* @param ms - duration in milliseconds.
		* @returns display string.
		*/
		function formatDuration(ms, t) {
			const s = ms / 1e3;
			if (s < 60) return t("duration.compactSeconds", { seconds: Math.round(s * 10) / 10 });
			const whole = Math.round(s);
			return t("duration.compactMinutes", {
				minutes: Math.floor(whole / 60),
				seconds: whole % 60
			});
		}
		/**
		* Display-ready cache-hit share of prompt-side input over the whole durable log.
		* @param usage - the session's token-usage projection value.
		* @returns integer text when integer rounding stays below 100, otherwise the
		* minimum decimal precision that still rounds below 100; a full hit returns
		* 100, and no billed input returns null.
		*/
		function cacheHitPercent(usage) {
			const denominator = billedInputTokens(usage);
			return formatCacheHitPercent(usage.cacheReadTokens, denominator);
		}
		/**
		* Sum the three disjoint prompt-side billing buckets.
		* @param usage - the session's token-usage projection value.
		* @returns billed input tokens.
		*/
		function billedInputTokens(usage) {
			return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
		}
		function exactCount(value, t) {
			return t("message.turnUsage.count", { count: formatExactTokens(value, t) });
		}
		function TimePill({ stats, t, dialog }) {
			const { open, setOpen, rootRef, panelRef, pos } = useStatDialog(dialog);
			const counts = t("stats.counts", {
				turns: stats.turns,
				steps: stats.steps
			});
			const tps = `${t("stats.dialog.speed")}: ${TPS.formatStreamEstimate(stats.tpsEstimate).value}`;
			const label = (0, react_jsx_runtime.jsxs)("span", {
				className: StatsPills_module_css_default.label,
				children: [counts, tps !== null && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("span", {
					className: StatsPills_module_css_default.sep,
					"aria-hidden": true,
					children: "·"
				}), tps] })]
			});
			if (stats.llmMs <= 0 && stats.toolMs <= 0 && stats.ttftSteps <= 0 && stats.decodeMs <= 0) return (0, react_jsx_runtime.jsx)("span", {
				className: StatsPills_module_css_default.anchor,
				children: (0, react_jsx_runtime.jsxs)("span", {
					className: StatsPills_module_css_default.pill,
					children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGaugeOutlineRegular, {}), label]
				})
			});
			return (0, react_jsx_runtime.jsxs)("span", {
				ref: rootRef,
				className: StatsPills_module_css_default.anchor,
				children: [(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: StatsPills_module_css_default.pill,
					"aria-haspopup": "dialog",
					"aria-expanded": open,
					"aria-label": tps === null ? counts : `${counts} · ${tps}`, title: t("stats.estimate.scope"),
					onClick: () => {
						setOpen(!open);
					},
					children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGaugeOutlineRegular, {}), label]
				}), open && (0, react_dom.createPortal)((0, react_jsx_runtime.jsxs)("div", {
					ref: panelRef,
					className: stat_dialog_module_css_default.panel,
					role: "dialog",
					"aria-label": t("stats.dialog.title"),
					style: pos ?? MEASURE_STYLE,
					children: [
						(0, react_jsx_runtime.jsx)("div", {
							className: stat_dialog_module_css_default.title,
							children: (0, react_jsx_runtime.jsxs)("span", {
								className: stat_dialog_module_css_default.titleLabel,
								children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGaugeOutlineRegular, {}), t("stats.dialog.title")]
							})
						}),
						(0, react_jsx_runtime.jsx)("div", {
							className: stat_dialog_module_css_default.titleRule,
							"aria-hidden": true
						}),
						(0, react_jsx_runtime.jsxs)("dl", {
							className: stat_dialog_module_css_default.details,
							"data-session-stats-details": true,
							children: [
								stats.llmMs > 0 && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("stats.dialog.llmTime") }), (0, react_jsx_runtime.jsx)("dd", { children: formatDuration(stats.llmMs, t) })] }),
								stats.toolMs > 0 && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("stats.dialog.toolTime") }), (0, react_jsx_runtime.jsx)("dd", { children: formatDuration(stats.toolMs, t) })] }),
								stats.ttftSteps > 0 && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("stats.dialog.ttft") }), (0, react_jsx_runtime.jsx)("dd", { children: formatDuration(stats.ttftMs / stats.ttftSteps, t) })] }),
								true && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("stats.dialog.speed") }), (0, react_jsx_runtime.jsx)("dd", { children: TPS.formatStreamEstimate(stats.tpsEstimate).value })] })
							]
						})
					]
				}), document.body)]
			});
		}
		function UsagePill({ usage, t, dialog }) {
			const { open, setOpen, rootRef, panelRef, pos } = useStatDialog(dialog);
			const total = billedInputTokens(usage) + usage.outputTokens;
			const totalText = t("message.turnUsage.count", { count: formatTokens(total, t) });
			const cacheHit = cacheHitPercent(usage);
			const cacheHitText = cacheHit !== null ? t("stats.cacheHit", { percent: cacheHit }) : null;
			return (0, react_jsx_runtime.jsxs)("span", {
				ref: rootRef,
				className: StatsPills_module_css_default.anchor,
				children: [(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: StatsPills_module_css_default.pill,
					"aria-haspopup": "dialog",
					"aria-expanded": open,
					"aria-label": cacheHitText === null ? totalText : `${totalText} · ${cacheHitText}`,
					onClick: () => {
						setOpen(!open);
					},
					children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDatabaseOutlineRegular, {}), (0, react_jsx_runtime.jsxs)("span", {
						className: StatsPills_module_css_default.label,
						children: [totalText, cacheHitText !== null && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("span", {
							className: StatsPills_module_css_default.sep,
							"aria-hidden": true,
							children: "·"
						}), cacheHitText] })]
					})]
				}), open && (0, react_dom.createPortal)((0, react_jsx_runtime.jsxs)("div", {
					ref: panelRef,
					className: stat_dialog_module_css_default.panel,
					role: "dialog",
					"aria-label": t("stats.dialog.usageTitle"),
					style: pos ?? MEASURE_STYLE,
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							className: stat_dialog_module_css_default.title,
							children: [(0, react_jsx_runtime.jsxs)("span", {
								className: stat_dialog_module_css_default.titleLabel,
								children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDatabaseOutlineRegular, {}), t("stats.dialog.usageTitle")]
							}), (0, react_jsx_runtime.jsx)("span", {
								className: stat_dialog_module_css_default.titleValue,
								children: exactCount(total, t)
							})]
						}),
						(0, react_jsx_runtime.jsx)("div", {
							className: stat_dialog_module_css_default.titleRule,
							"aria-hidden": true
						}),
						(0, react_jsx_runtime.jsxs)("dl", {
							className: stat_dialog_module_css_default.details,
							"data-session-stats-usage": true,
							children: [
								cacheHit !== null && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("message.turnUsage.cacheHit") }), (0, react_jsx_runtime.jsx)("dd", { children: `${cacheHit}%` })] }),
								(0, react_jsx_runtime.jsx)("dt", { children: t("message.turnUsage.input") }),
								(0, react_jsx_runtime.jsx)("dd", { children: exactCount(usage.uncachedInputTokens, t) }),
								(0, react_jsx_runtime.jsx)("dt", { children: t("message.turnUsage.cacheRead") }),
								(0, react_jsx_runtime.jsx)("dd", { children: exactCount(usage.cacheReadTokens, t) }),
								usage.cacheWriteTokens !== 0 && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("message.turnUsage.cacheWrite") }), (0, react_jsx_runtime.jsx)("dd", { children: exactCount(usage.cacheWriteTokens, t) })] }),
								(0, react_jsx_runtime.jsx)("dt", { children: t("message.turnUsage.output") }),
								(0, react_jsx_runtime.jsx)("dd", { children: exactCount(usage.outputTokens, t) })
							]
						})
					]
				}), document.body)]
			});
		}
		const StatsPills = (0, react.memo)(function StatsPills({ useChat, useProjection, usePerformanceUsage, t }) {
			const mode = usePerformanceUsage((value) => value);
			const settledNodes = useChat((s) => s.legacy.nodes);
			const usage = useProjection("tokenUsage");
			const [openPill, setOpenPill] = (0, react.useState)(null);
			const projected = useProjection("sessionStats");
			const correction = useProjection("tpsCorrectionV2");
			const stats = (0, react.useMemo)(() => ({ ...(projected ?? deriveStats(settledNodes)), tpsEstimate: correction?.version === 2 ? correction.estimate : undefined }), [projected, settledNodes, correction]);
			const hasTokens = usage !== void 0 && (billedInputTokens(usage) > 0 || usage.outputTokens > 0);
			if (mode === "compact") {
				const speed = `${t("stats.dialog.speed")}: ${TPS.formatStreamEstimate(stats.tpsEstimate).value}`;
				const cacheHit = hasTokens ? cacheHitPercent(usage) : null;
				if (speed === null && cacheHit === null) return null;
				return (0, react_jsx_runtime.jsxs)("div", {
					className: StatsPills_module_css_default.root,
					"data-composer-stats": true, title: t("stats.estimate.scope"),
					children: [speed !== null && (0, react_jsx_runtime.jsxs)("span", {
						className: StatsPills_module_css_default.pill,
						children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGaugeOutlineRegular, {}), speed]
					}), cacheHit !== null && (0, react_jsx_runtime.jsxs)("span", {
						className: StatsPills_module_css_default.pill,
						children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDatabaseOutlineRegular, {}), t("stats.cacheHit", { percent: cacheHit })]
					})]
				});
			}
			if (stats.steps === 0 && !hasTokens) return null;
			return (0, react_jsx_runtime.jsxs)("div", {
				className: StatsPills_module_css_default.root,
				"data-composer-stats": true, title: t("stats.estimate.scope"),
				children: [stats.steps > 0 && (0, react_jsx_runtime.jsx)(TimePill, {
					stats,
					t,
					dialog: {
						open: openPill === "time",
						setOpen: (open) => {
							setOpenPill(open ? "time" : null);
						}
					}
				}), hasTokens && (0, react_jsx_runtime.jsx)(UsagePill, {
					usage,
					t,
					dialog: {
						open: openPill === "usage",
						setOpen: (open) => {
							setOpenPill(open ? "usage" : null);
						}
					}
				})]
			});
		});
		//#endregion

return { inject: ['slots','configForms','locale'], apply(ctx) {
ctx.effect(() => ctx.locale.register(NS, {"zh":{"message.stepProcess.thinking":"正在分析请求","message.stepProcess.read":"正在读取文件","message.stepProcess.readImage":"正在读取图片","message.stepProcess.write":"正在写入文件","message.stepProcess.search":"正在搜索代码","message.stepProcess.edit":"正在编辑文件","message.stepProcess.commands":"正在运行命令","message.stepProcess.code":"正在运行代码","message.stepProcess.webSearch":"正在搜索网页","message.stepProcess.webFetch":"正在访问网页","message.stepProcess.subagents":"正在协调子智能体","message.stepProcess.plan":"正在更新计划","message.stepProcess.questions":"等待你的操作","message.stepProcess.tools":"正在调用工具","message.stepProcess.prepare.read":"准备读取文件","message.stepProcess.prepare.readImage":"准备读取图片","message.stepProcess.prepare.write":"准备写入文件","message.stepProcess.prepare.search":"准备搜索代码","message.stepProcess.prepare.edit":"准备编辑文件","message.stepProcess.prepare.commands":"准备运行命令","message.stepProcess.prepare.code":"准备运行代码","message.stepProcess.prepare.webSearch":"准备搜索网页","message.stepProcess.prepare.webFetch":"准备访问网页","message.stepProcess.prepare.subagents":"准备协调子智能体","message.stepProcess.prepare.plan":"准备更新计划","message.stepProcess.prepare.questions":"准备提问","message.stepProcess.prepare.tools":"准备调用工具","message.stepProcess.done.thinking":"已完成分析","message.stepProcess.done.read":"已读取文件","message.stepProcess.done.readImage":"已读取图片","message.stepProcess.done.write":"已写入文件","message.stepProcess.done.search":"已搜索代码","message.stepProcess.done.edit":"修改了文件","message.stepProcess.done.commands":"执行了命令","message.stepProcess.done.code":"运行了代码","message.stepProcess.done.webSearch":"已搜索网页","message.stepProcess.done.webFetch":"已访问网页","message.stepProcess.done.subagents":"已协调子智能体","message.stepProcess.done.plan":"更新了计划","message.stepProcess.done.questions":"向用户提出了问题","message.stepProcess.done.tools":"已调用工具","message.stepProcess.joinTwo":"{first}并{second}","message.stepProcess.comma":"，","message.stepProcess.sharedPrefix":"已","message.stepProcess.more":"{title}等","message.trigger.request":"收到执行请求","message.trigger.goal":"继续执行目标","message.trigger.agent":"收到任务消息","message.trigger.team":"收到团队消息","message.trigger.subagent":"子任务状态更新","message.trigger.github":"收到 GitHub 事件","message.trigger.webhook":"收到外部事件","message.trigger.schedule":"自动化任务","message.trigger.job":"后台任务状态更新","message.trigger.plugin":"插件状态更新","message.trigger.explanation":"这条通知触发了本轮回复。","message.turnProcess.worked":"已完成","message.turnProcess.took":"已完成，用时 ","message.turnProcess.failed":"处理失败","view.chat":"对话","image.open":"查看大图","image.loading":"加载图片…","image.failed":"图片无法预览","image.dialog":"图片预览","image.close":"关闭图片预览","number.groupSeparator":",","duration.compactSeconds":"{seconds}秒","duration.compactMinutes":"{minutes}分{seconds}秒","duration.milliseconds":"{milliseconds}毫秒","stats.counts":"{turns} 轮 {steps} 步","stats.cacheHit":"缓存命中 {percent}%","stats.dialog.title":"会话统计","stats.dialog.usageTitle":"Token 用量","stats.dialog.llmTime":"模型用时","stats.dialog.toolTime":"工具调用用时","stats.dialog.ttft":"首 token 平均（TTFT）","stats.dialog.speed":"输出速度（估算）","chat.loadingHistory":"载入历史…","chat.loadError":"历史加载失败：{message}（{code}）","chat.loadOlder":"加载更早","chat.toBottom":"回到底部","chat.deepDiving":"深度求索中","chat.deepDivingFor":"深度求索中，用时 {duration} ···","chat.turnNavigation.label":"轮次导航","chat.turnNavigation.jump":"跳转到第 {turn} 轮","chat.turnNavigation.jumpLoad":"加载并跳转到第 {turn} 轮","chat.turnNavigation.turn":"第 {turn} 轮","settings.performance.title":"性能与用量","settings.performance.description":"选择性能与用量信息展示的详细程度","settings.performance.compact":"简洁","settings.performance.detailed":"详细","settings.links.title":"网页链接默认打开方式","settings.links.description":"对话中网页链接的打开位置","settings.links.sidebar":"应用内侧边栏","settings.links.newTab":"默认浏览器","settings.transcript.title":"工作步骤展示","settings.transcript.description":"选择希望看到多少工具调用细节","settings.transcript.compact":"简洁","settings.transcript.standard":"标准","settings.transcript.detailed":"详细","settings.transcript.verbose":"完全展开","fileOpen.title":"无法打开文件","fileOpen.unknown":"无法打开此文件","message.extraBlock":"附加内容块","message.systemPrompt":"系统提示词","message.systemPromptUpdate":"系统提示词更新","message.toolAdded":"已添加工具：{name}","message.toolRemoved":"已移除工具：{name}","message.toolsAdded":"新增：{names}","message.toolsAddedCount":"新增 {count} 个","message.toolsChanged":"新增 {added} 个，移除 {removed} 个","message.toolsRemoved":"移除：{names}","message.toolsRemovedCount":"移除 {count} 个","message.toolsUpdated":"工具已更新","message.contextInjection":"上下文注入","message.contextRecall":"跨会话召回","message.referenceSummary":"引用会话 · {labels}","message.referenceSeparator":"、","message.context.instructions.loaded":"已载入","message.context.instructions.added":"已新增","message.context.instructions.updated":"已更新","message.context.instructions.removed":"已移除","message.context.catalog.replaced":"替换目录","message.context.catalog.more":"…还有 {count} 条","message.context.snapshot.supersedes":"取代先前的快照","message.context.relay.from":"来自会话 {session}","message.context.recall.counts":"保留 {retained} 条 · 省略 {omitted} 条","message.context.recall.truncated":"已截断","message.compaction":"上下文已压缩","message.compaction.running":"正在压缩…","message.compaction.completed":"已压缩 {items} 条历史记录（约 {tokens} tokens）","message.compaction.expand":"点击查看压缩摘要","message.compaction.unavailable":"压缩摘要不可用","message.compaction.commandTitle":"compact","message.think":"思考","message.unknownSurface":"未知 surface 事件：{type}","message.unknownBlock":"未知内容块","message.turnProcess.toolCalls.one":"{count} 次工具调用","message.turnProcess.toolCalls.other":"{count} 次工具调用","message.turnProcess.messages.one":"{count} 条消息","message.turnProcess.messages.other":"{count} 条消息","message.turnProcess.subagents.one":"{count} 个 subagent","message.turnProcess.subagents.other":"{count} 个 subagent","message.turnProcess.thoughtForAWhile":"已思考","message.turnProcess.separator":" · ","message.stopped":"已停止","message.branch":"在新对话中分支","message.branchUnavailable":"仅可从已完成轮次的最后一条消息分支","message.retry.active":"正在重试模型请求","message.retry.cancelled":"模型请求重试已取消","message.retry.started":"已重试模型请求","message.retry.scheduled":"等待重试模型请求","message.retry.status":"{label}（{retry}/{maximum}） · {seconds}s","message.retry.delay":"重试延迟：","message.retry.failure":"失败原因：","message.failure.auth":"API 密钥无效","message.accountStopped":"任务已停止","message.failure.accountSignedOut":"任务已因退出 DeepSeek 登录而停止。","message.failure.accountSignInRequired":"请先登录 DeepSeek，并确认请求地址支持账号认证。","message.failure.quota":"当前请求的额度已用尽","message.turnError":"本轮运行失败","message.maxTokens":"已达到输出 token 上限","message.maxTokens.hint":"回答被截断，已有输出保留在对话中。发送“继续”可让模型接着输出。","message.tokensPerSecond":"{tps} tok/s","message.turnUsage.title":"本轮用量","message.turnUsage.consumed":"用量 {total}","message.turnUsage.model":"提供方 / 模型","message.turnUsage.cacheHit":"缓存命中","message.turnUsage.input":"未缓存输入","message.turnUsage.cacheRead":"缓存读取","message.turnUsage.cacheWrite":"缓存写入","message.turnUsage.output":"输出","message.turnUsage.reasoning":"（其中推理 {tokens}）","message.turnUsage.count":"{count} tok","duration.secondUnit":"秒","duration.minuteUnit":"分","duration.hourUnit":"小时","command.running":"执行中…","command.failed":"指令失败","command.done":"已完成","command.title":"指令","row.running":"运行中","row.failed":"失败","json.truncated":"… 已截断，共 {total} 字符","clock.md":"{m}月{d}日","clock.ymd":"{y}年{m}月{d}日","stats.estimate.scope":"当前提供方 / 模型已完成的合格请求加权平均；非实时速度。总 output usage 按接收内容单位分摊估算。"},"en":{"message.stepProcess.thinking":"Analyzing the request","message.stepProcess.read":"Reading files","message.stepProcess.readImage":"Reading images","message.stepProcess.write":"Writing files","message.stepProcess.search":"Searching code","message.stepProcess.edit":"Editing files","message.stepProcess.commands":"Running commands","message.stepProcess.code":"Running code","message.stepProcess.webSearch":"Searching the web","message.stepProcess.webFetch":"Visiting web pages","message.stepProcess.subagents":"Coordinating subagents","message.stepProcess.plan":"Updating the plan","message.stepProcess.questions":"Waiting for your action","message.stepProcess.tools":"Calling tools","message.stepProcess.prepare.read":"Preparing to read files","message.stepProcess.prepare.readImage":"Preparing to read images","message.stepProcess.prepare.write":"Preparing to write files","message.stepProcess.prepare.search":"Preparing to search code","message.stepProcess.prepare.edit":"Preparing to edit files","message.stepProcess.prepare.commands":"Preparing to run commands","message.stepProcess.prepare.code":"Preparing to run code","message.stepProcess.prepare.webSearch":"Preparing to search the web","message.stepProcess.prepare.webFetch":"Preparing to visit web pages","message.stepProcess.prepare.subagents":"Preparing to coordinate subagents","message.stepProcess.prepare.plan":"Preparing to update the plan","message.stepProcess.prepare.questions":"Preparing questions","message.stepProcess.prepare.tools":"Preparing tool calls","message.stepProcess.done.thinking":"Analysis completed","message.stepProcess.done.read":"Read files","message.stepProcess.done.readImage":"Read images","message.stepProcess.done.write":"Wrote files","message.stepProcess.done.search":"Searched code","message.stepProcess.done.edit":"Edited files","message.stepProcess.done.commands":"Ran commands","message.stepProcess.done.code":"Ran code","message.stepProcess.done.webSearch":"Searched the web","message.stepProcess.done.webFetch":"Visited web pages","message.stepProcess.done.subagents":"Coordinated subagents","message.stepProcess.done.plan":"Updated the plan","message.stepProcess.done.questions":"Asked questions","message.stepProcess.done.tools":"Called tools","message.stepProcess.joinTwo":"{first} and {second}","message.stepProcess.comma":", ","message.stepProcess.sharedPrefix":"","message.stepProcess.more":"{title}, etc.","message.trigger.request":"Execution requested","message.trigger.goal":"Continuing goal","message.trigger.agent":"Task message received","message.trigger.team":"Team message received","message.trigger.subagent":"Subtask status updated","message.trigger.github":"GitHub event received","message.trigger.webhook":"External event received","message.trigger.schedule":"Automation task","message.trigger.job":"Background task updated","message.trigger.plugin":"Plugin status updated","message.trigger.explanation":"This notification triggered this response.","message.turnProcess.worked":"Completed","message.turnProcess.took":"Completed in ","message.turnProcess.failed":"Failed","view.chat":"Chat","image.open":"View full image","image.loading":"Loading image…","image.failed":"Image preview unavailable","image.dialog":"Image preview","image.close":"Close image preview","number.groupSeparator":",","duration.compactSeconds":"{seconds}s","duration.compactMinutes":"{minutes}m{seconds}s","duration.milliseconds":"{milliseconds}ms","stats.counts":"{turns} turns {steps} steps","stats.cacheHit":"Cache hit {percent}%","stats.dialog.title":"Session statistics","stats.dialog.usageTitle":"Token usage","stats.dialog.llmTime":"LLM time","stats.dialog.toolTime":"Tool time","stats.dialog.ttft":"Avg time to first token (TTFT)","stats.dialog.speed":"Output speed (estimated)","chat.loadingHistory":"Loading history…","chat.loadError":"Failed to load history: {message} ({code})","chat.loadOlder":"Load earlier","chat.toBottom":"Back to bottom","chat.deepDiving":"Deep diving","chat.deepDivingFor":"Deep diving for {duration} ···","chat.turnNavigation.label":"Turn navigation","chat.turnNavigation.jump":"Jump to turn {turn}","chat.turnNavigation.jumpLoad":"Load and jump to turn {turn}","chat.turnNavigation.turn":"Turn {turn}","settings.performance.title":"Performance & usage","settings.performance.description":"Choose how much performance and usage information to show","settings.performance.compact":"Compact","settings.performance.detailed":"Detailed","settings.links.title":"Open chat links in","settings.links.description":"Choose where to open web links","settings.links.sidebar":"In-App Sidebar","settings.links.newTab":"Default Browser","settings.transcript.title":"Work details","settings.transcript.description":"Choose how much detail to show for tool calls","settings.transcript.compact":"Compact","settings.transcript.standard":"Standard","settings.transcript.detailed":"Detailed","settings.transcript.verbose":"Verbose","fileOpen.title":"Couldn’t open file","fileOpen.unknown":"Couldn’t open this file","message.extraBlock":"Extra content block","message.systemPrompt":"System prompt","message.systemPromptUpdate":"System prompt update","message.toolAdded":"Tool added: {name}","message.toolRemoved":"Tool removed: {name}","message.toolsAdded":"Added: {names}","message.toolsAddedCount":"{count} added","message.toolsChanged":"{added} added, {removed} removed","message.toolsRemoved":"Removed: {names}","message.toolsRemovedCount":"{count} removed","message.toolsUpdated":"Tools updated","message.contextInjection":"Context injection","message.contextRecall":"Session recall","message.referenceSummary":"Referenced session · {labels}","message.referenceSeparator":", ","message.context.instructions.loaded":"loaded","message.context.instructions.added":"added","message.context.instructions.updated":"updated","message.context.instructions.removed":"removed","message.context.catalog.replaced":"Replacement catalog","message.context.catalog.more":"… {count} more","message.context.snapshot.supersedes":"Supersedes earlier snapshots","message.context.relay.from":"From session {session}","message.context.recall.counts":"{retained} kept · {omitted} omitted","message.context.recall.truncated":"truncated","message.compaction":"Context compacted","message.compaction.running":"Compacting context…","message.compaction.completed":"Compacted {items} history items (~{tokens} tokens)","message.compaction.expand":"View compaction summary","message.compaction.unavailable":"Compaction summary unavailable","message.compaction.commandTitle":"compact","message.think":"Think","message.unknownSurface":"Unknown surface event: {type}","message.unknownBlock":"Unknown content block","message.turnProcess.toolCalls.one":"{count} tool call","message.turnProcess.toolCalls.other":"{count} tool calls","message.turnProcess.messages.one":"{count} message","message.turnProcess.messages.other":"{count} messages","message.turnProcess.subagents.one":"{count} subagent","message.turnProcess.subagents.other":"{count} subagents","message.turnProcess.thoughtForAWhile":"Thought for a while","message.turnProcess.separator":" · ","message.stopped":"Stopped","message.branch":"Branch into a new conversation","message.branchUnavailable":"Available only on the last message of a completed turn","message.retry.active":"Retrying model request","message.retry.cancelled":"Model request retry cancelled","message.retry.started":"Retried model request","message.retry.scheduled":"Waiting to retry model request","message.retry.status":"{label} ({retry}/{maximum}) · {seconds}s","message.retry.delay":"Retry delay: ","message.retry.failure":"Failure reason: ","message.failure.auth":"API key is invalid","message.accountStopped":"Task stopped","message.failure.accountSignedOut":"Stopped because you signed out of DeepSeek.","message.failure.accountSignInRequired":"Sign in to DeepSeek and ensure the request destination supports account authentication.","message.failure.quota":"Request quota exhausted.","message.turnError":"This turn failed","message.maxTokens":"Output token limit reached","message.maxTokens.hint":"The reply was cut off; earlier output is preserved in the conversation. Send \"continue\" to let the model resume.","message.tokensPerSecond":"{tps} tok/s","message.turnUsage.title":"Turn usage","message.turnUsage.consumed":"Usage {total}","message.turnUsage.model":"Provider / model","message.turnUsage.cacheHit":"Cache hit","message.turnUsage.input":"Uncached input","message.turnUsage.cacheRead":"Cached input","message.turnUsage.cacheWrite":"Cache write","message.turnUsage.output":"Output","message.turnUsage.reasoning":" ({tokens} reasoning)","message.turnUsage.count":"{count} tok","duration.secondUnit":"s","duration.minuteUnit":"m ","duration.hourUnit":"h ","command.running":"Running…","command.failed":"Command failed","command.done":"Completed","command.title":"Command","row.running":"Running","row.failed":"Failed","json.truncated":"… truncated, {total} characters total","clock.md":"{m}/{d}","clock.ymd":"{y}-{m}-{d}","stats.estimate.scope":"Weighted mean of completed eligible requests for this provider/model, not a live rate. Output usage is allocated by received content units."}}));
const settings = ctx.configForms.get('ui-chat');
const performanceUsage = { getSnapshot: () => settings.getSnapshot().value?.performanceUsage ?? 'detailed', subscribe: fn => settings.subscribe(fn) };
ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({name:'conversation.composer.dock',id:'stats',priority:-100,order:0,locale:NS,inject:()=>({hooks:{performanceUsage}})}, StatsPills));
ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({name:'conversation.composer.dock',id:'stats',priority:-99,order:0}, () => react.createElement('span', {'data-tps-unavailable':true}, '输出速度（估算）: 暂无法计算')));
} }; }});
