// The curation engine. Talks to Obsidian only through VaultPort so it can be tested in Node.
import type { IndexData, Item, ReadingStatus } from './types.ts';
import { type OutputLanguage, ANALYSIS_SCHEMA, parseAnalysis, systemPrompt, userMessage } from './analysis.ts';
import {
  assess, canonicalUrl, cleanBody, estimateTokens, fallbackTitle, hashText, readMeta, stripFrontmatter, truncateForModel,
  type Frontmatter,
} from './extract.ts';
import { recoverFullText, type HtmlParser } from './fulltext.ts';
import { isCuratedNote, readStatus, relatedItems, renderBase, renderDigest, renderNote, safeFileName } from './notes.ts';
import { PRICES, ProviderError, chat, estimateCost, preset, type ChatResult, type Transport } from './providers.ts';
import {
  MAX_ATTEMPTS, backoffMs, budgetCheck, counts, emptyIndex, estimateItemCost, readyItems, recordUsage, rollUsage,
} from './queue.ts';
import { type CuratorSettings, isInFolder } from './settings.ts';

export interface VaultFile { path: string; basename: string; mtime: number; size: number }

export interface VaultPort {
  listMarkdown(): VaultFile[];
  stat(path: string): VaultFile | null;
  read(path: string): Promise<string>;
  /** Create or overwrite, creating parent folders as needed. */
  write(path: string, content: string): Promise<void>;
  setFrontmatter(path: string, key: string, value: string): Promise<void>;
  parseYaml(text: string): unknown;
}

export type EngineState =
  | { kind: 'idle' }
  | { kind: 'working'; current: string }
  | { kind: 'paused'; reason: string }
  | { kind: 'needs-setup'; reason: 'sources' | 'key' | 'model' }
  | { kind: 'limit'; reason: 'daily' | 'monthly' };

export interface CuratorDeps {
  vault: VaultPort;
  transport: Transport;
  parseHtml: HtmlParser;
  settings(): CuratorSettings;
  apiKey(): string;
  language(): OutputLanguage;
  persist(): void;
  /** Settings changed by the engine itself (pause on auth errors). */
  saveSettings(): void;
  changed(): void;
  firstSuccess(item: Item): void;
  notify(message: string): void;
  now?(): number;
}

const CONCURRENCY = 2;
const FRONTMATTER_BLOCK = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function notesFolder(output: string) { return `${output}/Notes`; }

export class Curator {
  index: IndexData;
  state: EngineState = { kind: 'idle' };
  private running = new Set<string>();
  /** Estimated cost of calls in flight, so parallel workers cannot jointly overshoot the budget. */
  private reserved = 0;
  private inflight = 0;
  private pumping = false;
  private stopped = false;
  private deps: CuratorDeps;

  constructor(deps: CuratorDeps, data?: IndexData | null) {
    this.deps = deps;
    this.index = data && data.version === 1 ? { ...data, seededFolders: data.seededFolders ?? [] } : emptyIndex(this.now());
    // Recover from a crash or reload in the middle of an analysis.
    for (const item of Object.values(this.index.items)) if (item.state === 'analyzing') item.state = 'pending';
  }

  private now() { return this.deps.now ? this.deps.now() : Date.now(); }
  private get s() { return this.deps.settings(); }

  stop() { this.stopped = true; }

  items(): Item[] { return Object.values(this.index.items); }
  get(path: string): Item | undefined { return this.index.items[path]; }
  counts() { return counts(this.items()); }
  usage() { return rollUsage(this.index.usage, this.now()); }

  isSource(path: string): boolean {
    if (!path.toLowerCase().endsWith('.md')) return false;
    const s = this.s;
    if (isInFolder(path, s.outputFolder)) return false;
    return s.sources.some((f) => isInFolder(path, f));
  }

  // ───────────────────────────── discovery ─────────────────────────────

  /** Reconcile the index with the vault. Cheap: only stats files; reads happen at analysis time. */
  scan(): void {
    const s = this.s;
    const seen = new Set<string>();
    const newFolders = s.sources.filter((f) => !this.index.seededFolders.includes(f));
    for (const file of this.deps.vault.listMarkdown()) {
      if (!this.isSource(file.path)) {
        if (this.index.items[file.path]?.manual) seen.add(file.path);
        continue;
      }
      seen.add(file.path);
      const backlog = newFolders.some((f) => isInFolder(file.path, f));
      this.upsert(file, backlog);
    }
    for (const path of Object.keys(this.index.items)) {
      if (!seen.has(path)) delete this.index.items[path];
    }
    if (newFolders.length) this.index.seededFolders = [...this.index.seededFolders, ...newFolders];
    this.index.seededFolders = this.index.seededFolders.filter((f) => s.sources.includes(f));
    this.deps.persist();
    this.deps.changed();
  }

