import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'upstream-manifest.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const row of manifest.files) if (hash(fs.readFileSync(path.join(root, row.path))) !== row.sha256) throw Error(`Upstream source changed: ${row.path}`);
const load = file => fs.readFileSync(path.join(root, 'upstream', file), 'utf8');
const write = (file, data) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), data); };
const changes = [];
function once(source, old, replacement, label) {
  if (source.split(old).length !== 2) throw Error(`Expected exactly one ${label}`);
  changes.push({ label, oldSha256: hash(old), replacementSha256: hash(replacement) });
  return source.replace(old, replacement);
}
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw Error(`Missing fixed rc.2 region: ${start}`);
  return source.slice(a, b);
}
const shared = fs.readFileSync(path.join(root, 'lib/stream-estimate.js'), 'utf8').replace(/^export /gm, '');
const sharedBrowser = `const TPS = (() => {\n${shared}\nreturn { estimateAssistantEvent, formatStreamEstimate };\n})();\n`;
const originalTrajectory = load('dsh-client-ui-trajectory/lib/client.js');
let trajectory = once(originalTrajectory, '\t\tvar module = { exports: {} };', `\t\tvar module = { exports: {} };\n${sharedBrowser}`, 'embed shared metric in trajectory');
const throughput = between(trajectory, '\t\tfunction throughput(metrics, t) {', '\t\tfunction AssistantTimingPanel');
trajectory = once(trajectory, throughput, '\t\tfunction throughput(metrics, t) {\n\t\t\treturn TPS.formatStreamEstimate(metrics.tpsEstimate).value;\n\t\t}\n', 'replace independent old trajectory throughput');
trajectory = once(trajectory, 'usage: event.data.usage,\n\t\t\t\t\tproviderMetadata:', 'usage: event.data.usage,\n\t\t\t\t\ttpsEstimate: TPS.estimateAssistantEvent(event),\n\t\t\t\t\tproviderMetadata:', 'derive TPS from final attempt stream');
trajectory = once(trajectory, 'message.assistantMetrics = {', 'message.assistantMetrics = {\n\t\t\t\ttpsEstimate: streaming ? undefined : node.tpsEstimate,', 'carry per-step estimate into timing panel');
trajectory = once(trajectory, '"timing.throughput": "吞吐量"', '"timing.throughput": "输出速度（估算）"', 'Chinese estimate label');
trajectory = once(trajectory, '"timing.throughput": "Throughput"', '"timing.throughput": "Output speed (estimated)"', 'English estimate label');
const trajectoryManifest = JSON.parse(load('dsh-client-ui-trajectory/package.json'));
trajectoryManifest.version = '0.2.0-rc.2-tps.2'; trajectoryManifest.private = true;
write('compat/trajectory/package.json', JSON.stringify(trajectoryManifest, null, 2) + '\n');
write('compat/trajectory/lib/client.js', trajectory);
write('compat/trajectory/lib/index.js', `export const inject = ['tpsCorrectionReady'];\n${load('dsh-client-ui-trajectory/lib/index.js')}`);
write('compat/trajectory/LICENSE', load('dsh-client-ui-trajectory/LICENSE'));

const chat = load('dsh-client-ui-chat/lib/client.js');
const tokenFormat = between(chat, '\t\t//#region lib/types/client/chat/token-format.js', '\t\t//#region lib/types/client/chat/stat-dialog.js');
const dialog = between(chat, '\t\t//#region lib/types/client/chat/stat-dialog.js', '\t\t//#region \\0dsh-css:');
const dialogCss = between(chat, '\t\tconst css$4 = ".Xt1eiG_panel', '\t\t//#endregion');
const statsCss = between(chat, '\t\tconst css$1 = ".iq1doa_root', '\t\t//#endregion');
let stats = between(chat, '\t\t//#region lib/types/client/chat/StatsPills.js', '\t\t//#region lib/types/client/conversation-nodes/common.js');
stats = once(stats, 'const projected = useProjection("sessionStats");', 'const projected = useProjection("sessionStats");\n\t\t\tconst correction = useProjection("tpsCorrectionV2");', 'read independent versioned projection');
stats = once(stats, 'const stats = (0, react.useMemo)(() => projected ?? deriveStats(settledNodes), [projected, settledNodes]);',
  'const stats = (0, react.useMemo)(() => ({ ...(projected ?? deriveStats(settledNodes)), tpsEstimate: correction?.version === 2 ? correction.estimate : undefined }), [projected, settledNodes, correction]);', 'no speed fallback from old stats');
