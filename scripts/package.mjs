// Build release assets: dist/<version>/{main.js,manifest.json,styles.css} and a zip for manual installs.
//   npm run package
// Also checks that every version string agrees before a release.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const manifest = read('manifest.json');
const pkg = read('package.json');
const lock = read('package-lock.json');
const versions = read('versions.json');

const problems = [];
if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) problems.push('package-lock.json version differs from package.json.');
if (manifest.version !== pkg.version) problems.push(`manifest.json ${manifest.version} ≠ package.json ${pkg.version}`);
if (versions[manifest.version] !== manifest.minAppVersion) problems.push(`versions.json lacks "${manifest.version}": "${manifest.minAppVersion}"`);
if (/obsidian/i.test(manifest.id)) problems.push('Plugin id must not contain "obsidian".');
if (!existsSync(join(root, 'main.js'))) problems.push('main.js missing: run npm run build first.');
if (problems.length) { console.error('Release check failed:\n- ' + problems.join('\n- ')); process.exit(1); }

const files = ['main.js', 'manifest.json', 'styles.css'];
const out = join(root, 'dist', manifest.version);
mkdirSync(out, { recursive: true });
for (const f of files) copyFileSync(join(root, f), join(out, f));

// Minimal ZIP writer (deflate), so packaging needs no extra dependencies.
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const locals = [], centrals = [];
let offset = 0;
for (const f of files) {
  const data = readFileSync(join(root, f));
  const deflated = deflateRawSync(data, { level: 9 });
  const name = Buffer.from(`${manifest.id}/${f}`);
  const crc = crc32(data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
  head.writeUInt16LE(0x0021, 12); // Deterministic valid DOS date: 1980-01-01.
  head.writeUInt32LE(crc, 14); head.writeUInt32LE(deflated.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26);
  locals.push(head, name, deflated);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
  cen.writeUInt16LE(0x0021, 14);
  cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(deflated.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28);
  cen.writeUInt32LE(offset, 42);
  centrals.push(cen, name);
  offset += head.length + name.length + deflated.length;
}
const central = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
const zipPath = join(root, 'dist', `${manifest.id}-${manifest.version}.zip`);
writeFileSync(zipPath, Buffer.concat([...locals, central, end]));
const assets = [...files.map((f) => [f, join(out, f)]), [manifest.id + '-' + manifest.version + '.zip', zipPath]];
writeFileSync(join(root, 'dist', 'SHA256SUMS.txt'), assets.map(([name, path]) =>
  createHash('sha256').update(readFileSync(path)).digest('hex') + '  ' + name).join('\n') + '\n');

for (const f of files) console.log(`${f.padEnd(14)} ${(statSync(join(out, f)).size / 1024).toFixed(1)} KB`);
console.log(`\nRelease assets: dist/${manifest.version}/`);
console.log(`Manual-install zip: dist/${manifest.id}-${manifest.version}.zip`);
