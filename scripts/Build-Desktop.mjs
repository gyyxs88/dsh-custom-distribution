import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack, verify } from '../desktop/package.mjs';
import { sha256, installation } from '../desktop/official-runtime.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'sources/dsh-desktop-compat');
const output = path.resolve(process.argv[2] ?? path.join(root, '../../temp/desktop-repair-20260930/候选'));
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
const bytes = pack(source), files = verify(source, bytes);
fs.mkdirSync(output, { recursive: true });
const target = path.join(output, `${manifest.name}-${manifest.version}.tgz`);
if (fs.existsSync(target) && !fs.readFileSync(target).equals(bytes)) throw Error('Fixed candidate exists with different bytes; choose a new version');
fs.writeFileSync(target, bytes);
const evidence = { package: manifest.name, version: manifest.version, archive: { path: target, sha256: sha256(bytes), bytes: bytes.length }, files,
  official: installation(process.argv[3]), reproducible: true };
fs.writeFileSync(path.join(output, 'candidate-manifest.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
