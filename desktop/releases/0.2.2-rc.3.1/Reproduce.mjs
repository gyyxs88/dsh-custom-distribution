import fs from 'node:fs';
import path from 'node:path';
import { digest, loadRelease } from '../../release-contract.mjs';
import { packSource } from '../0.2.2-rc.1.2/Reproduce.mjs';

const [asar, output] = process.argv.slice(2);
if (!asar || !output) throw Error('Usage: node Reproduce.mjs <official-app.asar> <fresh-output>');
if (fs.existsSync(output)) throw Error('Choose a fresh output directory.');

const { directory, manifest } = loadRelease('0.2.2-rc.3.1');
if (digest(fs.readFileSync(asar)) !== manifest.official.windowsX64.appAsarSha256) throw Error('Exact official rc.3 ASAR required.');
const previous = loadRelease(manifest.baseRelease.replace(/^desktop-v/, ''));
const byteOrder = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const packages = manifest.packages.map(pkg => {
  const source = path.join(directory, 'build-inputs', pkg.name);
  let bytes;
  if (pkg.name === 'dsh-desktop-compat' || pkg.name === 'dsh-tps-correction') {
    const meta = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    if (meta.name !== pkg.name || meta.version !== pkg.version) throw Error('Unexpected source metadata: ' + pkg.name);
    bytes = packSource(source, pkg.name === 'dsh-tps-correction' ? byteOrder : undefined);
  } else {
    const old = previous.manifest.packages.find(row => row.name === pkg.name);
    if (!old || old.version !== pkg.version || old.sha256 !== pkg.sha256) throw Error('Reused package identity changed: ' + pkg.name);
    bytes = fs.readFileSync(path.join(previous.directory, old.file));
  }
  if (digest(bytes) !== pkg.sha256 || digest(fs.readFileSync(path.join(directory, pkg.file))) !== pkg.sha256) throw Error('Package checksum mismatch: ' + pkg.name);
  return { file: path.basename(pkg.file), sha256: pkg.sha256, bytes };
});
fs.mkdirSync(output, { recursive: true });
for (const pkg of packages) fs.writeFileSync(path.join(output, pkg.file), pkg.bytes);
console.log(JSON.stringify(packages.map(({ file, sha256 }) => ({ file, sha256 })), null, 2));
