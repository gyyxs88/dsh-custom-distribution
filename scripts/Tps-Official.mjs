import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function readTpsArchive(archive) {
  const previous=process.noAsar;
  try { if(process.versions.electron)process.noAsar=true;return fs.readFileSync(archive); }
  finally { if(process.versions.electron)process.noAsar=previous; }
}
export function readTpsPacked(archive, member) {
  if (!/^dsh\/node_modules\/(?:@deepseek-ai\/[\w-]+|zod)\/(?:package.json|lib\/[\w./-]+\.(?:js|json))$/.test(member) || member.includes('..')) throw Error('Source-only member required');
  const previous=process.noAsar;if(process.versions.electron)process.noAsar=true;
  let fd;
  try {
    fd=fs.openSync(archive, 'r');
    const prefix = Buffer.alloc(16); fs.readSync(fd, prefix, 0, 16, 0);
    const headerSize = prefix.readUInt32LE(12);
    if (headerSize > 32 * 1024 * 1024) throw Error('Unsafe header');
    const bytes = Buffer.alloc(headerSize); fs.readSync(fd, bytes, 0, headerSize, 16);
    const entry = member.split('/').reduce((node, key) => node?.files?.[key], JSON.parse(bytes));
    if (!entry || entry.unpacked || !Number.isInteger(entry.size) || entry.size > 16000000) throw Error(`Unsafe member ${member}`);
    const output = Buffer.alloc(entry.size);
    fs.readSync(fd, output, 0, output.length, 8 + prefix.readUInt32LE(4) + Number(entry.offset));
    return output;
  } finally { if(fd!==undefined)fs.closeSync(fd);if(process.versions.electron)process.noAsar=previous; }
}
export function assertTpsOutput(output) {
  if (!output) throw Error('Explicit TPS output directory required');
  const target = path.resolve(output);
  if (fs.existsSync(target) && (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length)) throw Error('TPS output must be a new or empty directory');
  return target;
}
