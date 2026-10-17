import fs from 'node:fs';
import vm from 'node:vm';
import { sha256 } from './Tps-Official.mjs';
export const trajectory021Sha256 = '0f2f622e264c8e64996df5bfde6efdc233f19e4d9f597e69d9c0c1faa75c7b72';
export const chat021Sha256 = 'a130b58fd24ea9b1e2a6a0f516009e9f9bfa9dc289cc8ebf004a735496fa52ca';
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
