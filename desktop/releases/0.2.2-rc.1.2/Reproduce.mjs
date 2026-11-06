import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { loadRelease } from '../../release-contract.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function files(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en')).flatMap(entry =>
    entry.isDirectory() ? files(path.join(directory, entry.name), prefix + entry.name + '/') : [{ name: prefix + entry.name, data: fs.readFileSync(path.join(directory, entry.name)) }]);
}
// Accepted seven-member USTAR ordering, zero metadata, level-9 gzip.
export function packSource(directory) {
  const parts = [], oct = (n,l) => n.toString(8).padStart(l-1, '0') + '\0';
  for (const { name, data } of files(directory)) {
    const full = 'package/' + name;
    if (Buffer.byteLength(full) > 100) throw Error('Tar path too long');
    const header = Buffer.alloc(512);
    header.write(full); header.write(oct(0o644,8),100); header.write(oct(0,8),108); header.write(oct(0,8),116);
    header.write(oct(data.length,12),124); header.write(oct(0,12),136); header.fill(32,148,156);
    header.write('0',156); header.write('ustar\0',257); header.write('00',263);
    header.write(header.reduce((a,b) => a+b,0).toString(8).padStart(6,'0') + '\0 ',148);
    parts.push(header, data, Buffer.alloc((512-data.length%512)%512));
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]), { level: 9 });
}
export function reproduce(officialAsar, output) {
  const { manifest } = loadRelease('0.2.2-rc.1.2'), old = loadRelease('0.2.2-rc.1.1');
  if (sha(fs.readFileSync(officialAsar)) !== manifest.official.windowsX64.appAsarSha256) throw Error('Exact original 0.2.2-rc.1 ASAR required');
  if (JSON.stringify(manifest.compatibility) !== JSON.stringify(old.manifest.compatibility)) throw Error('Reused exact compatibility grants changed');
  if (fs.existsSync(output)) throw Error('Choose a fresh output directory');
  const rows = manifest.packages.map(row => {
    const original = old.manifest.packages.find(p => p.name === row.name);
    let bytes, mode;
    if (row.name === 'dsh-desktop-compat') {
      const source = path.join(root, 'build-inputs/dsh-desktop-compat');
      const meta = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
      if (meta.name !== row.name || meta.version !== row.version || files(source).length !== 7) throw Error('Unexpected compatibility source');
      bytes = packSource(source); mode = 'rebuilt-from-new-source';
    } else {
      if (!original || row.version !== original.version || row.sha256 !== original.sha256 || row.file !== original.file) throw Error('Reused package identity changed: ' + row.name);
      bytes = fs.readFileSync(path.join(old.directory, original.file)); mode = 'fixed-original-hash-verified';
    }
    if (sha(bytes) !== row.sha256 || sha(fs.readFileSync(path.join(root, row.file))) !== row.sha256) throw Error('Package mismatch: ' + row.name);
    return { ...row, bytes, mode };
  });
  fs.mkdirSync(output, { recursive: true });
  for (const row of rows) fs.writeFileSync(path.join(output, path.basename(row.file)), row.bytes);
  const result = { status: 'FROZEN_INPUTS_REPRODUCED', rebuiltPackages: 1, originalPackagesVerified: 5,
    exactCompatibilityGrantsUnchanged: true, realProviderCalls: 0, productionWrites: 0,
    results: rows.map(({ name, sha256, mode }) => ({ name, sha256, mode, match: true })) };
  fs.writeFileSync(path.join(output, 'reproducibility.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw Error('Usage: node Reproduce.mjs <original-app.asar> <fresh-output>');
  console.log(JSON.stringify(reproduce(path.resolve(process.argv[2]), path.resolve(process.argv[3])), null, 2));
}