  private upsert(file: VaultFile, backlog: boolean): Item {
    const existing = this.index.items[file.path];
    if (!existing) {
      const item: Item = {
        path: file.path, hash: '', mtime: file.mtime, state: 'pending', addedAt: this.now(), status: 'unread',
        title: file.basename, chars: 0, attempts: 0, ...(backlog ? { held: true } : {}),
      };
      this.index.items[file.path] = item;
      return item;
    }
    if (existing.mtime !== file.mtime) {
      existing.mtime = file.mtime;
      // Error/empty items get a fresh chance when the user (or a sync plugin) edits the note.
      if (existing.state === 'error' || (existing.state === 'skipped' && existing.skipReason === 'empty')) {
        Object.assign(existing, { state: 'pending', attempts: 0, error: undefined, skipReason: undefined, nextAttemptAt: undefined });
      } else if (existing.state === 'done' || existing.state === 'skipped') {
        existing.needsCheck = true;
      }
    }
    return existing;
  }

  onCreate(file: VaultFile) {
    if (!this.isSource(file.path)) return;
    this.upsert(file, false);
    this.deps.persist();
    this.deps.changed();
    this.kick();
  }

  private tracked(path: string) { return this.isSource(path) || !!this.index.items[path]?.manual; }

  onModify(file: VaultFile) {
    if (this.tracked(file.path)) {
      this.upsert(file, false);
      this.deps.persist();
      this.kick();
      return;
    }
    const owner = this.items().find((i) => i.notePath === file.path);
    if (owner) {
      // The user may change `status:` in the curated note's properties.
      this.deps.vault.read(file.path).then((text) => {
        const status = readStatus(text);
        if (status && ['unread', 'read', 'archived'].includes(status) && status !== owner.status) {
          owner.status = status as ReadingStatus;
          this.deps.persist();
          this.deps.changed();
        }
      }).catch(() => {});
    }
  }

  onDelete(path: string) {
    if (this.index.items[path]) {
      delete this.index.items[path];
    } else {
      for (const item of this.items()) if (item.notePath === path) item.notePath = undefined;
    }
    this.deps.persist();
    this.deps.changed();
  }

  onRename(file: VaultFile, oldPath: string) {
    const item = this.index.items[oldPath];
    if (item) {
      delete this.index.items[oldPath];
      if (item.manual || this.isSource(file.path)) {
        item.path = file.path;
        this.index.items[file.path] = item;
        for (const other of this.items()) if (other.dedupeOf === oldPath) other.dedupeOf = file.path;
      }
    } else {
      for (const other of this.items()) if (other.notePath === oldPath) other.notePath = file.path;
      if (this.isSource(file.path)) this.upsert(file, false);
    }
    this.deps.persist();
    this.deps.changed();
    this.kick();
  }

  // ───────────────────────────── user actions ─────────────────────────────

  /** Curate one note on demand, wherever it lives (except the curator's own output). */
  addManual(file: VaultFile): boolean {
    if (isInFolder(file.path, this.s.outputFolder) || !file.path.toLowerCase().endsWith('.md')) return false;
    const item = this.upsert(file, false);
    item.manual = !this.isSource(file.path);
    if (item.state === 'done' || item.state === 'skipped' || item.state === 'error') {
      this.reanalyze(file.path);
    } else {
      item.held = false;
      item.mtime = Math.min(item.mtime, this.now() - this.s.settleSeconds * 1000);
      this.deps.persist();
      this.deps.changed();
      this.kick(true);
    }
    return true;
  }

  heldItems(): Item[] { return this.items().filter((i) => i.state === 'pending' && i.held).sort((a, b) => b.mtime - a.mtime); }

  /** Approve backlog processing: newest first, `limit` items (or all). */
  releaseBacklog(limit?: number) {
    const held = this.heldItems();
    for (const item of held.slice(0, limit ?? held.length)) item.held = false;
    this.deps.persist();
    this.deps.changed();
    this.kick(true);
  }

  /** Conservative cost estimate for analyzing the held backlog. */
  backlogEstimate(): { count: number; cost: number | null } {
    const held = this.heldItems();
    const price = this.price();
    if (!price) return { count: held.length, cost: null };
    let cost = 0;
    for (const item of held) {
      const size = this.deps.vault.stat(item.path)?.size ?? 2000;
      // UTF-8 bytes / 3 overestimates tokens for Latin text and is about right for CJK.
      cost += estimateItemCost(Math.min(size / 3, this.s.maxInputChars / 2), price) ?? 0;
    }
    return { count: held.length, cost };
  }

