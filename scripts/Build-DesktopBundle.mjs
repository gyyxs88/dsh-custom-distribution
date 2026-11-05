// Package accepted bytes only; never build plugins, change the official program,
// download dependencies, publish, or include profiles/evidence/build inputs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadRelease, legacyVersion, validateManifest, digest, assetName, renderPowerShell, renderInstaller } from '../desktop/release-contract.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
export function buildBundle(output, selected, packageSource = path.join(selected.directory, 'packages')) {
output = path.resolve(output);
const { directory: release, manifest, manifestSha256 } = selected;
validateManifest(manifest, manifest.releaseTag.replace(/^desktop-v/, ''));
if (digest(fs.readFileSync(path.join(release, 'manifest.json'))) !== manifestSha256) throw Error('Release manifest changed during build.');
// Verify all fixed inputs before creating output.
const packages = manifest.packages.map(p => {
  const bytes = fs.readFileSync(path.join(packageSource, path.basename(p.file)));
  if (digest(bytes) !== p.sha256) throw Error(`Accepted package hash mismatch: ${p.name}`);
  return { file: p.file, bytes };
});
if (fs.existsSync(output) && fs.readdirSync(output).length) throw Error('Output exists. Choose a fresh directory; existing artifacts are retained.');
const stage = path.join(output, 'bundle');
fs.mkdirSync(stage, { recursive: true });
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const copy = (source, destination) => { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(source, destination); };
copy(path.join(release, 'manifest.json'), path.join(stage, 'manifest.json'));
for (const p of packages) {
  fs.mkdirSync(path.dirname(path.join(stage, p.file)), { recursive: true });
  fs.writeFileSync(path.join(stage, p.file), p.bytes);
}
const bootstrapTemplate = renderPowerShell(fs.readFileSync(path.join(repo, 'scripts/Install-Desktop.ps1'), 'utf8'), manifest, manifestSha256);
copy(fs.existsSync(path.join(release, 'INSTALL.md')) ? path.join(release, 'INSTALL.md') : path.join(repo, 'docs/桌面安装发行说明-0.2.1-rc.5.1.md'), path.join(stage, 'docs/桌面安装发行说明.md'));
if (fs.existsSync(path.join(release, 'MIGRATION.md'))) copy(path.join(release, 'MIGRATION.md'), path.join(stage, 'docs/MIGRATION.md'));
fs.mkdirSync(path.join(stage, 'scripts'), { recursive: true });
fs.mkdirSync(path.join(stage, 'desktop'), { recursive: true });
fs.writeFileSync(path.join(stage, 'scripts/Install-Desktop.ps1'), bootstrapTemplate);
fs.writeFileSync(path.join(stage, 'desktop/installer.mjs'), renderInstaller(fs.readFileSync(path.join(repo, 'desktop/installer.mjs'), 'utf8'), manifestSha256));
fs.writeFileSync(path.join(stage, 'README.txt'), `DSH Desktop ${manifest.runtimeVersion} plugins (${manifest.packages.length} packages)\r\nRight-click scripts/Install-Desktop.ps1 > Run with PowerShell.\r\nVerify: -Action Verify. Rollback: -Action Rollback.\r\nQuit the Desktop normally first. See docs for details.\r\n`);
const zip = path.join(output, assetName(manifest));
const quote = value => "'" + value.replaceAll("'", "''") + "'";
// Fixed timestamps make repeated packaging of the same inputs reproducible.
function timestamp(dir) { for (const name of fs.readdirSync(dir).sort()) { const file = path.join(dir, name); if (fs.statSync(file).isDirectory()) timestamp(file); fs.utimesSync(file, new Date('2026-11-02T00:00:00Z'), new Date('2026-11-02T00:00:00Z')); } }
timestamp(stage);
execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${quote(stage)}, ${quote(zip)})`], { stdio: 'pipe', windowsHide: true });
const zipDigest = sha256(zip);
let bootstrap = bootstrapTemplate;
bootstrap = bootstrap.replace('__DESKTOP_BUNDLE_SHA256__', zipDigest);
if (!bootstrap.startsWith('\uFEFF') || bootstrap.includes('__DESKTOP_BUNDLE_SHA256__')) throw Error('Expected a UTF-8 BOM bootstrap with one digest placeholder.');
fs.writeFileSync(path.join(output, 'Install-Desktop.ps1'), bootstrap);
const assets = [path.basename(zip), 'Install-Desktop.ps1'].map(file => ({ file, size: fs.statSync(path.join(output, file)).size, sha256: sha256(path.join(output, file)) }));
fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), assets.map(a => `${a.sha256}  ${a.file}`).join('\n') + '\n');
assets.push({ file: 'SHA256SUMS.txt', size: fs.statSync(path.join(output, 'SHA256SUMS.txt')).size, sha256: sha256(path.join(output, 'SHA256SUMS.txt')) });
fs.writeFileSync(path.join(output, 'publish-assets.json'), JSON.stringify({ releaseTag: manifest.releaseTag, prerelease: true, makeLatest: false, assets, uploadFiles: [...assets.map(a => a.file), 'publish-assets.json'], realProviderCalls: 0 }, null, 2) + '\n');
return { status: 'BUILT_NOT_PUBLISHED', output, assets };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.argv[4] ?? legacyVersion;
  const selected = loadRelease(version);
  const output = path.resolve(process.argv[2] ?? path.join(repo, `dist/${selected.manifest.releaseTag}`));
  console.log(JSON.stringify(buildBundle(output, selected, process.argv[3] ? path.resolve(process.argv[3]) : undefined)));
}
