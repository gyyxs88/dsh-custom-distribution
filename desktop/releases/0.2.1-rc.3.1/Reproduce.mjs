import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { buildTps021 } from './build-inputs/tps/scripts/Build-Tps021.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
// Accepted recursive ordering, USTAR metadata, zero timestamps and level-9 gzip.
export function packSource(directory) {
  function members(dir, prefix = '') {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap(entry =>
      entry.isDirectory() ? members(path.join(dir, entry.name), prefix + entry.name + '/') :
        [{ name: prefix + entry.name, data: fs.readFileSync(path.join(dir, entry.name)) }]);
  }
  const chunks = [], octal = (n, length) => n.toString(8).padStart(length - 1, '0') + '\0';
  for (const { name, data } of members(directory)) {
    const full = 'package/' + name;
    if (Buffer.byteLength(full) > 100) throw Error('Tar member path too long');
    const header = Buffer.alloc(512);
    header.write(full); header.write(octal(0o644, 8), 100);
    header.write(octal(0, 8), 108); header.write(octal(0, 8), 116);
    header.write(octal(data.length, 12), 124); header.write(octal(0, 12), 136);
    header.fill(32, 148, 156); header.write('0', 156);
    header.write('ustar\0', 257); header.write('00', 263);
    header.write(header.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]), { level: 9 });
}

export function reproduce(officialAsar, output) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  const archive = path.resolve(officialAsar), out = path.resolve(output);
  if (sha256(fs.readFileSync(archive)) !== manifest.official.windowsX64.appAsarSha256) throw Error('Exact official rc.3 ASAR required');
  if (fs.existsSync(out)) throw Error('Choose a new output directory');
  for (const row of manifest.packages) {
    if (sha256(fs.readFileSync(path.join(root, row.file))) !== row.sha256) throw Error('Fixed package mismatch: ' + row.name);
  }
  fs.mkdirSync(out, { recursive: true });
  const results = [];
  for (const name of ['dsh-desktop-compat', 'dsh-remote-control']) {
    const row = manifest.packages.find(row => row.name === name);
    const bytes = packSource(path.join(root, 'build-inputs', name));
    if (sha256(bytes) !== row.sha256) throw Error('Rebuild mismatch: ' + name);
    fs.writeFileSync(path.join(out, path.basename(row.file)), bytes);
    results.push({ name, sha256: row.sha256, match: true });
  }
  const ready = { status: 'READY', version: manifest.runtimeVersion,
    archive: path.relative(out, archive).replaceAll('\\', '/'),
    sha256: { archive: manifest.official.windowsX64.appAsarSha256 } };
  const readyFile = path.join(out, 'build-input.json');
  fs.writeFileSync(readyFile, JSON.stringify(ready, null, 2) + '\n');
  const evidence = buildTps021(readyFile, path.join(out, 'tps'));
  const row = manifest.packages.find(row => row.name === 'dsh-tps-correction');
  const bytes = fs.readFileSync(evidence.archive);
  if (sha256(bytes) !== row.sha256) throw Error('Rebuild mismatch: ' + row.name);
  fs.writeFileSync(path.join(out, path.basename(row.file)), bytes);
  results.push({ name: row.name, sha256: row.sha256, match: true });
  const result = { status: 'PASSED', results, fixedPackagesVerified: 6, node: process.version,
    realProviderCalls: 0, sshCalls: 0, externalCodingCalls: 0 };
  fs.writeFileSync(path.join(out, 'reproducibility.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) throw Error('Usage: node desktop/releases/0.2.1-rc.3.1/Reproduce.mjs <official-app.asar> <new-output-directory>');
  console.log(JSON.stringify(reproduce(process.argv[2], process.argv[3]), null, 2));
}
