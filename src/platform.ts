// Obsidian implementations of the engine's ports.
import { type App, TFile, TFolder, htmlToMarkdown, normalizePath, parseYaml, requestUrl } from 'obsidian';
import { Readability } from '@mozilla/readability';
import type { VaultFile, VaultPort } from './curator.ts';
import type { FetchLike, Http, Transport } from './providers.ts';
import type { HtmlParser } from './fulltext.ts';

const TIMEOUT_MS = 180_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('The request timed out.')), ms);
    promise.then((v) => { window.clearTimeout(timer); resolve(v); }, (e) => { window.clearTimeout(timer); reject(e); });
  });
}

/** requestUrl goes through Obsidian's native networking: no CORS issues, works on mobile. */
export const http: Http = async (req) => {
  const res = await withTimeout(requestUrl({
    url: req.url, method: req.method ?? 'GET', headers: req.headers, body: req.body, throw: false,
  }), TIMEOUT_MS);
  let text = '';
  try { text = res.text; } catch { text = ''; }
  return { status: res.status, text };
};

/** A fetch() for SDK clients, backed by requestUrl. */
export const fetchLike: FetchLike = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const headers: Record<string, string> = {};
  new Headers(init?.headers ?? {}).forEach((value, key) => { headers[key] = value; });
  delete headers['content-length'];
  if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const body = typeof init?.body === 'string' ? init.body : init?.body == null ? undefined : String(init.body);
  const res = await withTimeout(requestUrl({ url, method: init?.method ?? 'GET', headers, body, throw: false }), TIMEOUT_MS);
  const noBody = res.status === 204 || res.status === 304;
  return new Response(noBody ? null : res.arrayBuffer, { status: res.status, headers: res.headers });
};

export const transport: Transport = { http, fetch: fetchLike };

export const parseHtml: HtmlParser = (html, url) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Give Readability a base so relative links resolve; DOMParser never runs scripts.
  const base = doc.createElement('base');
  base.href = url;
  doc.head?.prepend(base);
  const article = new Readability(doc, { charThreshold: 300 }).parse();
  if (!article?.content) return null;
  const text = htmlToMarkdown(article.content).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return text ? { title: article.title ?? undefined, text } : null;
};

function toVaultFile(file: TFile): VaultFile {
  return { path: file.path, basename: file.basename, mtime: file.stat.mtime, size: file.stat.size };
}

export function vaultFile(file: TFile): VaultFile { return toVaultFile(file); }

export class ObsidianVault implements VaultPort {
  private app: App;
  constructor(app: App) { this.app = app; }

  listMarkdown(): VaultFile[] { return this.app.vault.getMarkdownFiles().map(toVaultFile); }

  stat(path: string): VaultFile | null {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return f instanceof TFile ? toVaultFile(f) : null;
  }

  async read(path: string): Promise<string> {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(f instanceof TFile)) throw new Error('File not found: ' + path);
    return this.app.vault.cachedRead(f);
  }

  private async ensureFolder(folder: string) {
    if (!folder) return;
    const existing = this.app.vault.getAbstractFileByPath(folder);
    if (existing instanceof TFolder) return;
    if (existing) throw new Error(`"${folder}" exists and is not a folder.`);
    const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '';
    await this.ensureFolder(parent);
    try { await this.app.vault.createFolder(folder); } catch (e) {
      if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) throw e;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const p = normalizePath(path);
    const f = this.app.vault.getAbstractFileByPath(p);
    if (f instanceof TFile) { await this.app.vault.modify(f, content); return; }
    await this.ensureFolder(p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
    await this.app.vault.create(p, content);
  }

  async setFrontmatter(path: string, key: string, value: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(f instanceof TFile)) return;
    await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => { fm[key] = value; });
  }

  parseYaml(text: string): unknown { return parseYaml(text); }
}