  reanalyze(path: string) {
    const item = this.index.items[path];
    if (!item) return;
    Object.assign(item, { state: 'pending', held: false, attempts: 0, error: undefined, nextAttemptAt: undefined, stale: false, skipReason: undefined, dedupeOf: undefined, force: true });
    this.deps.persist();
    this.deps.changed();
    this.kick(true);
  }

  retryErrors() {
    for (const item of this.items()) {
      if (item.state === 'error') Object.assign(item, { state: 'pending', attempts: 0, error: undefined, nextAttemptAt: undefined });
    }
    this.deps.persist();
    this.deps.changed();
    this.kick(true);
  }

  async setStatus(path: string, status: ReadingStatus) {
    const item = this.index.items[path];
    if (!item) return;
    item.status = status;
    this.deps.persist();
    this.deps.changed();
    if (item.notePath && this.deps.vault.stat(item.notePath)) {
      await this.deps.vault.setFrontmatter(item.notePath, 'status', status);
    }
  }

  // ───────────────────────────── processing ─────────────────────────────

  private price() {
    const s = this.s;
    const ps = s.providers[s.provider];
    const custom = ps && (ps.inputPrice > 0 || ps.outputPrice > 0) ? { input: ps.inputPrice, output: ps.outputPrice } : null;
    return custom ?? PRICES[ps?.model ?? ''] ?? null;
  }

  private setupProblem(): EngineState | null {
    const s = this.s;
    if (!s.sources.length) return { kind: 'needs-setup', reason: 'sources' };
    const ps = s.providers[s.provider];
    if (!ps?.model) return { kind: 'needs-setup', reason: 'model' };
    if (preset(s.provider).needsKey && !this.deps.apiKey()) return { kind: 'needs-setup', reason: 'key' };
    return null;
  }

  /** Recompute the visible state without starting work. */
  refreshState() {
    if (this.running.size) return;
    const s = this.s;
    const problem = this.setupProblem();
    if (s.paused) this.state = { kind: 'paused', reason: s.pauseReason };
    else if (problem) this.state = problem;
    else {
      const block = budgetCheck(this.index.usage, this.now(), s, null);
      this.state = block.blocked ? { kind: 'limit', reason: block.reason } : { kind: 'idle' };
    }
  }

