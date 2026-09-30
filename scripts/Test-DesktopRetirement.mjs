import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { defaultArchive, defaultElectron, installation } from '../desktop/official-runtime.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(root, '../../temp/desktop-repair-20260930/retirement'));
const archive = process.argv[3] ?? defaultArchive;
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'retirement.json'), `${JSON.stringify({ status: 'PROBING', supplementalImported: false, supplementalApplied: false, checks: [] })}\n`);
try {
  const official = installation(archive);
  const result = spawnSync(process.argv[4] ?? defaultElectron,
    [path.join(root, 'tests/desktop-retirement.test.mjs'), archive, output], {
      cwd: root, encoding: 'utf8', timeout: 120000,
      env: { ELECTRON_RUN_AS_NODE: '1', SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows',
        TEMP: output, TMP: output, PATH: 'C:\\Windows\\System32;C:\\Windows' }
    });
  fs.writeFileSync(path.join(output, 'retirement.stdout.log'), result.stdout ?? '');
  fs.writeFileSync(path.join(output, 'retirement.stderr.log'), result.stderr ?? '');
  if (result.status !== 0 && result.status !== 2) throw Error(`Official probe needs adaptation: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  const report = JSON.parse(fs.readFileSync(path.join(output, 'retirement.json')));
  report.official = official;
  fs.writeFileSync(path.join(output, 'retirement.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'ELIGIBLE' ? 0 : report.status === 'NOT_ELIGIBLE' ? 2 : 1;
} catch (error) {
  const existing = fs.existsSync(path.join(output, 'retirement.json')) ? JSON.parse(fs.readFileSync(path.join(output, 'retirement.json'))) : {};
  const report = { ...existing, status: 'NEEDS_ADAPTATION', supplementalImported: false, supplementalApplied: false, error: error.message };
  fs.writeFileSync(path.join(output, 'retirement.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2)); process.exitCode = 1;
}
