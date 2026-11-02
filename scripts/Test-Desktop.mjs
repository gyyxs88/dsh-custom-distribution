import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installation, sha256 } from '../desktop/official-runtime.mjs';
import { packSource } from '../desktop/releases/0.2.1-rc.5.1/Reproduce.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv[2] || !process.argv[3] || !process.argv[4]) throw Error('Usage: node scripts/Test-Desktop.mjs <isolated-output-directory> <official-app.asar> <official-electron.exe> [compat-entry]');
const output = path.resolve(process.argv[2]);
const archive = process.argv[3], electron = process.argv[4];
const release = JSON.parse(fs.readFileSync(path.join(root, 'desktop/releases/0.2.1-rc.5.1/manifest.json')));
if (sha256(fs.readFileSync(archive)) !== release.official.windowsX64.appAsarSha256 || sha256(fs.readFileSync(electron)) !== release.official.windowsX64.exeSha256) throw Error('Exact official rc.5 ASAR and Electron required');
const official = installation(archive);
if (official.some(pkg => pkg.version !== (pkg.name.endsWith('/cordis') ? '4.0.5' : release.runtimeVersion))) throw Error('Unsupported official installation');
const entry = process.argv[5] ? path.resolve(process.argv[5]) : path.join(root, 'desktop/releases/0.2.1-rc.5.1/build-inputs/dsh-desktop-compat/lib/index.js');
const source = path.resolve(path.dirname(entry), '..');
const expected = release.packages.find(row => row.name === 'dsh-desktop-compat');
if (sha256(packSource(source)) !== expected.sha256) throw Error('Compat source differs from fixed rc.5 package');
fs.mkdirSync(output, { recursive: true });
for (const [test, prefix] of [['desktop-compat.test.mjs', 'desktop-test'], ['desktop-errors.test.mjs', 'desktop-errors']]) {
const result = spawnSync(electron, [path.join(root, 'tests', test), archive, output, entry], {
  cwd: root, encoding: 'utf8', timeout: 120000, windowsHide: true,
  // Explicit isolated launch environment. Never inspect or inherit provider credentials/proxy env.
  env: { ELECTRON_RUN_AS_NODE: '1', SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows',
    TEMP: output, TMP: output, USERPROFILE: output, HOME: output, DSH_HOME: path.join(output, 'home'), PATH: 'C:\\Windows\\System32;C:\\Windows' }
});
fs.writeFileSync(path.join(output, `${prefix}.stdout.log`), result.stdout ?? '');
fs.writeFileSync(path.join(output, `${prefix}.stderr.log`), result.stderr ?? '');
console.log(result.stdout ?? '');
if (result.status !== 0) { console.error(result.stderr, result.error); process.exitCode = 1; }
}