  /** Start processing if allowed. `manual` runs even when automatic processing is off. */
  kick(manual = false) {
    if (this.stopped) return;
    if (!this.s.autoProcess && !manual) { this.refreshState(); this.deps.changed(); return; }
    void this.pump();
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const workers: Promise<void>[] = [];
      for (let i = 0; i < CONCURRENCY; i++) workers.push(this.worker());
      await Promise.all(workers);
    } finally {
      this.pumping = false;
      this.refreshState();
      this.deps.changed();
    }
  }

  private nextItem(): Item | undefined {
    const now = this.now();
    const settleMs = this.s.settleSeconds * 1000;
    return readyItems(this.items(), now).find((i) => !this.running.has(i.path) && now - i.mtime >= settleMs);
  }

  private async worker() {
    while (!this.stopped) {
      const s = this.s;
      if (s.paused) return;
      const problem = this.setupProblem();
      if (problem) { this.state = problem; return; }
      await this.checkChanged();
      const item = this.nextItem();
      if (!item) return;
      this.running.add(item.path);
      try {
        await this.process(item);
      } finally {
        this.running.delete(item.path);
      }
      if (this.state.kind === 'limit' || this.s.paused) return;
    }
  }

  /** Re-read finished notes that were modified, to detect real content changes (not just property edits). */
  private async checkChanged() {
    for (const item of this.items()) {
      if (!item.needsCheck || this.running.has(item.path)) continue;
      item.needsCheck = false;
      try {
        const raw = await this.deps.vault.read(item.path);
        const clean = cleanBody(stripFrontmatter(raw));
        const hash = hashText(clean);
        if (hash === item.hash) continue;
        const chars = assess(clean, readMeta({}, clean), clean).chars;
        const wasPartial = item.analysis?.completeness !== 'full' || item.skipReason === 'duplicate';
        if (wasPartial && chars > Math.max(item.chars * 1.5, item.chars + 300)) {
          // A sync tool filled in the full text later: analyze again automatically.
          Object.assign(item, { state: 'pending', attempts: 0, stale: false, nextAttemptAt: undefined, skipReason: undefined, dedupeOf: undefined, force: true });
        } else if (item.state === 'done') {
          item.stale = true;
        }
        this.deps.persist();
      } catch {
        // File vanished between events; the delete handler will clean up.
      }
    }
  }

  private frontmatter(raw: string): Frontmatter {
    const m = raw.match(FRONTMATTER_BLOCK);
    if (!m) return {};
    try {
      const parsed = this.deps.vault.parseYaml(m[1]);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Frontmatter : {};
    } catch {
      return {};
    }
  }

  private findDuplicate(item: Item): Item | undefined {
    for (const other of this.items()) {
      if (other.path === item.path || other.state !== 'done' || !other.analysis) continue;
      const same = (item.canonical && other.canonical === item.canonical) || (item.chars > 200 && other.hash === item.hash);
      if (same && other.chars >= item.chars * 0.8) return other;
    }
    return undefined;
  }

  private vocabulary() {
    const topics = new Map<string, number>(), tags = new Map<string, number>();
    for (const i of this.items()) {
      if (!i.analysis) continue;
      topics.set(i.analysis.topic, (topics.get(i.analysis.topic) ?? 0) + 1);
      for (const t of i.analysis.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
    }
    const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    return { topics: top(topics), tags: top(tags) };
  }

  private async process(item: Item) {
    const s = this.s;
    const vault = this.deps.vault;
    item.state = 'analyzing';
    this.state = { kind: 'working', current: item.title };
    this.deps.changed();
    let raw: string;
    try {
      raw = await vault.read(item.path);
    } catch {
      delete this.index.items[item.path];
      return;
    }
    const fm = this.frontmatter(raw);
    const body = stripFrontmatter(raw);
    const clean = cleanBody(body);
    const meta = readMeta(fm, body);
    const basename = item.path.split('/').pop()!.replace(/\.md$/i, '');
    const assessment = assess(clean, meta, body);
    const force = !!item.force;
    Object.assign(item, {
      hash: hashText(clean), chars: assessment.chars, title: meta.title || fallbackTitle(basename, clean),
      url: meta.url, author: meta.author, published: meta.published, canonical: canonicalUrl(meta.url), force: undefined,
    });

    if (!force) {
      const dup = this.findDuplicate(item);
      if (dup) {
        Object.assign(item, { state: 'skipped', skipReason: 'duplicate', dedupeOf: dup.path, error: undefined });
        this.deps.persist();
        return;
      }
    }

    let text = clean;
    item.fullTextFrom = undefined;
    if (assessment.thin && meta.links.length && (s.fetchFullText || s.expandX)) {
      const full = await recoverFullText(meta.links, {
        http: this.deps.transport.http, parseHtml: this.deps.parseHtml,
        fetchWeb: s.fetchFullText, expandX: s.expandX, currentChars: assessment.chars,
      });
      if (full) {
        text = (clean ? clean + '\n\n---\n[Full text recovered from the original link]\n\n' : '') + full.text;
        item.fullTextFrom = full.from;
        if (!meta.title && full.title) item.title = full.title.slice(0, 120);
      }
    }
    if (assessment.empty && !item.fullTextFrom) {
      Object.assign(item, { state: 'skipped', skipReason: 'empty', error: undefined });
      this.deps.persist();
      return;
    }

    const { text: modelText, truncated } = truncateForModel(text, s.maxInputChars);
    const vocab = this.vocabulary();
    const lang = this.deps.language();
    const system = systemPrompt(lang, s.profile);
    const user = userMessage({
      lang,
      title: item.title, url: item.url, author: item.author, published: item.published,
      text: modelText, truncated, fullTextFrom: item.fullTextFrom, topics: vocab.topics, tags: vocab.tags,
    });

    const price = this.price();
    const nextCost = estimateItemCost(estimateTokens(system + user), price);
    const usage = this.index.usage;
    const block = budgetCheck({ ...rollUsage(usage, this.now()), cost: usage.cost + this.reserved, dayItems: rollUsage(usage, this.now()).dayItems + this.inflight }, this.now(), s, nextCost);
    if (block.blocked) {
      item.state = 'pending';
      this.state = { kind: 'limit', reason: block.reason };
      return;
    }

    const ps = s.providers[s.provider];
    let result: ChatResult;
    const reservation = nextCost ?? 0;
    this.reserved += reservation;
    this.inflight++;
    try {
      result = await chat(
        { provider: s.provider, baseUrl: ps.baseUrl, model: ps.model, apiKey: this.deps.apiKey() },
        { system, user, schema: ANALYSIS_SCHEMA, maxTokens: 4000 },
        this.deps.transport,
      );
    } catch (error) {
      this.handleFailure(item, error);
      return;
    } finally {
      this.reserved -= reservation;
      this.inflight--;
    }

    const cost = estimateCost(result.model, result.inputTokens, result.outputTokens, price);
    this.index.usage = recordUsage(this.index.usage, this.now(), result.inputTokens, result.outputTokens, cost);
    item.tokens = { input: result.inputTokens, output: result.outputTokens };
    item.cost = cost ?? undefined;

    try {
      item.analysis = parseAnalysis(result.text);
    } catch (error) {
      this.handleFailure(item, error instanceof Error ? error : new Error(String(error)), true);
      return;
    }
    Object.assign(item, {
      state: 'done', analyzedAt: this.now(), model: result.model, attempts: 0, error: undefined,
      nextAttemptAt: undefined, stale: false, held: false, skipReason: undefined, dedupeOf: undefined,
    });

    try {
      await this.writeNote(item, lang);
    } catch (error) {
      item.error = 'Could not write the curated note: ' + (error instanceof Error ? error.message : String(error));
    }
    this.deps.persist();
    this.deps.changed();
    if (!s.firstSuccessAt) this.deps.firstSuccess(item);
  }

  private handleFailure(item: Item, error: unknown, parseError = false) {
    const s = this.s;
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ProviderError && error.fatal) {
      // Bad key, no balance, region block: stop everything until the user fixes it.
      item.state = 'pending';
      s.paused = true;
      s.pauseReason = message;
      this.state = { kind: 'paused', reason: message };
      this.deps.saveSettings();
      this.deps.notify(`AI Curator paused: ${message}`);
    } else {
      item.attempts += 1;
      const retryable = parseError || (error instanceof ProviderError ? error.retryable : true);
      if (retryable && item.attempts < (parseError ? 2 : MAX_ATTEMPTS)) {
        item.state = 'pending';
        item.nextAttemptAt = this.now() + backoffMs(item.attempts);
        item.error = message;
      } else {
        item.state = 'error';
        item.error = message;
      }
    }
    this.deps.persist();
    this.deps.changed();
  }

  // ───────────────────────────── notes ─────────────────────────────

  private async choosePath(item: Item): Promise<string> {
    const vault = this.deps.vault;
    if (item.notePath && vault.stat(item.notePath)) {
      const existing = await vault.read(item.notePath);
      if (isCuratedNote(existing)) return item.notePath;
    }
    const folder = notesFolder(this.s.outputFolder);
    const base = safeFileName(item.analysis!.title || item.title);
    const taken = new Set(this.items().filter((i) => i !== item).map((i) => i.notePath));
    for (let n = 1; n < 1000; n++) {
      const path = `${folder}/${base}${n > 1 ? ` (${n})` : ''}.md`;
      if (taken.has(path)) continue;
      if (!vault.stat(path)) return path;
    }
    return `${folder}/${base} ${this.now()}.md`;
  }

  async writeNote(item: Item, lang: OutputLanguage) {
    if (!item.analysis) return;
    const vault = this.deps.vault;
    const path = await this.choosePath(item);
    const existing = vault.stat(path) ? await vault.read(path) : null;
    const status = (readStatus(existing) as ReadingStatus | undefined) ?? item.status ?? 'unread';
    const related = relatedItems(item, this.items()).map((r) => ({ path: r.notePath!, title: r.analysis!.title }));
    const content = renderNote({ item, analysis: item.analysis, lang, related, analyzedAt: item.analyzedAt ?? this.now(), model: item.model ?? '' }, existing, status);
    await vault.write(path, content);
    item.notePath = path;
    item.status = status as ReadingStatus;
    await this.ensureBase();
  }

  /** Rewrite every curated note's generated part (related links, headings). Free: no AI calls. */
  async refreshNotes(): Promise<number> {
    let n = 0;
    const lang = this.deps.language();
    for (const item of this.items()) {
      if (item.state !== 'done' || !item.analysis) continue;
      try { await this.writeNote(item, lang); n++; } catch { /* keep going */ }
    }
    this.deps.persist();
    this.deps.changed();
    return n;
  }

  async ensureBase() {
    const path = `${this.s.outputFolder}/Reading list.base`;
    if (!this.deps.vault.stat(path)) {
      try { await this.deps.vault.write(path, renderBase(notesFolder(this.s.outputFolder))); } catch { /* optional */ }
    }
  }

  async writeDigest(days = 7): Promise<string> {
    const to = this.now(), from = to - days * 86_400_000;
    const lang = this.deps.language();
    const day = new Date(to).toISOString().slice(0, 10);
    const path = `${this.s.outputFolder}/Digests/${day}.md`;
    await this.deps.vault.write(path, renderDigest({ items: this.items(), from, to: to + 1, lang }));
    return path;
  }
}
