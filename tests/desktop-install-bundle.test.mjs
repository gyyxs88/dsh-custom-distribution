import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const repo = fileURLToPath(new URL('../', import.meta.url));
const bundle = process.env.DSH_INSTALL_TEST_BUNDLE;
const base = process.env.DSH_INSTALL_TEST_ROOT;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

test('Desktop assets contain only six fixed packages and reproduce byte for byte', { skip: !(bundle && base) }, () => {
  const output = path.dirname(bundle), manifest = json(path.join(bundle, 'manifest.json'));
  const publish = json(path.join(output, 'publish-assets.json'));
  assert.equal(publish.releaseTag, 'desktop-v0.2.1-rc.5.1');
  assert.equal(publish.prerelease, true);
  assert.equal(publish.makeLatest, false);
  const files = ['dsh-desktop-v0.2.1-rc.5.1-win-x64.zip', 'Install-Desktop.ps1', 'SHA256SUMS.txt', 'publish-assets.json'];
  assert.deepEqual(publish.uploadFiles, files);
  for (const asset of publish.assets) {
    const bytes = fs.readFileSync(path.join(output, asset.file));
    assert.equal(bytes.length, asset.size);
    assert.equal(hash(bytes), asset.sha256);
  }
  assert.equal(publish.assets.length, 3);
  const bootstrap = fs.readFileSync(path.join(output, 'Install-Desktop.ps1'), 'utf8');
  assert.ok(bootstrap.startsWith('\uFEFF'));
  assert.ok(!bootstrap.includes('__DESKTOP_BUNDLE_SHA256__'));
  assert.ok(bootstrap.includes(`$bundleSha256 = '${hash(fs.readFileSync(path.join(output, files[0])))}'`));
  assert.ok(bootstrap.includes('https://github.com/gyyxs88/dsh-custom-distribution/releases/download/$releaseTag'));
  assert.equal(fs.readFileSync(path.join(output, 'SHA256SUMS.txt'), 'utf8'), publish.assets.slice(0, 2).map(a => `${a.sha256}  ${a.file}`).join('\n') + '\n');

  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const command = `[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [IO.Compression.ZipFile]::OpenRead(${quote(path.join(output, files[0]))}); try { @($zip.Entries | Where-Object { $_.Name } | ForEach-Object { $stream = $_.Open(); $sha = [Security.Cryptography.SHA256]::Create(); try { @{ file = $_.FullName; sha256 = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } } finally { $stream.Dispose(); $sha.Dispose() } }) | ConvertTo-Json -Compress } finally { $zip.Dispose() }`;
  const listing = spawnSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
  assert.equal(listing.status, 0, listing.stderr);
  // .NET Framework's Windows ZIP writer uses backslashes for member paths.
  const members = JSON.parse(listing.stdout).map(e => ({ ...e, file: e.file.replaceAll('\\', '/') }));
  const expected = [...manifest.packages.map(p => p.file), 'manifest.json', 'scripts/Install-Desktop.ps1', 'desktop/installer.mjs', 'docs/桌面安装发行说明.md', 'README.txt'];
  assert.deepEqual(members.map(e => e.file).sort(), expected.sort());
  for (const entry of members) assert.equal(entry.sha256, hash(fs.readFileSync(path.join(bundle, entry.file))), entry.file);
  for (const pkg of manifest.packages) assert.equal(hash(fs.readFileSync(path.join(bundle, pkg.file))), pkg.sha256);
  for (const relative of ['scripts/Install-Desktop.ps1', 'desktop/installer.mjs', 'docs/桌面安装发行说明.md']) {
    assert.ok(fs.readFileSync(path.join(bundle, relative)).equals(fs.readFileSync(path.join(repo, relative))), relative);
    assert.doesNotMatch(fs.readFileSync(path.join(bundle, relative), 'utf8'), /[CD]:[\\/](?:Users|Project|assistant|DSH)(?:[\\/]|\b)/i);
  }
  assert.ok(fs.readFileSync(path.join(bundle, 'manifest.json')).equals(fs.readFileSync(path.join(repo, 'desktop/releases/0.2.1-rc.5.1/manifest.json'))));
  const rebuilt = path.join(base, 'asset-rebuild-' + Date.now());
  const build = spawnSync(process.execPath, [path.join(repo, 'scripts/Build-DesktopBundle.mjs'), rebuilt], { encoding: 'utf8', windowsHide: true });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  for (const file of files) assert.ok(fs.readFileSync(path.join(output, file)).equals(fs.readFileSync(path.join(rebuilt, file))), file);
  fs.writeFileSync(path.join(base, 'asset-results.json'), JSON.stringify({ status: 'PASSED', files, exactZipMembers: members, fixedPackageCount: 6, bootstrapDigestPinned: true, utf8Bom: true, reproducible: true, rebuilt, publicMachinePathsFound: false }, null, 2) + '\n');
});
