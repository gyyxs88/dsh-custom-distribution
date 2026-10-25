import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { initialStreamState, foldStreamEvent, streamStateView } from './stream-estimate.js';
export const name = 'tps-correction-021';
export const inject = ['sessionProjections'];
const estimate = z.object({ version: z.literal(2), status: z.enum(['estimated', 'unavailable']), reason: z.string().nullable(), tps: z.number().nonnegative().nullable() }).passthrough();
const route = z.object({ provider: z.string(), model: z.string() }).nullable();
export const projectionDefinition = {
  key: 'tpsCorrectionV2', stateVersion: 2,
  stateSchema: z.object({ route, groups: z.record(z.string(), z.object({ pairedTokens: z.number().nonnegative(), pairedMs: z.number().nonnegative(), eligible: z.number().int().nonnegative(), rejected: z.number().int().nonnegative() })), latest: estimate }),
  init: initialStreamState, apply: foldStreamEvent,
  wire: { viewSchema: z.object({ version: z.literal(2), route, eligible: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(), estimate }), view: streamStateView },
};
export function apply(ctx) {
  const req = createRequire(import.meta.url);
  const contract = JSON.parse(fs.readFileSync(new URL('./contract.json', import.meta.url)));
  for (const row of contract.official) {
    const manifestPath = req.resolve(`${row.name}/package.json`);
    if (JSON.parse(fs.readFileSync(manifestPath)).version !== row.version) throw Error('TPS_OFFICIAL_VERSION_MISMATCH');
    if (row.clientSha256) {
      const hash = createHash('sha256').update(fs.readFileSync(path.join(path.dirname(manifestPath), 'lib/client.js'))).digest('hex');
      if (![row.clientSha256, row.patchedSha256].includes(hash)) throw Error('TPS_OFFICIAL_SOURCE_MISMATCH');
    }
  }
  ctx.sessionProjections.register(projectionDefinition);
}
