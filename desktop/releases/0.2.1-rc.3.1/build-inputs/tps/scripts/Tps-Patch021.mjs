import fs from 'node:fs';
import vm from 'node:vm';
import { sha256 } from './Tps-Official.mjs';
export const trajectory021Sha256 = 'a6f2ffae255381c302364ec9d04ce69d300ea58738582661870db984b9b55bec';
export const chat021Sha256 = '42795539e0240e774c5cb66e693ac951208efe13eaa9421ec83324d3850cf3ff';
export function replaceTpsOnce(source, before, after) {
  if (source.split(before).length !== 2) throw Error(`TPS anchor must be unique: ${before.slice(0, 80)}`);
  return source.replace(before, after);
}
export function tpsEstimatorSource() {
  const source = fs.readFileSync(new URL('../sources/dsh-tps-correction/lib/stream-estimate.js', import.meta.url), 'utf8');
  return `const TPS021 = (() => {\n${source.replace(/^export /gm, '')}\nreturn { estimateAssistantEvent, formatStreamEstimate };\n})();\n`;
}
/** Pure exact-build transform; caller owns candidate staging, archive and rollback. */
export function patchTrajectory021(original) {
  if (sha256(original) !== trajectory021Sha256) throw Error('TPS_TRAJECTORY_021_SOURCE_MISMATCH');
  let source = String(original);
  source = replaceTpsOnce(source, '\tfactory: (require) => {', '\tfactory: (require) => {\n' + tpsEstimatorSource());
  source = replaceTpsOnce(source, '\t\t\t\t\tmessageId: event.data.message.id,', '\t\t\t\t\tmessageId: event.data.message.id,\n\t\t\t\t\ttpsReceipt021: TPS021.estimateAssistantEvent(event),');
  source = replaceTpsOnce(source, '\t\t\tmessage.assistantMetrics = {', '\t\t\tmessage.assistantMetrics = {\n\t\t\t\ttpsReceipt021: streaming ? null : node.tpsReceipt021,');
  const start = source.indexOf('\t\tfunction throughput(metrics, t) {');
  const end = source.indexOf('\n\t\t}', start) + '\n\t\t}'.length;
  if (start < 0 || end < start) throw Error('TPS throughput function missing');
  source = replaceTpsOnce(source, source.slice(start, end), '\t\tfunction throughput(metrics, t) {\n\t\t\treturn TPS021.formatStreamEstimate(metrics.tpsReceipt021).value;\n\t\t}');
  source = replaceTpsOnce(source, 'children: t("timing.throughput")', 'children: "输出速度（估算）"');
  new vm.Script(source);
  return { source, beforeSha256: sha256(original), afterSha256: sha256(source), replacements: 5 };
}
