import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { unpack, packageFiles } from '../desktop/package.mjs';
import { packSource } from '../desktop/releases/0.2.1-rc.3.1/Reproduce.mjs';
import { sha256 } from '../desktop/official-runtime.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv[2] || !process.argv[3] || !process.argv[4]) throw Error('Usage: node scripts/Release-Desktop.mjs <new-output-directory> <official-app.asar> <official-electron.exe>');
const output = path.resolve(process.argv[2]);
const archive = path.resolve(process.argv[3]);
const electron = path.resolve(process.argv[4]);
const release = JSON.parse(fs.readFileSync(path.join(root, 'desktop/releases/0.2.1-rc.3.1/manifest.json')));
if (sha256(fs.readFileSync(archive)) !== release.official.windowsX64.appAsarSha256 || sha256(fs.readFileSync(electron)) !== release.official.windowsX64.exeSha256) throw Error('Exact official rc.3 ASAR and Electron required');
if (fs.existsSync(output)) throw Error('Choose a new release output directory');
const candidate = path.join(output, '候选');
const run = (file, args, allowed = [0]) => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', file), ...args], { cwd: root, encoding: 'utf8', timeout: 120000 });
  if (!allowed.includes(result.status)) throw Error(`${file} failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return { exitCode: result.status };
};
fs.mkdirSync(output, { recursive: true });
run('Build-Desktop.mjs', [candidate, archive]);
const manifest = JSON.parse(fs.readFileSync(path.join(candidate, 'candidate-manifest.json')));
const bytes = fs.readFileSync(path.resolve(candidate, manifest.archive.path));
const expected = release.packages.find(row => row.name === 'dsh-desktop-compat');
function verifySource() {
  if (manifest.version !== expected.version || manifest.archive.sha256 !== expected.sha256 || sha256(bytes) !== expected.sha256) throw Error('Accepted rc.3 archive mismatch');
  const source = path.join(root, 'sources/dsh-desktop-compat'), members = unpack(bytes);
  if (members.size !== packageFiles.length) throw Error('Package member count mismatch');
  for (const file of packageFiles) {
    if (!members.get('package/' + file)?.equals(fs.readFileSync(path.join(source, file)))) throw Error('Source mismatch: ' + file);
  }
  if (!packSource(source).equals(bytes)) throw Error('Package is not reproducible');
}
verifySource();
const staging = path.join(candidate, 'package');
for (const [name, content] of unpack(bytes)) {
  const file = path.join(candidate, name);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
}
const tests = run('Test-Desktop.mjs', [path.join(output, 'packaged-test'), archive, electron, path.join(staging, 'lib/index.js')]);
const retirement = run('Test-DesktopRetirement.mjs', [path.join(output, 'retirement'), archive, electron], [0, 2]);
const testEvidence = JSON.parse(fs.readFileSync(path.join(output, 'packaged-test/test-results.json')));
if (testEvidence.status !== 'PASSED') throw Error('Packaged integration did not pass');
const errorEvidence = JSON.parse(fs.readFileSync(path.join(output, 'packaged-test/error-test-results.json')));
if (errorEvidence.status !== 'PASSED') throw Error('Packaged error integration did not pass');
// Catch source drift during tests before marking the candidate ready for main-controller Loader acceptance.
verifySource();
const report = { status: 'OFFLINE_GATES_PASSED', archive: manifest.archive,
  sourceMatchesPackage: true, reproducible: true, packagedIntegration: { ...tests, checks: testEvidence.cases.length, inferenceRequests: testEvidence.requests, discoveryRequests: testEvidence.discoveryRequests.length },
  errorIntegration: { checks: errorEvidence.cases.length, requests: errorEvidence.requests.length, cleanup: errorEvidence.cleanup },
  retirement: { ...retirement, ...JSON.parse(fs.readFileSync(path.join(output, 'retirement/retirement.json'))) },
  validation: { scope: 'Isolated loopback mocks and plugin loading; inferenceRequests count mock requests only', realProviderCalls: 0, sshCalls: 0, externalCodingCalls: 0 },
  pending: ['main-controller formal Loader and isolated deployment acceptance'], productionInstalled: false };
fs.writeFileSync(path.join(output, 'desktop-release-gates.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
