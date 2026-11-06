// Public release metadata only. Candidate package/source creation is a separate step.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const legacyVersion = '0.2.1-rc.5.1';
export const targetVersion = '0.2.2-rc.1.1';
const runtimes = { [legacyVersion]: '0.2.1-rc.5', [targetVersion]: '0.2.2-rc.1', '0.2.2-rc.1.2': '0.2.2-rc.1' };
const pluginNames = ['@omdsh-dev/dsh-genui', 'dsh-desktop-compat', 'dsh-remote-control', 'dsh-session-control', 'dsh-subagent-code-agents', 'dsh-tps-correction'];
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const assetName = manifest => `dsh-${manifest.releaseTag}-win-x64.zip`;

export function validateManifest(manifest, version) {
  if (!Object.hasOwn(runtimes, version) || manifest.schemaVersion !== 1 || manifest.releaseTag !== `desktop-v${version}` || manifest.runtimeVersion !== runtimes[version]) throw Error('Unexpected Desktop release manifest.');
  const packages = manifest.packages;
  if (!Array.isArray(packages) || !packages.length || new Set(packages.map(p => p.name)).size !== packages.length || new Set(packages.map(p => p.file)).size !== packages.length) throw Error('Invalid package set.');
  for (const p of packages) {
    if (!pluginNames.includes(p.name) || !exactVersion.test(p.version) || !/^packages\/[a-z0-9.-]+\.tgz$/.test(p.file) || !/^[a-f0-9]{64}$/.test(p.sha256)) throw Error('Invalid package identity.');
  }
  const names = packages.map(p => p.name);
  if (!Array.isArray(manifest.bundles) || JSON.stringify([...manifest.bundles].sort()) !== JSON.stringify([...names].sort())) throw Error('Invalid bundle set.');
  const retired = manifest.retiredPackages ?? [];
  if (!Array.isArray(retired) || new Set(retired).size !== retired.length || retired.some(n => !pluginNames.includes(n) || names.includes(n))) throw Error('Invalid retired package set.');
  if (runtimes[version] === '0.2.2-rc.1' && pluginNames.some(n => !names.includes(n) && !retired.includes(n))) throw Error('Every previous plugin needs an explicit retain or retire decision.');
  if (!manifest.compatibility || typeof manifest.compatibility !== 'object' || Array.isArray(manifest.compatibility)) throw Error('Invalid exact compatibility grants.');
  for (const [key, versions] of Object.entries(manifest.compatibility)) {
    if (!packages.some(p => key === `${p.name}@${p.version}`) || !Array.isArray(versions) || !versions.includes(manifest.runtimeVersion) || new Set(versions).size !== versions.length || versions.some(v => !exactVersion.test(v))) throw Error('Invalid exact compatibility grants.');
  }
  const official = manifest.official?.windowsX64;
  if (!official || official.url !== `https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-${manifest.runtimeVersion}-win-x64.exe` || !Number.isSafeInteger(official.size) || official.size <= 0 || !/^[A-Za-z0-9+/]{86}==$/.test(official.sha512Base64) || !/^[a-f0-9]{64}$/.test(official.appAsarSha256) || !/^[a-f0-9]{64}$/.test(official.exeSha256)) throw Error('Invalid official program identity.');
  if (runtimes[version] === '0.2.2-rc.1' && (official.size !== 293425336 || official.sha512Base64 !== 'swcK0J6ofGkaAWLRpOes2ca7CWO8vuM5Vp0FRnQ/DG3q+Z+OhvsgLz3hIiSYpRUETY+fEz+Ww86fNa0jiVIifw==')) throw Error('Unexpected official 0.2.2-rc.1 download identity.');
  return manifest;
}

export function loadRelease(version = legacyVersion) {
  if (!Object.hasOwn(runtimes, version)) throw Error('Unsupported Desktop release version.');
  const directory = fileURLToPath(new URL(`./releases/${version}/`, import.meta.url));
  const file = path.join(directory, 'manifest.json');
  if (!fs.existsSync(file)) throw Error(`Frozen release manifest is not available: ${version}. Integrate the accepted candidate first.`);
  const bytes = fs.readFileSync(file);
  const manifest = validateManifest(JSON.parse(bytes), version);
  if (runtimes[version] === '0.2.2-rc.1' && manifest.frozen !== true) throw Error('Frozen release manifest is not available: candidate integration is still preliminary.');
  return { directory, manifest, manifestSha256: digest(bytes) };
}

function substitute(source, marker, replacement) {
  const start = `# BEGIN ${marker}`, end = `# END ${marker}`;
  const from = source.indexOf(start), to = source.indexOf(end);
  if (from < 0 || to <= from) throw Error('Missing installer identity markers.');
  return source.slice(0, from) + start + '\n' + replacement + '\n' + source.slice(to);
}

export function renderPowerShell(source, manifest, manifestSha256) {
  const q = value => "'" + String(value).replaceAll("'", "''") + "'";
  const fields = { releaseTag: manifest.releaseTag, runtimeVersion: manifest.runtimeVersion, assetName: assetName(manifest), manifestSha256 };
  const official = manifest.official.windowsX64;
  const lines = Object.entries(fields).map(([key, value]) => `$${key} = ${q(value)}`);
  lines.push('$officialIdentity = @{', ...Object.entries(official).map(([key, value]) => `    ${key} = ${typeof value === 'number' ? value : q(value)}`), '}');
  return substitute(source, 'DESKTOP RELEASE IDENTITY', lines.join('\n'));
}

export function renderInstaller(source, manifestSha256) {
  const pattern = /const manifestSha256 = '[a-f0-9]{64}';/;
  if (!pattern.test(source)) throw Error('Missing installer manifest pin.');
  return source.replace(pattern, `const manifestSha256 = '${manifestSha256}';`);
}
