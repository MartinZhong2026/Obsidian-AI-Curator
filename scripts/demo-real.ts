// Developer tool: run the real curation engine on the demo vault with a real provider.
//   DEEPSEEK_API_KEY=... node scripts/demo-real.ts [--fresh]
// Spending is hard-capped below. The key is read from the environment and never printed.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Curator, type VaultFile, type VaultPort } from '../src/curator.ts';
import { migrateSettings } from '../src/settings.ts';
import { miniYaml } from '../tests/helpers.ts';
import type { Transport } from '../src/providers.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'vault');
const key = process.env.DEEPSEEK_API_KEY ?? '';
if (!key) { console.error('Set DEEPSEEK_API_KEY.'); process.exit(1); }
if (process.argv.includes('--fresh')) rmSync(join(root, 'AI Curator'), { recursive: true, force: true });

class FsVault implements VaultPort {
  private walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (name.startsWith('.')) continue;
      if (statSync(p).isDirectory()) this.walk(p, out); else out.push(p);
    }
    return out;
  }
  private rel(p: string) { return relative(root, p).split('\\').join('/'); }
  listMarkdown(): VaultFile[] { return this.walk(root).filter((p) => p.endsWith('.md')).map((p) => this.stat(this.rel(p))!); }
  stat(path: string): VaultFile | null {
    const p = join(root, path);
    if (!existsSync(p)) return null;
    const s = statSync(p);
    return { path, basename: path.split('/').pop()!.replace(/\.[^.]+$/, ''), mtime: s.mtimeMs, size: s.size };
  }
  async read(path: string) { return readFileSync(join(root, path), 'utf8'); }
  async write(path: string, content: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); }
  async setFrontmatter() {}
  parseYaml(text: string) { return miniYaml(text); }
}

const transport: Transport = {
  http: async (req) => {
    const res = await fetch(req.url, { method: req.method ?? 'GET', headers: req.headers, body: req.body, signal: AbortSignal.timeout(180_000) });
    return { status: res.status, text: await res.text() };
  },
  fetch: (input, init) => fetch(input, init),
};

const settings = migrateSettings({
  sources: ['Clippings', 'X Bookmarks'], onboarded: true, settleSeconds: 0,
  monthlyBudget: 0.05, dailyLimit: 8, fetchFullText: false, expandX: false,
  language: process.argv.includes('--zh') ? 'zh' : 'en',
  profile: 'Software engineer moving into AI engineering. Wants practical, evidence-backed methods for building and evaluating LLM apps; little patience for hype.',
});
settings.providers.deepseek.secretId = 'env';

const indexPath = join(root, 'AI Curator', '.demo-index.json');
const saved = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : null;
let done!: () => void;
const finished = new Promise<void>((r) => { done = r; });
const curator = new Curator({
  vault: new FsVault(), transport, parseHtml: () => null,
  settings: () => settings, apiKey: () => key, language: () => settings.language === 'zh' ? 'zh' : 'en',
  persist: () => {}, saveSettings: () => {}, changed: () => {},
  firstSuccess: (item) => { settings.firstSuccessAt = Date.now(); console.log(`★ first success → star invite would show for “${item.analysis?.title}”`); },
  notify: (m) => console.log('notice:', m),
}, saved);

curator.scan();
curator.releaseBacklog();
const poll = setInterval(() => { if (!(curator as unknown as { pumping: boolean }).pumping) { clearInterval(poll); done(); } }, 200);
await finished;

mkdirSync(dirname(indexPath), { recursive: true });
writeFileSync(indexPath, JSON.stringify(curator.index, null, 2));
const u = curator.usage();
for (const i of curator.items().sort((a, b) => (b.analysis?.score ?? -1) - (a.analysis?.score ?? -1))) {
  const a = i.analysis;
  console.log(a ? `${a.verdict.padEnd(9)} ${String(a.score).padStart(3)}  ${a.title}  [${a.topic}]` : `${i.state.padEnd(9)}      ${i.title} ${i.skipReason ?? i.error ?? ''}`);
}
console.log(`\ncalls: ${u.items}, tokens in/out: ${u.inputTokens}/${u.outputTokens}, est. cost: $${u.cost.toFixed(4)}`);
