// Pure helpers for turning arbitrary saved Markdown (Web Clipper, X Bookmarks Sync,
// Readwise, Omnivore exports, hand-written notes...) into clean text for analysis.

export type Frontmatter = Record<string, unknown>;

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

export function stripFrontmatter(text: string): string {
  return text.replace(/^﻿/, '').replace(FRONTMATTER, '');
}

/** Remove UI chrome, embeds and boilerplate that carry no meaning for a reader. */
export function cleanBody(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^.*\]\(obsidian:\/\/[^)]*\).*$/gm, '')
    .replace(/\[(View on X|Read full article|Open in Obsidian Webview|View original|Source)\]\([^)]*\)/gi, '')
    .replace(/^#+\s*(Tweet|Thread|Post) by .*$/gim, '')
    .replace(/^\s*\|\s*$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Length of human text: URLs, markdown syntax and whitespace removed. */
export function meaningfulLength(text: string): number {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#>*_`\-[\]()|!]/g, '')
    .replace(/\s+/g, '').length;
}

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g;

/** Rough, deliberately conservative token estimate for mixed CJK/Latin text. */
export function estimateTokens(text: string): number {
  const cjk = (text.match(CJK) || []).length;
  return Math.ceil(cjk * 1.1 + (text.length - cjk) / 3.5);
}

/** 53-bit FNV-1a style hash; stable, fast and synchronous (no crypto needed). */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef ^ text.length, h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim() || undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return undefined;
}

const URL_KEYS = ['source', 'url', 'link', 'original_url', 'source_url', 'canonical', 'href'];
const AUTHOR_KEYS = ['author', 'authors', 'creator', 'byline', 'username', 'site'];
const DATE_KEYS = ['published', 'date', 'created', 'clipped', 'saved'];

export function isUrl(value: string | undefined): value is string {
  return !!value && /^https?:\/\/[^\s]+$/i.test(value);
}

function cleanAuthor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Web Clipper stores authors as wikilinks: "[[Jane Doe]]".
  return value.replace(/^\[\[|\]\]$/g, '').replace(/^"|"$/g, '').trim() || undefined;
}

export interface SourceMeta {
  url?: string;
  author?: string;
  published?: string;
  title?: string;
  /** All candidate links that could hold the full text, best first. */
  links: string[];
}

export function readMeta(fm: Frontmatter, body: string): SourceMeta {
  let url: string | undefined;
  for (const key of URL_KEYS) {
    const value = str(fm[key]);
    if (isUrl(value)) { url = value; break; }
  }
  let author: string | undefined;
  for (const key of AUTHOR_KEYS) {
    author = cleanAuthor(str(fm[key]));
    if (author) break;
  }
  let published: string | undefined;
  for (const key of DATE_KEYS) {
    published = str(fm[key]);
    if (published) { published = published.slice(0, 10); break; }
  }
  const links: string[] = [];
  const add = (value: string | undefined) => {
    if (isUrl(value) && !links.includes(value)) links.push(value);
  };
  add(url);
  add(str(fm.article_url));
  for (const m of body.matchAll(/\[(?:View on X|Read full article)\]\((https?:\/\/[^)\s]+)\)/gi)) add(m[1]);
  for (const m of body.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) add(m[1]);
  // Bare URLs, also right after CJK punctuation ("GitHub：https://…"); stop at CJK punctuation.
  for (const m of body.matchAll(/(?:^|[^\w/:.=?&%-])(https?:\/\/[^\s)>\]，。、；！？“”‘’（）【】《》"'<]+)/g)) add(m[1].replace(/[.,;:!?]+$/, ''));
  return { url, author, published, title: str(fm.title), links: links.filter((l) => !/^https?:\/\/(?:pbs|video)\.twimg\.com/.test(l)) };
}

export interface XRef { kind: 'status'; id: string; user?: string }

export function parseXUrl(url: string): XRef | null {
  const m = url.match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter|fxtwitter|vxtwitter|fixupx)\.com\/([^/?#]+)\/status(?:es)?\/(\d{5,25})/i);
  if (m) return { kind: 'status', id: m[2], user: m[1] === 'i' ? undefined : m[1] };
  const w = url.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/web\/status\/(\d{5,25})/i);
  return w ? { kind: 'status', id: w[1] } : null;
}

export function isXUrl(url: string): boolean {
  return /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//i.test(url);
}

/** Canonical form used for de-duplication across clipping tools. */
export function canonicalUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const x = parseXUrl(url);
  if (x) return 'x:' + x.id;
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|ref_src$|s$|t$|fbclid$|gclid$|si$)/i.test(key)) u.searchParams.delete(key);
    }
    u.hash = '';
    return (u.host.replace(/^www\./, '') + u.pathname.replace(/\/$/, '') + (u.search || '')).toLowerCase();
  } catch {
    return undefined;
  }
}

export interface ContentAssessment {
  chars: number;
  /** Nothing an AI could honestly analyze. */
  empty: boolean;
  /** Probably only a teaser or a link to the real content. */
  thin: boolean;
}

export function assess(text: string, meta: SourceMeta, rawBody: string): ContentAssessment {
  const chars = meaningfulLength(text);
  const teaserMarker = /\[Read full article\]|## Linked article|\(more\)|…\s*$|\.\.\.\s*$/im.test(rawBody);
  return {
    chars,
    empty: chars < 25,
    thin: chars < 280 || (teaserMarker && chars < 1500) || (meta.links.some((l) => /\/i\/article\//.test(l)) && chars < 1500),
  };
}

const GENERATED_FLAGS = ['ai-curator', 'curator_generated', 'curator-generated', 'generated_by_curator', 'ai_generated_placeholder'];
const PLACEHOLDER_TEXT = /尚未完成\s*AI\s*分析|未生成摘要或评分|此文件由程序维护|AI analysis (?:is )?(?:not yet|pending)|This (?:file|note) is (?:maintained|generated) by (?:a program|the curator)/i;

function truthy(value: unknown): boolean {
  return value === true || value === 1 || (typeof value === 'string' && /^(true|yes|1)$/i.test(value.trim()));
}

/**
 * Notes written by a program about another note (AI Curator's own notes, older curator versions'
 * placeholders, index notes). They describe a source instead of being one, so analyzing them wastes
 * money and, worse, makes them look like duplicates of the real saves.
 */
export function isGeneratedNote(fm: Frontmatter, body: string): boolean {
  if (GENERATED_FLAGS.some((k) => truthy(fm[k]))) return true;
  const text = body.slice(0, 3000);
  if (PLACEHOLDER_TEXT.test(text) && (fm.source_path !== undefined || fm.ai_processed !== undefined || fm.queue_state !== undefined || meaningfulLength(cleanBody(text)) < 400)) return true;
  return false;
}

/** Pick a short human title for notes that have none (tweets). */
export function fallbackTitle(basename: string, text: string): string {
  const base = basename.replace(/^\d{4}-\d{2}-\d{2}[-_ ]?/, '').trim();
  if (base && !/^(untitled|bookmark|未命名)/i.test(base)) return base.slice(0, 90);
  const line = text.split('\n').map((l) => l.replace(/^[#>\-*\s]+/, '').trim()).find((l) => l.length > 3);
  return (line || basename).slice(0, 90);
}

export function truncateForModel(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const head = Math.floor(maxChars * 0.8), tail = maxChars - head;
  return { text: text.slice(0, head) + '\n\n[…middle omitted for length…]\n\n' + text.slice(-tail), truncated: true };
}
