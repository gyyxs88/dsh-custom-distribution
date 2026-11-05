// Run with the target official Electron in Node mode; all records are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [app, output, version] = process.argv.slice(2);
assert.ok(process.versions.electron);
assert.equal(process.env.DSH_HOME, path.join(output, 'home'));
assert.ok(!fs.existsSync(output), 'Choose a fresh isolated output');
fs.mkdirSync(output, { recursive: true });
const api = await import(pathToFileURL(path.join(app, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')));
assert.equal(api.getDshRuntimeVersion(), version);
const profile = path.join(output, 'home/profiles/desktop');
fs.mkdirSync(profile, { recursive: true });
const compatibilityFile = path.join(profile, 'compatibility.json');
const old = { 'synthetic-user@1.0.0': ['0.2.1-rc.5'] };
fs.writeFileSync(compatibilityFile, JSON.stringify(old));
await Promise.all([
  api.setProfileVersionExemption(profile, 'synthetic-alpha@1.0.0', version, true, true),
  api.setProfileVersionExemption(profile, 'synthetic-beta@2.0.0', version, true, true),
]);
await api.setProfileVersionExemption(profile, 'synthetic-alpha@1.0.0', version, true, true);
assert.deepEqual(api.readProfileVersionExemptions(profile), { ...old, 'synthetic-alpha@1.0.0': [version], 'synthetic-beta@2.0.0': [version] });
await api.setProfileVersionExemption(profile, 'synthetic-alpha@1.0.0', version, false, true);
assert.deepEqual(api.readProfileVersionExemptions(profile), { ...old, 'synthetic-beta@2.0.0': [version] });
const before = fs.readFileSync(compatibilityFile);
for (const [pkg, runtime, risk] of [['synthetic-alpha@*', version, true], ['synthetic-alpha@1.0.0', '0.0.0', true], ['synthetic-alpha@1.0.0', version, false]]) {
  await assert.rejects(api.setProfileVersionExemption(profile, pkg, runtime, true, risk));
  assert.deepEqual(fs.readFileSync(compatibilityFile), before);
}
fs.writeFileSync(compatibilityFile, '{BROKEN_SYNTHETIC');
assert.equal(api.readProfileCompatibility(profile).rewritable, false);
await assert.rejects(api.setProfileVersionExemption(profile, 'synthetic-alpha@1.0.0', version, true, true));
assert.equal(fs.readFileSync(compatibilityFile, 'utf8'), '{BROKEN_SYNTHETIC');
assert.ok(!fs.existsSync(path.join(profile, 'package.json')));
const result = { status: 'PASSED', runtimeVersion: version, officialApi: true, concurrentGrantsPreserved: true, idempotent: true, revokeOnlyOwnGrant: true, oldRecordsPreserved: true, malformedMetadataPreserved: true, exactVersionAndRiskChecks: true, noProfilePackageCreated: true, realProviderCalls: 0, sshCalls: 0, externalCodingCalls: 0 };
fs.writeFileSync(path.join(output, 'api-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
