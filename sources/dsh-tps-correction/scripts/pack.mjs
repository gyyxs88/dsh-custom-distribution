import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const source = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv[2]) throw Error('An isolated candidate output directory is required');
const output = path.resolve(process.argv[2]);
if (output === source || output.startsWith(source + path.sep)) throw Error('Candidate must be outside the source package');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
const roots = ['README.md', 'integration-contract.json', 'lib', 'compat', 'upstream', 'upstream-manifest.json',
  'compat-build.json', 'cordis.patch.yml', 'LICENSE.deepseek', 'package.json', 'scripts'];
function list(name) {
  const file = path.join(source, name);
  return fs.statSync(file).isDirectory() ? fs.readdirSync(file).sort().flatMap(child => list(`${name}/${child}`)) : [name];
}
const files = roots.flatMap(list).sort();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const octal = (n, length) => `${n.toString(8).padStart(length - 1, '0')}\0`;
function pack() {
  const parts = [];
  for (const name of files) {
    const bytes = fs.readFileSync(path.join(source, name));
    const header = Buffer.alloc(512);
    header.write(`package/${name}`, 0, 100);
    header.write(octal(0o644, 8), 100); header.write(octal(0, 8), 108); header.write(octal(0, 8), 116);
    header.write(octal(bytes.length, 12), 124); header.write(octal(0, 12), 136);
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
    header.write(`${header.reduce((n, byte) => n + byte, 0).toString(8).padStart(6, '0')}\0 `, 148);
    parts.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]), { level: 9 });
}
const bytes = pack();
assert.ok(bytes.equals(pack()), 'two builds must be byte-identical');
fs.mkdirSync(output, { recursive: true });
const target = path.join(output, `${manifest.name}-${manifest.version}.tgz`);
if (fs.existsSync(target) && !fs.readFileSync(target).equals(bytes)) throw Error('Existing candidate differs; review and use a new version');
fs.writeFileSync(target, bytes);
const isolated = path.join(output, `isolated-package-${manifest.version}`);
const tar = gunzipSync(bytes), verified = [];
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512);
  if (header.every(byte => byte === 0)) break;
  const field = (start, end) => header.subarray(start, end).toString('utf8').split('\0')[0];
  const name = field(0, 100), size = parseInt(field(124, 136).trim(), 8);
  assert.ok(files.map(n => `package/${n}`).includes(name) && !verified.some(r => r.path === name), 'allowlisted unique member');
  assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
  const payload = tar.subarray(offset + 512, offset + 512 + size);
  const file = name.slice('package/'.length);
  assert.ok(payload.equals(fs.readFileSync(path.join(source, file))), `source bytes: ${file}`);
  const destination = path.join(isolated, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, payload);
  verified.push({ path: name, sha256: hash(payload), bytes: payload.length });
  offset += 512 + Math.ceil(size / 512) * 512;
}
assert.equal(verified.length, files.length);
const candidate = await import(pathToFileURL(path.join(isolated, 'lib/stream-estimate.js')).href);
assert.equal(candidate.formatStreamEstimate(null).value, '暂无法计算');
const numeric=candidate.estimateStreamMetadata({provider:'p',model:'m',attemptId:'pack-proof',status:'completed',usage:{outputTokens:1100},
  receipts:Array.from({length:11},(_,i)=>({time:i*1000,units:100,channel:'text'}))});
assert.equal(numeric.tps,100);
assert.equal(JSON.parse(fs.readFileSync(path.join(isolated, 'integration-contract.json'))).profileInstallable, true);
const evidence = {
  package: manifest.name, version: manifest.version, targetOfficial: '0.2.0-rc.2', releaseGate: 'MAIN_UI_ACCEPTED_FIXED_ARTIFACT_PENDING',
  artifactKind: 'external-profile-compatibility-bundle', profileInstallable: true,
  archive: { path: target, sha256: hash(bytes), bytes: bytes.length }, files: verified,
  reproducible: true, sourceByteEquality: true, isolatedImport: 'PASS', isolatedNumericEstimate: numeric.tps,
  productionWrites: 0, networkCalls: 0, dependenciesBundled: 0,
};
fs.writeFileSync(path.join(output, 'candidate-manifest.json'), `${JSON.stringify(evidence, null, 2)}\n`);
fs.writeFileSync(path.join(output, 'candidate-manifest-v2.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ...evidence, files: `${verified.length} source-equal members` }, null, 2));
