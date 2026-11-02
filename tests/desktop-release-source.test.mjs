import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { packSource, reproduce } from '../desktop/releases/0.2.1-rc.5.1/Reproduce.mjs';
import { assertTpsOutput } from '../scripts/Tps-Official.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const release = path.join(repo, 'desktop/releases/0.2.1-rc.5.1');
const manifest = JSON.parse(fs.readFileSync(path.join(release, 'manifest.json')));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('desktop release consumer contract resolves all six fixed archives locally', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.releaseTag, 'desktop-v0.2.1-rc.5.1');
  assert.equal(manifest.runtimeVersion, '0.2.1-rc.5');
  assert.equal(manifest.packages.length, 6);
  assert.equal(new Set(manifest.packages.map(row => row.name)).size, 6);
  assert.deepEqual(new Set(manifest.bundles), new Set(manifest.packages.map(row => row.name)));
  for (const row of manifest.packages) {
    assert.match(row.file, /^packages\/[a-z0-9.-]+\.tgz$/);
    assert.equal(sha256(fs.readFileSync(path.join(release, row.file))), row.sha256);
  }
  assert.deepEqual(manifest.compatibility, {
    '@omdsh-dev/dsh-genui@0.9.1-dsh021.3': ['0.2.1-rc.3', '0.2.1-rc.5'],
    'dsh-remote-control@0.3.3-dsh021.3': ['0.2.1-rc.5'],
    'dsh-session-control@0.8.5-dsh021.2': ['0.2.1-rc.3', '0.2.1-rc.5'],
    'dsh-subagent-code-agents@0.2.4-dsh021.1': ['0.2.1-rc.3', '0.2.1-rc.5'],
  });
  assert.equal(manifest.validation.realProviderCalls, 0);
  assert.equal(manifest.validation.realProviderUsageValidated, false);
  assert.doesNotMatch(JSON.stringify(manifest), /[A-Z]:[\\/]|Administrator/);
});

test('frozen compat source reproduces accepted package bytes', () => {
  for (const [name, directory] of [
    ['dsh-desktop-compat', path.join(release, 'build-inputs/dsh-desktop-compat')],
  ]) {
    const row = manifest.packages.find(row => row.name === name);
    assert.deepEqual(packSource(directory), fs.readFileSync(path.join(release, row.file)));
  }
});

test('four reused packages retain the previous release archive bytes', () => {
  const previous = path.join(repo, 'desktop/releases/0.2.1-rc.3.1');
  const oldManifest = JSON.parse(fs.readFileSync(path.join(previous, 'manifest.json')));
  const provenance = JSON.parse(fs.readFileSync(path.join(release, 'source/provenance.json')));
  assert.deepEqual(provenance.packages.adapted, ['dsh-desktop-compat', 'dsh-tps-correction']);
  assert.equal(provenance.packages.reusedOriginal.length, 4);
  for (const name of provenance.packages.reusedOriginal) {
    const current = manifest.packages.find(row => row.name === name);
    const old = oldManifest.packages.find(row => row.name === name);
    assert.equal(current.version, old.version);
    assert.equal(current.sha256, old.sha256);
    assert.deepEqual(fs.readFileSync(path.join(release, current.file)), fs.readFileSync(path.join(previous, old.file)));
  }
});

test('editable TPS builder, transforms and runtime sources match frozen release inputs', () => {
  for (const name of ['Build-Tps021.mjs', 'Tps-Official.mjs', 'Tps-Patch021.mjs']) {
    assert.deepEqual(fs.readFileSync(path.join(repo, 'scripts', name)), fs.readFileSync(path.join(release, 'build-inputs/tps/scripts', name)));
  }
  for (const name of ['rc021/index.js', 'rc021/README.md', 'lib/stream-estimate.js', 'LICENSE.deepseek']) {
    assert.deepEqual(fs.readFileSync(path.join(repo, 'sources/dsh-tps-correction', name)),
      fs.readFileSync(path.join(release, 'build-inputs/tps/sources/dsh-tps-correction', name)));
  }
});

test('public frozen inputs contain only the intended source whitelist and no private machine values', () => {
  const inputs = path.join(release, 'build-inputs');
  function files(directory, prefix = '') {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
      ? files(path.join(directory, entry.name), prefix + entry.name + '/') : [prefix + entry.name]);
  }
  assert.deepEqual(files(inputs).sort(), [
    ...['README.md', 'cordis.patch.yml', 'lib/contract.js', 'lib/discovery.js', 'lib/errors.js', 'lib/index.js', 'package.json'].map(name => 'dsh-desktop-compat/' + name),
    ...['Build-Tps021.mjs', 'Tps-Official.mjs', 'Tps-Patch021.mjs'].map(name => 'tps/scripts/' + name),
    ...['LICENSE.deepseek', 'lib/stream-estimate.js', 'rc021/README.md', 'rc021/index.js'].map(name => 'tps/sources/dsh-tps-correction/' + name),
  ].sort());
  for (const name of files(release).filter(name => !name.startsWith('packages/'))) {
    const source = fs.readFileSync(path.join(release, name), 'utf8');
    assert.doesNotMatch(source, /[cd]:[\\/](?:users|project|dsh)[\\/]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+/i, name);
  }
});

test('reproduction and direct callers reject unknown official bytes before output; TPS preserves nonempty output', () => {
  const directory = fs.mkdtempSync(path.join(process.env.DSH_SOURCE_TEST_ROOT ?? os.tmpdir(), 'dsh-rc5-source-'));
  try {
    const fakeAsar = path.join(directory, 'app.asar'), output = path.join(directory, 'output');
    fs.writeFileSync(fakeAsar, 'synthetic wrong version');
    assert.throws(() => reproduce(fakeAsar, output), /Exact official rc.5 ASAR required/);
    assert.equal(fs.existsSync(output), false);
    for (const name of ['Build-Desktop.mjs', 'Release-Desktop.mjs', 'Test-Desktop.mjs']) {
      const result = spawnSync(process.execPath, [path.join(repo, 'scripts', name), output, fakeAsar, fakeAsar],
        { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 10000 });
      assert.equal(result.status, 1, name);
      assert.match(result.stderr, /Exact official rc.5 ASAR/, name);
      assert.equal(fs.existsSync(output), false, name);
    }
    const ready = path.join(directory, 'ready.json');
    fs.writeFileSync(ready, JSON.stringify({ status: 'READY', version: manifest.runtimeVersion, archive: 'app.asar', sha256: { archive: sha256('synthetic wrong version') } }));
    const result = spawnSync(process.execPath, [path.join(repo, 'scripts/Build-Tps021.mjs'), ready, output],
      { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /TPS candidate identity mismatch/);
    assert.equal(fs.existsSync(output), false);
    assert.throws(() => assertTpsOutput(directory), /new or empty directory/);
    assert.equal(fs.readFileSync(fakeAsar, 'utf8'), 'synthetic wrong version');
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
