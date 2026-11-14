// Install the freshly built plugin into a vault for manual testing.
//   npm run build && node scripts/install-demo.mjs            → demo/vault (safe, contains only sample notes)
//   node scripts/install-demo.mjs "/path/to/Your Vault"        → any vault you choose
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const vault = resolve(process.argv[2] ?? join(root, 'demo', 'vault'));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
if (!existsSync(join(root, 'main.js'))) { console.error('Run npm run build first.'); process.exit(1); }
if (!existsSync(vault)) { console.error('Vault not found: ' + vault); process.exit(1); }

const obsidian = join(vault, '.obsidian');
const target = join(obsidian, 'plugins', manifest.id);
mkdirSync(target, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(join(root, f), join(target, f));

// Enable it without touching any other plugin in the list.
const listPath = join(obsidian, 'community-plugins.json');
const list = existsSync(listPath) ? JSON.parse(readFileSync(listPath, 'utf8')) : [];
if (!list.includes(manifest.id)) { list.push(manifest.id); writeFileSync(listPath, JSON.stringify(list, null, 2)); }
console.log(`Installed ${manifest.name} ${manifest.version} into ${target}`);
console.log('In Obsidian: Settings → Community plugins → turn off Restricted mode if needed, then reload.');
