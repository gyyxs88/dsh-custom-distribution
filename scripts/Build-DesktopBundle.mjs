// Package accepted bytes only; never build plugins, change the official program,
// download dependencies, publish, or include profiles/evidence/build inputs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(repo, 'dist/desktop-v0.2.1-rc.3.1'));
const release = path.join(repo, 'desktop/releases/0.2.1-rc.3.1');
const packageSource = path.resolve(process.argv[3] ?? path.join(release, 'packages'));
const manifest = JSON.parse(fs.readFileSync(path.join(release, 'manifest.json'), 'utf8'));
if (manifest.releaseTag !== 'desktop-v0.2.1-rc.3.1' || manifest.schemaVersion !== 1 || manifest.packages.length !== 6) throw Error('Unexpected Desktop manifest.');
if (fs.existsSync(output) && fs.readdirSync(output).length) throw Error('Output exists. Choose a fresh directory; existing artifacts are retained.');
const stage = path.join(output, 'bundle');
fs.mkdirSync(stage, { recursive: true });
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const copy = (source, destination) => { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(source, destination); };
copy(path.join(release, 'manifest.json'), path.join(stage, 'manifest.json'));
for (const p of manifest.packages) {
  if (!/^packages\/[a-z0-9.-]+\.tgz$/.test(p.file)) throw Error('Unexpected package path.');
  const input = path.join(packageSource, path.basename(p.file));
  if (sha256(input) !== p.sha256) throw Error(`Accepted package hash mismatch: ${p.name}`);
  copy(input, path.join(stage, p.file));
}
for (const relative of ['scripts/Install-Desktop.ps1', 'desktop/installer.mjs', 'docs/桌面安装发行说明.md']) copy(path.join(repo, relative), path.join(stage, relative));
fs.writeFileSync(path.join(stage, 'README.txt'), 'DSH Desktop rc.3 plugins\r\nRight-click scripts/Install-Desktop.ps1 > Run with PowerShell.\r\nVerify: -Action Verify. Rollback: -Action Rollback.\r\nQuit the Desktop normally first. See docs for details.\r\n');
const zip = path.join(output, 'dsh-desktop-v0.2.1-rc.3.1-win-x64.zip');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
// Fixed timestamps make repeated packaging of the same inputs reproducible.
function timestamp(dir) { for (const name of fs.readdirSync(dir).sort()) { const file = path.join(dir, name); if (fs.statSync(file).isDirectory()) timestamp(file); fs.utimesSync(file, new Date('2026-10-25T00:00:00Z'), new Date('2026-10-25T00:00:00Z')); } }
timestamp(stage);
execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${quote(stage)}, ${quote(zip)})`], { stdio: 'pipe' });
const digest = sha256(zip);
let bootstrap = fs.readFileSync(path.join(repo, 'scripts/Install-Desktop.ps1'), 'utf8');
bootstrap = bootstrap.replace('__DESKTOP_BUNDLE_SHA256__', digest);
fs.writeFileSync(path.join(output, 'Install-Desktop.ps1'), bootstrap);
const assets = [path.basename(zip), 'Install-Desktop.ps1'].map(file => ({ file, size: fs.statSync(path.join(output, file)).size, sha256: sha256(path.join(output, file)) }));
fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), assets.map(a => `${a.sha256}  ${a.file}`).join('\n') + '\n');
fs.writeFileSync(path.join(output, 'publish-assets.json'), JSON.stringify({ releaseTag: manifest.releaseTag, prerelease: true, makeLatest: false, assets, realProviderCalls: 0 }, null, 2) + '\n');
console.log(JSON.stringify({ status: 'BUILT_NOT_PUBLISHED', output, assets }));
