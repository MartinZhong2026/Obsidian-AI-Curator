// Validate the exact shipped bytes, including ZIP contents, without another dependency.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const zipName = manifest.id + '-' + manifest.version + '.zip';
const files = ['main.js', 'manifest.json', 'styles.css'];
const packaged = (name) => readFileSync(join(root, 'dist', ...(name === zipName ? [] : [manifest.version]), name));
const sums = readFileSync(join(root, 'dist', 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
assert.equal(sums.length, 4);
for (const line of sums) {
  const [hash, name] = line.split('  ');
  assert.ok([...files, zipName].includes(name));
  assert.equal(createHash('sha256').update(packaged(name)).digest('hex'), hash, name);
}
const zip = packaged(zipName);
let offset = 0;
const entries = [];
while (zip.readUInt32LE(offset) === 0x04034b50) {
  assert.equal(zip.readUInt16LE(offset + 8), 8, 'ZIP compression');
  const compressed = zip.readUInt32LE(offset + 18);
  const nameSize = zip.readUInt16LE(offset + 26);
  const extra = zip.readUInt16LE(offset + 28);
  const name = zip.subarray(offset + 30, offset + 30 + nameSize).toString('utf8');
  const file = name.slice(manifest.id.length + 1);
  assert.equal(name, manifest.id + '/' + file);
  assert.ok(files.includes(file), 'unexpected ZIP entry');
  const start = offset + 30 + nameSize + extra;
  assert.deepEqual(inflateRawSync(zip.subarray(start, start + compressed)), packaged(file), file);
  entries.push(file);
  offset = start + compressed;
}
assert.deepEqual(entries.sort(), files.sort());
assert.equal(zip.readUInt32LE(offset), 0x02014b50, 'central directory');
assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50, 'end of ZIP');
console.log('Verified release versions, four SHA-256 checksums, and three ZIP entries.');
