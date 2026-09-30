import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { sha256 } from './official-runtime.mjs';
export const packageFiles = ['README.md', 'cordis.patch.yml', 'lib/contract.js', 'lib/discovery.js', 'lib/index.js', 'package.json'];
const octal = (number, length) => `${number.toString(8).padStart(length - 1, '0')}\0`;

// Fixed order, permissions, uid/gid, timestamps and gzip header produce byte-identical TGZ.
export function pack(source) {
  const parts = [];
  for (const file of packageFiles) {
    const bytes = fs.readFileSync(path.join(source, file));
    const header = Buffer.alloc(512);
    header.write(`package/${file}`, 0, 100);
    header.write(octal(0o644, 8), 100); header.write(octal(0, 8), 108); header.write(octal(0, 8), 116);
    header.write(octal(bytes.length, 12), 124); header.write(octal(0, 12), 136);
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
    parts.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}
export function unpack(bytes) {
  const tar = gunzipSync(bytes), files = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, end) => header.subarray(start, end).toString('utf8').split('\0')[0];
    const name = field(0, 100), size = parseInt(field(124, 136).trim(), 8);
    if (!packageFiles.map(file => `package/${file}`).includes(name) || files.has(name) || !Number.isSafeInteger(size)) throw Error('Unexpected package member');
    files.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}
export function verify(source, bytes) {
  const files = unpack(bytes);
  if (files.size !== packageFiles.length) throw Error('Package member count mismatch');
  for (const file of packageFiles) if (!files.get(`package/${file}`).equals(fs.readFileSync(path.join(source, file)))) throw Error(`Source mismatch: ${file}`);
  if (!bytes.equals(pack(source))) throw Error('Package is not reproducible');
  return packageFiles.map(file => ({ path: `package/${file}`, sha256: sha256(files.get(`package/${file}`)), bytes: files.get(`package/${file}`).length }));
}
