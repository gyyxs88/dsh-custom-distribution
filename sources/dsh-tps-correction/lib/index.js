export { METRIC_VERSION, LABEL, UNAVAILABLE, estimateReceiptTps, currentReceiptEstimate, formatReceiptEstimate } from './metric.js';
export { inspectRc2Attempt } from './rc2.js';
export * from './stream-estimate.js';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { initialStreamState, foldStreamEvent, streamStateView } from './stream-estimate.js';

export const name = 'tps-correction';
export const inject = ['sessionProjections'];
const estimateSchema = z.object({ version: z.literal(2), status: z.enum(['estimated', 'unavailable']),
  reason: z.string().nullable(), tps: z.number().nonnegative().nullable() }).passthrough();
const routeSchema = z.object({ provider: z.string(), model: z.string() }).nullable();
export const projectionDefinition = {
  key: 'tpsCorrectionV2', stateVersion: 2,
  stateSchema: z.object({ route: routeSchema, groups: z.record(z.string(), z.object({ pairedTokens: z.number().nonnegative(),
    pairedMs: z.number().nonnegative(), eligible: z.number().int().nonnegative(), rejected: z.number().int().nonnegative() })), latest: estimateSchema }),
  init: initialStreamState, apply: foldStreamEvent,
  wire: { viewSchema: z.object({ version: z.literal(2), route: routeSchema, eligible: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(), estimate: estimateSchema }), view: streamStateView },
};
/** Version/source guard uses public installed package exports, never private objects. */
export function apply(ctx) {
  const req = createRequire(import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('../upstream-manifest.json', import.meta.url)));
  for (const pkg of ['dsh-client-ui-trajectory', 'dsh-client-ui-chat']) {
    const file = req.resolve(`@deepseek-ai/${pkg}/package.json`);
    if (JSON.parse(readFileSync(file)).version !== '0.2.0-rc.2') throw Error(`TPS_RC2_VERSION_MISMATCH: ${pkg}`);
    const expected = manifest.files.find(row => row.path === `upstream/${pkg}/lib/client.js`);
    const actual = createHash('sha256').update(readFileSync(join(dirname(file), 'lib/client.js'))).digest('hex');
    if (actual !== expected.sha256) throw Error(`TPS_RC2_SOURCE_MISMATCH: ${pkg}`);
  }
  ctx.sessionProjections.register(projectionDefinition);
  ctx.provide('tpsCorrectionReady', Object.freeze({ version: 2, target: '0.2.0-rc.2' }));
}