const oldSpeed = 'stats.decodeMs > 0 ? t("message.tokensPerSecond", { tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1e3)) }) : null';
if (stats.split(oldSpeed).length !== 3) throw Error('Two stats speed seats expected');
stats = stats.split(oldSpeed).join('`${t("stats.dialog.speed")}: ${TPS.formatStreamEstimate(stats.tpsEstimate).value}`');
stats = once(stats, 'stats.decodeMs > 0 && (0, react_jsx_runtime.jsxs)', 'true && (0, react_jsx_runtime.jsxs)', 'unavailable speed stays visible in details');
stats = once(stats, 't("message.tokensPerSecond", { tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1e3)) })',
  'TPS.formatStreamEstimate(stats.tpsEstimate).value', 'details use shared estimated receive metric');
const oldPair = '\t\t\t\tif (reading.decodeMs !== null && reading.outputTokens !== null) {\n\t\t\t\t\tdecodeMs += reading.decodeMs;\n\t\t\t\t\tdecodeTokens += reading.outputTokens;\n\t\t\t\t}';
stats = once(stats, oldPair, '', 'window fallback never calculates speed');
stats = once(stats, '"aria-label": tps === null ? counts : `${counts} · ${tps}`,',
  '"aria-label": tps === null ? counts : `${counts} · ${tps}`, title: t("stats.estimate.scope"),', 'average scope tooltip');
if (stats.split('"data-composer-stats": true,').length !== 3) throw Error('Expected compact and detailed stats roots');
stats = stats.replaceAll('"data-composer-stats": true,', '"data-composer-stats": true, title: t("stats.estimate.scope"),');
const dictionaries = {};
for (const lang of ['zh', 'en']) {
  const block = between(chat, `\t\tconst ${lang} = {`, '\n\t\t};');
  dictionaries[lang] = Object.fromEntries([...block.matchAll(/"([^"\n]+)": ("(?:\\.|[^"\\])*")/g)].map(m => [m[1], JSON.parse(m[2])]));
  dictionaries[lang]['stats.dialog.speed'] = lang === 'zh' ? '输出速度（估算）' : 'Output speed (estimated)';
  dictionaries[lang]['stats.estimate.scope'] = lang === 'zh' ? '当前提供方 / 模型已完成的合格请求加权平均；非实时速度。总 output usage 按接收内容单位分摊估算。' : 'Weighted mean of completed eligible requests for this provider/model, not a live rate. Output usage is allocated by received content units.';
}
const client = `// Derived from DeepSeek rc.2; MIT notice in LICENSE.deepseek.\nwindow.__ModuleLoader__.load({ id: 'dsh-tps-correction', factory: (require) => {\n` +
  `const react = require('react'), react_dom = require('react-dom'), react_jsx_runtime = require('react/jsx-runtime');\n` +
  `const _deepseek_ai_dsh_client_ui_primitives = require('@deepseek-ai/dsh-client-ui-primitives');\n` +
  `const NS = 'tps-correction';\n${sharedBrowser}\n${tokenFormat}\n${dialog}\n${dialogCss}\n${statsCss}\n` +
  `function assistantStepReading(node) { const t = node.timing; return { ttftMs: t && t.stepStartTime !== null && t.firstTokenTime !== null ? Math.max(0, t.firstTokenTime-t.stepStartTime) : null }; }\n` +
  `${stats}\nreturn { inject: ['slots','configForms','locale'], apply(ctx) {\n` +
  `ctx.effect(() => ctx.locale.register(NS, ${JSON.stringify(dictionaries)}));\n` +
  `const settings = ctx.configForms.get('ui-chat');\n` +
  `const performanceUsage = { getSnapshot: () => settings.getSnapshot().value?.performanceUsage ?? 'detailed', subscribe: fn => settings.subscribe(fn) };\n` +
  `ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({name:'conversation.composer.dock',id:'stats',priority:-100,order:0,locale:NS,inject:()=>({hooks:{performanceUsage}})}, StatsPills));\n` +
  `ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({name:'conversation.composer.dock',id:'stats',priority:-99,order:0}, () => react.createElement('span', {'data-tps-unavailable':true}, '输出速度（估算）: 暂无法计算')));\n` +
  `} }; }});\n`;
if (client.includes('stats.decodeTokens /') || trajectory.includes('metrics.outputTokens / generationSeconds')) throw Error('Old formula survived in a replacement');
write('lib/client.js', client);
write('LICENSE.deepseek', load('dsh-client-ui-chat/LICENSE'));
write('compat-build.json', JSON.stringify({ target: manifest.version, buildCommit: manifest.buildCommit, sharedMetricSha256: hash(shared),
  edits: changes, files: ['lib/client.js', 'compat/trajectory/lib/client.js'].map(file => ({ file, sha256: hash(fs.readFileSync(path.join(root, file))) })) }, null, 2));
console.log(JSON.stringify({ generatedStatsBytes: Buffer.byteLength(client), trajectoryBytes: Buffer.byteLength(trajectory), edits: changes.length }));
