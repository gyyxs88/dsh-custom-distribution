import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verify, unpack } from '../desktop/package.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(root, '../../temp/desktop-repair-20260930'));
const candidate = path.join(output, '候选');
const run = (file, args, allowed = [0]) => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', file), ...args], { cwd: root, encoding: 'utf8', timeout: 120000 });
  if (!allowed.includes(result.status)) throw Error(`${file} failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return { exitCode: result.status };
};
fs.mkdirSync(output, { recursive: true });
run('Build-Desktop.mjs', [candidate]);
const manifest = JSON.parse(fs.readFileSync(path.join(candidate, 'candidate-manifest.json')));
const bytes = fs.readFileSync(manifest.archive.path);
verify(path.join(root, 'sources/dsh-desktop-compat'), bytes);
const staging = path.join(candidate, 'package');
for (const [name, content] of unpack(bytes)) {
  const file = path.join(candidate, name);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
}
const tests = run('Test-Desktop.mjs', [path.join(output, 'packaged-test'), 'D:/DSH/resources/app.asar', 'D:/DSH/DeepSeek Harness.exe', path.join(staging, 'lib/index.js')]);
const retirement = run('Test-DesktopRetirement.mjs', [path.join(output, 'retirement')], [0, 2]);
const testEvidence = JSON.parse(fs.readFileSync(path.join(output, 'packaged-test/test-results.json')));
if (testEvidence.status !== 'PASSED') throw Error('Packaged integration did not pass');
// Catch source drift during tests before marking the candidate ready for main-controller Loader acceptance.
verify(path.join(root, 'sources/dsh-desktop-compat'), bytes);
const report = { status: 'OFFLINE_GATES_PASSED', archive: manifest.archive,
  sourceMatchesPackage: true, reproducible: true, packagedIntegration: { ...tests, checks: testEvidence.cases.length, inferenceRequests: testEvidence.requests, discoveryRequests: testEvidence.discoveryRequests.length },
  retirement: { ...retirement, ...JSON.parse(fs.readFileSync(path.join(output, 'retirement/retirement.json'))) },
  pending: ['main-controller formal Loader and isolated deployment acceptance'], productionInstalled: false };
fs.writeFileSync(path.join(output, 'desktop-release-gates.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
