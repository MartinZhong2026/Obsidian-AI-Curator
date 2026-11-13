// In-memory stand-ins for Obsidian, so the engine can be tested end-to-end in Node.
import type { VaultFile, VaultPort, CuratorDeps } from '../src/curator.ts';
import { Curator } from '../src/curator.ts';
import type { HttpRequest, HttpResponse, Transport } from '../src/providers.ts';
import { type CuratorSettings, migrateSettings } from '../src/settings.ts';
import type { IndexData } from '../src/types.ts';

/** Just enough YAML for frontmatter in tests: scalars, quoted strings, flow and block lists. */
export function miniYaml(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let listKey: string | null = null;
  const scalar = (v: string): unknown => {
    v = v.trim();
    if (/^".*"$/.test(v)) return JSON.parse(v);
    if (/^'.*'$/.test(v)) return v.slice(1, -1);
    if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map((x) => scalar(x)).filter((x) => x !== '');
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  };
  for (const line of text.split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) { (out[listKey] as unknown[]).push(scalar(item[1])); continue; }
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    if (kv[2] === '') { out[kv[1]] = []; listKey = kv[1]; } else { out[kv[1]] = scalar(kv[2]); listKey = null; }
  }
  return out;
}

export class MemoryVault implements VaultPort {
  files = new Map<string, { content: string; mtime: number }>();
  writes: string[] = [];
  clock: () => number;
  constructor(clock: () => number) { this.clock = clock; }

  add(path: string, content: string, mtime = this.clock()) { this.files.set(path, { content, mtime }); return this.stat(path)!; }
  listMarkdown(): VaultFile[] { return [...this.files.keys()].filter((p) => p.endsWith('.md')).map((p) => this.stat(p)!); }
  stat(path: string): VaultFile | null {
    const f = this.files.get(path);
    if (!f) return null;
    return { path, basename: path.split('/').pop()!.replace(/\.[^.]+$/, ''), mtime: f.mtime, size: Buffer.byteLength(f.content) };
  }
  async read(path: string) {
    const f = this.files.get(path);
    if (!f) throw new Error('missing ' + path);
    return f.content;
  }
  async write(path: string, content: string) { this.writes.push(path); this.files.set(path, { content, mtime: this.clock() }); }
  async setFrontmatter(path: string, key: string, value: string) {
    const f = this.files.get(path)!;
    f.content = f.content.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`);
  }
  parseYaml(text: string) { return miniYaml(text); }
}

export type Responder = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;

export function fakeTransport(responder: Responder): Transport & { calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  const http = async (req: HttpRequest) => { calls.push(req); return responder(req); };
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((v, k) => { headers[k] = v; });
    const res = await http({ url, method: init?.method, headers, body: init?.body as string });
    return new Response(res.text, { status: res.status, headers: { 'content-type': 'application/json' } });
  };
  return { http, fetch, calls };
}

export function analysisJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: 'How to evaluate RAG pipelines with small golden sets',
    type: 'tutorial', topic: 'AI Engineering', tags: ['rag', 'evals', 'LLM Ops'],
    tldr: 'A 50-question golden set catches most retrieval regressions.',
    summary: 'The author builds a small labelled set and runs it on every change.',
    key_ideas: ['Small curated sets beat large noisy ones'], how_to: ['Collect 50 real questions', 'Label expected sources'],
    caveats: ['Single case study'], actions: ['Build a 20-question set for your project'],
    relevance: 'Directly useful for shipping RAG.', mentions: [{ name: 'Ragas', kind: 'tool', url: 'https://github.com/explodinggradients/ragas' }],
    scores: { relevance: 5, depth: 4, evidence: 4, actionability: 5, originality: 3 },
    verdict: 'read', verdict_reason: 'Concrete, reproducible method.', completeness: 'full',
    ...overrides,
  });
}

export function deepseekReply(content: string, usage = { prompt_tokens: 1800, completion_tokens: 600 }): HttpResponse {
  return { status: 200, text: JSON.stringify({ model: 'deepseek-flash', choices: [{ message: { content }, finish_reason: 'stop' }], usage }) };
}

export interface Harness {
  curator: Curator;
  vault: MemoryVault;
  settings: CuratorSettings;
  transport: ReturnType<typeof fakeTransport>;
  clock: { now: number };
  firstSuccess: string[];
  notices: string[];
  idle(): Promise<void>;
}

export function harness(responder: Responder, opts: { settings?: Partial<CuratorSettings>; key?: string; index?: IndexData } = {}): Harness {
  const clock = { now: Date.UTC(2026, 10, 13, 12, 0, 0) };
  const vault = new MemoryVault(() => clock.now);
  const settings = migrateSettings({ sources: ['Clippings'], onboarded: true, settleSeconds: 5, ...opts.settings });
  const transport = fakeTransport(responder);
  const firstSuccess: string[] = [];
  const notices: string[] = [];
  const deps: CuratorDeps = {
    vault, transport, parseHtml: (html) => ({ text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), title: 'Fetched page' }),
    settings: () => settings, apiKey: () => opts.key ?? 'sk-test', language: () => 'en',
    persist: () => {}, saveSettings: () => {}, changed: () => {},
    firstSuccess: (item) => { firstSuccess.push(item.path); settings.firstSuccessAt = clock.now; },
    notify: (m) => notices.push(m), now: () => clock.now,
  };
  const curator = new Curator(deps, opts.index);
  const idle = async () => {
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 0));
      if (!(curator as unknown as { pumping: boolean }).pumping) return;
    }
    throw new Error('engine did not become idle');
  };
  return { curator, vault, settings, transport, clock, firstSuccess, notices, idle };
}
