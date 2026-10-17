import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(repo, 'temp/upgrade-021rc2-20261017'));
const ready = JSON.parse(fs.readFileSync(path.join(root, 'candidate-ready.json')));
const fixtureName = process.argv[3] ?? 'fixture';
if (!/^fixture(?:-[a-z0-9]+)*$/.test(fixtureName)) throw Error('Invalid fixture name');
const fixture = path.join(root, fixtureName);
if (fs.existsSync(fixture) && fs.readdirSync(fixture).length) throw Error('Fixture already exists; preserve it and choose a fresh task root');
fs.mkdirSync(fixture, { recursive: true });
const identity = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
const sid = /S-1-5-\d+(?:-\d+)+/.exec(identity.stdout)?.[0];
if (!sid) throw Error('Cannot resolve current user SID');
const acl = spawnSync('icacls.exe', [fixture, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { encoding: 'utf8' });
if (acl.status !== 0) throw Error('Fixture ACL protection failed');
const home = path.join(fixture, 'home'), profile = path.join(home, 'profiles/desktop');
fs.mkdirSync(profile, { recursive: true });
const productionHome = 'C:/Users/Administrator/.dsh';
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// Copies are read-only at the source. No credentials, auth files, .env, logs, or timers.
for (const name of ['sessions', 'attachments', 'storages', 'workspace.json']) {
  const source = path.join(productionHome, name);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(home, name), { recursive: true, dereference: true });
}
fs.writeFileSync(path.join(home, '.credentials.yaml'), '{}\n');
const originalProfile = path.join(productionHome, 'profiles/desktop');
const manifest = JSON.parse(fs.readFileSync(path.join(originalProfile, 'package.json')));
const retired = ['dsh-copy-session-id', 'dsh-desktop-opencode-session'];
manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(name => !retired.includes(name) && name !== 'dsh-tps-correction');
const selection = path.join(root, 'artifact-set.json');
const artifacts = fs.existsSync(selection) ? JSON.parse(fs.readFileSync(selection)).packages.map(pkg => pkg.archive)
  : fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.tgz')).map(file => path.join(root, 'artifacts', file));
const packages = [];
for (const archive of artifacts) {
  const result = spawnSync('tar.exe', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' });
  if (result.status !== 0) throw Error('Cannot inspect package manifest');
  const pkg = JSON.parse(result.stdout), destination = path.join(profile, 'node_modules', pkg.name);
  fs.mkdirSync(destination, { recursive: true });
  const extract = spawnSync('tar.exe', ['-xf', archive, '-C', destination, '--strip-components', '1'], { encoding: 'utf8' });
  if (extract.status !== 0) throw Error('Cannot extract package');
  manifest.dependencies[pkg.name] = `file:${archive.replaceAll('\\', '/')}`;
  packages.push({ name: pkg.name, version: pkg.version, archive, sha256: hash(archive) });
}
// Retired packages remain in the production manifest/archive store. This isolated
// profile omits them entirely so the Loader cannot accidentally reactivate them.
for (const name of retired) delete manifest.dependencies[name];
if (packages.some(pkg => pkg.name === 'dsh-tps-correction')) manifest.dsh.profile.bundles.push('dsh-tps-correction');
else delete manifest.dependencies['dsh-tps-correction'];
fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(profile, 'cordis.yml'), '[]\n');
const original = fs.readFileSync(path.join(originalProfile, 'cordis.patch.yml'), 'utf8');
const blocks = original.split(/(?=^- (?:id:|insert:))/m);
const fixtureIds = new Set(['llm-pi-ai', 'agent-default-model']);
let patch = blocks.filter(block => !fixtureIds.has(/^- id:\s*(\S+)/.exec(block)?.[1])).join('');
patch = patch.replaceAll('C:\\Users\\Administrator\\.dsh', home).replaceAll(productionHome, home);
patch += '\n- id: llm-pi-ai\n  config:\n    providers:\n      fixture:\n        api: openai-completions\n        baseURL: http://127.0.0.1:1/v1\n        apiKeyEnv: DSH_OFFLINE_MOCK_KEY\n        models:\n          - id: fixture-model\n            input: [text]\n            contextWindow: 8192\n            maxTokens: 256\n- id: agent-default-model\n  config:\n    provider: fixture\n    model: fixture-model\n';
fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), patch);
const config = { root, fixture, home, profile, ...ready, packages, retired,
  sourcePatchSha256: hash(path.join(originalProfile, 'cordis.patch.yml')),
  fixturePatchSha256: hash(path.join(profile, 'cordis.patch.yml')), productionModified: false };
fs.writeFileSync(path.join(fixture, 'fixture.json'), JSON.stringify(config, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PREPARED', fixture, packages: packages.map(({ name, version }) => ({ name, version })), productionModified: false }));
