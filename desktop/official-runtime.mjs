import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

export const defaultArchive = 'D:/DSH/resources/app.asar';
export const defaultElectron = 'D:/DSH/DeepSeek Harness.exe';
export const peers = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-llm-pi-ai'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Read only identified packed source members; no credentials, profiles, logs or environment.
export function readPacked(archive, member) {
  if (!/^dsh\/node_modules\/@deepseek-ai\/[a-z0-9-]+\/(package.json|lib\/index.js)$/.test(member)) throw Error('Non-source ASAR member refused');
  const fd = fs.openSync(archive, 'r');
  try {
    const prefix = Buffer.alloc(16); fs.readSync(fd, prefix, 0, 16, 0);
    const size = prefix.readUInt32LE(12);
    if (size > 32 * 1024 * 1024) throw Error('ASAR header too large');
    const bytes = Buffer.alloc(size); fs.readSync(fd, bytes, 0, size, 16);
    const header = JSON.parse(bytes.toString('utf8'));
    const entry = member.split('/').reduce((entry, key) => entry?.files?.[key], header);
    if (!entry || entry.unpacked || !Number.isInteger(entry.size) || entry.size > 4_000_000) throw Error('Unsafe source member');
    const source = Buffer.alloc(entry.size);
    fs.readSync(fd, source, 0, source.length, 8 + prefix.readUInt32LE(4) + Number(entry.offset));
    return source;
  } finally { fs.closeSync(fd); }
}
export function installation(archive = defaultArchive) {
  return peers.map(pkg => {
    const manifest = JSON.parse(readPacked(archive, `dsh/node_modules/${pkg}/package.json`));
    return { name: manifest.name, version: manifest.version,
      sourceSha256: sha256(readPacked(archive, `dsh/node_modules/${pkg}/lib/index.js`)) };
  });
}
export function useOfficial(archive = defaultArchive) {
  const official = `${archive.replaceAll('\\', '/')}/dsh/node_modules/`;
  const redirects = new Map(peers.map(pkg => [pkg, `${official}${pkg}/lib/index.js`]));
  registerHooks({ resolve(specifier, context, next) {
    if (redirects.has(specifier)) {
      const target = redirects.get(specifier);
      return next(context.conditions.includes('require') ? target : pathToFileURL(target).href, context);
    }
    for (const pkg of peers) if (specifier === `${pkg}/package.json`) return next(`${official}${pkg}/package.json`, context);
    return next(specifier, context);
  }});
  return { official, url: pkg => pathToFileURL(path.join(official, pkg, 'lib/index.js')).href };
}
