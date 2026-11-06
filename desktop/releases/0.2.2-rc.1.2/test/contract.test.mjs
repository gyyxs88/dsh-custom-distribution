import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadRelease, validateManifest, digest, legacyVersion, targetVersion } from '../../../release-contract.mjs';
import { packSource } from '../Reproduce.mjs';

test('rc.1.2 keeps old defaults, all five package bytes and exact grants', () => {
  assert.equal(legacyVersion, '0.2.1-rc.5.1'); assert.equal(targetVersion, '0.2.2-rc.1.1');
  assert.equal(loadRelease().manifest.releaseTag, 'desktop-v0.2.1-rc.5.1');
  const prior = loadRelease(targetVersion), selected = loadRelease('0.2.2-rc.1.2');
  assert.deepEqual(selected.manifest.compatibility, prior.manifest.compatibility);
  assert.deepEqual(selected.manifest.official, prior.manifest.official);
  assert.deepEqual(selected.manifest.bundles, prior.manifest.bundles);
  let reused = 0;
  for (const row of selected.manifest.packages) {
    const bytes = fs.readFileSync(path.join(selected.directory, row.file));
    assert.equal(digest(bytes), row.sha256);
    if (row.name === 'dsh-desktop-compat') {
      assert.equal(row.version, '0.2.2-rc.1.2');
      assert.deepEqual(packSource(path.join(selected.directory, 'build-inputs/dsh-desktop-compat')), bytes);
    } else {
      const old = prior.manifest.packages.find(p => p.name === row.name);
      assert.deepEqual(row, old); assert.deepEqual(bytes, fs.readFileSync(path.join(prior.directory, old.file))); reused++;
    }
  }
  assert.equal(reused, 5);
});
test('rc.1.2 retains official identity, retain/retire and exact grant rejection gates', () => {
  const { manifest } = loadRelease('0.2.2-rc.1.2');
  assert.strictEqual(validateManifest(manifest, '0.2.2-rc.1.2'), manifest);
  for (const mutate of [m => m.official.windowsX64.size++, m => { m.packages.pop(); m.bundles = m.packages.map(p => p.name); }, m => { m.compatibility['dsh-desktop-compat@0.2.2-rc.1.2'] = ['*']; }]) {
    const bad = structuredClone(manifest); mutate(bad); assert.throws(() => validateManifest(bad, '0.2.2-rc.1.2'));
  }
});
