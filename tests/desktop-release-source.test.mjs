import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { packSource, reproduce } from '../desktop/releases/0.2.1-rc.3.1/Reproduce.mjs';
import { assertTpsOutput } from '../scripts/Tps-Official.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const release = path.join(repo, 'desktop/releases/0.2.1-rc.3.1');
const manifest = JSON.parse(fs.readFileSync(path.join(release, 'manifest.json')));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('desktop release consumer contract resolves all six fixed archives locally', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.releaseTag, 'desktop-v0.2.1-rc.3.1');
  assert.equal(manifest.runtimeVersion, '0.2.1-rc.3');
  assert.equal(manifest.packages.length, 6);
  assert.equal(new Set(manifest.packages.map(row => row.name)).size, 6);
  assert.deepEqual(new Set(manifest.bundles), new Set(manifest.packages.map(row => row.name)));
  for (const row of manifest.packages) {
    assert.match(row.file, /^packages\/[a-z0-9.-]+\.tgz$/);
    assert.equal(sha256(fs.readFileSync(path.join(release, row.file))), row.sha256);
  }
  assert.deepEqual(manifest.compatibility, {
    '@omdsh-dev/dsh-genui@0.9.1-dsh021.3': ['0.2.1-rc.3'],
    'dsh-session-control@0.8.5-dsh021.2': ['0.2.1-rc.3'],
    'dsh-subagent-code-agents@0.2.4-dsh021.1': ['0.2.1-rc.3'],
  });
  assert.equal(manifest.validation.realProviderCalls, 0);
  assert.equal(manifest.validation.realProviderUsageValidated, false);
  assert.doesNotMatch(JSON.stringify(manifest), /[A-Z]:[\\/]|Administrator/);
});

test('editable compat source and frozen compat/remote inputs reproduce accepted package bytes', () => {
  for (const [name, directory] of [
    ['dsh-desktop-compat', path.join(repo, 'sources/dsh-desktop-compat')],
    ['dsh-desktop-compat', path.join(release, 'build-inputs/dsh-desktop-compat')],
    ['dsh-remote-control', path.join(release, 'build-inputs/dsh-remote-control')],
  ]) {
    const row = manifest.packages.find(row => row.name === name);
    assert.deepEqual(packSource(directory), fs.readFileSync(path.join(release, row.file)));
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

test('unknown official bytes fail before output; TPS refuses an existing nonempty output', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc3-source-'));
  try {
    const fakeAsar = path.join(directory, 'app.asar'), output = path.join(directory, 'output');
    fs.writeFileSync(fakeAsar, 'synthetic wrong version');
    assert.throws(() => reproduce(fakeAsar, output), /Exact official rc.3 ASAR required/);
    assert.equal(fs.existsSync(output), false);
    assert.throws(() => assertTpsOutput(directory), /new or empty directory/);
    assert.equal(fs.readFileSync(fakeAsar, 'utf8'), 'synthetic wrong version');
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
