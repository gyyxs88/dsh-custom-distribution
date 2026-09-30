import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { defaultArchive, defaultElectron, installation } from '../desktop/official-runtime.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(root, '../../temp/desktop-repair-20260930'));
const archive = process.argv[3] ?? defaultArchive, electron = process.argv[4] ?? defaultElectron;
const official = installation(archive);
if (official.some(pkg => pkg.version !== (pkg.name.endsWith('/cordis') ? '4.0.4' : '0.2.0-rc.2'))) throw Error('Unsupported official installation');
fs.mkdirSync(output, { recursive: true });
const entry = process.argv[5] ?? path.join(root, 'sources/dsh-desktop-compat/lib/index.js');
const result = spawnSync(electron, [path.join(root, 'tests/desktop-compat.test.mjs'), archive, output, entry], {
  cwd: root, encoding: 'utf8', timeout: 120000,
  // Explicit isolated launch environment. Never inspect or inherit provider credentials/proxy env.
  env: { ELECTRON_RUN_AS_NODE: '1', SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows',
    TEMP: output, TMP: output, PATH: 'C:\\Windows\\System32;C:\\Windows' }
});
fs.writeFileSync(path.join(output, 'desktop-test.stdout.log'), result.stdout ?? '');
fs.writeFileSync(path.join(output, 'desktop-test.stderr.log'), result.stderr ?? '');
console.log(result.stdout ?? '');
if (result.status !== 0) { console.error(result.stderr, result.error); process.exitCode = 1; }
