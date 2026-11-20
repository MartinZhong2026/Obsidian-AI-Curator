// Recover the full text of a saved item when the note only holds a teaser, and enrich
// linked code repositories with facts from the GitHub API.
// Only URLs that are already in the user's note are fetched.
import type { Http } from './providers.ts';
import { isXUrl, meaningfulLength, parseXUrl } from './extract.ts';
import type { RepoFacts } from './types.ts';

export interface ParsedPage { title?: string; text: string }
/** Turns HTML into readable text (Readability + DOMParser in Obsidian; a stub in tests). */
export type HtmlParser = (html: string, url: string) => ParsedPage | null;

export interface FullText { text: string; from: string; title?: string }

export interface FullTextOptions {
  http: Http;
  parseHtml: HtmlParser;
  fetchWeb: boolean;
  expandX: boolean;
  /** Only accept results that add meaningfully more text than the note already has. */
  currentChars: number;
}

const MAX_HTML = 3_000_000;
const MAX_README = 14_000;

// ───────────────────────────── X / FxTwitter ─────────────────────────────

interface DraftBlock { type?: string; text?: string; entityRanges?: { key: number | string; offset: number; length: number }[] }
interface DraftEntity { type?: string; data?: Record<string, any> }

function entityLookup(map: unknown): (key: number | string) => DraftEntity | undefined {
  if (Array.isArray(map)) {
    const byKey = new Map<string, DraftEntity>();
    for (const e of map) if (e && typeof e === 'object') byKey.set(String((e as any).key), (e as any).value ?? {});
    return (k) => byKey.get(String(k));
  }
  if (map && typeof map === 'object') return (k) => (map as Record<string, DraftEntity>)[String(k)];
  return () => undefined;
}

/** X Articles are Draft.js documents. Keep headings, lists, links, tables and code; mark images. */
export function draftToMarkdown(content: unknown): string {
  const c = content as { blocks?: DraftBlock[]; entityMap?: unknown } | undefined;
  if (!c || !Array.isArray(c.blocks)) return '';
  const entity = entityLookup(c.entityMap);
  const out: string[] = [];
  let ordered = 0;
  for (const b of c.blocks) {
    const type = b.type ?? 'unstyled';
    let text = typeof b.text === 'string' ? b.text : '';
    if (type === 'atomic') {
      const e = b.entityRanges?.length ? entity(b.entityRanges[0].key) : undefined;
      const kind = e?.type ?? '';
      if (kind === 'MARKDOWN' && typeof e?.data?.markdown === 'string') out.push(e.data.markdown.trim());
      else if (kind === 'DIVIDER') out.push('---');
      else if (kind === 'MEDIA') out.push('[image]');
      else if (kind === 'TWEET' && e?.data?.url) out.push(`[Embedded post](${e.data.url})`);
      else if (kind === 'LINK' && e?.data?.url) out.push(e.data.url);
      ordered = 0;
      continue;
    }
    // Inline links: rewrite from the end so offsets stay valid.
    const links = (b.entityRanges ?? [])
      .map((r) => ({ r, e: entity(r.key) }))
      .filter(({ e }) => e?.type === 'LINK' && typeof e.data?.url === 'string')
      .sort((x, y) => y.r.offset - x.r.offset);
    for (const { r, e } of links) {
      const label = text.slice(r.offset, r.offset + r.length);
      const url = e!.data!.url as string;
      text = text.slice(0, r.offset) + (label.trim() && label.trim() !== url ? `[${label}](${url})` : url) + text.slice(r.offset + r.length);
    }
    if (!text.trim()) { ordered = 0; continue; }
    if (type !== 'ordered-list-item') ordered = 0;
    switch (type) {
      case 'header-one': out.push('## ' + text.trim()); break;
      case 'header-two': out.push('### ' + text.trim()); break;
      case 'header-three': out.push('#### ' + text.trim()); break;
      case 'unordered-list-item': out.push('- ' + text.trim()); break;
      case 'ordered-list-item': out.push(`${++ordered}. ` + text.trim()); break;
      case 'blockquote': out.push('> ' + text.trim().replace(/\n/g, '\n> ')); break;
      case 'code-block': out.push('```\n' + text + '\n```'); break;
      default: out.push(text.trim());
    }
  }
  // Join list items tightly, everything else with blank lines.
  return out.reduce((acc, line, i) => {
    if (i === 0) return line;
    const prevList = /^(- |\d+\. )/.test(out[i - 1]), curList = /^(- |\d+\. )/.test(line);
    return acc + (prevList && curList ? '\n' : '\n\n') + line;
  }, '');
}

/** FxTwitter JSON → text: long posts, X Articles (as Markdown) and quoted posts. */
export function textFromFxTwitter(json: unknown): FullText | null {
  const tweet = (json as { tweet?: Record<string, any> })?.tweet;
  if (!tweet) return null;
  const parts: string[] = [];
  const article = tweet.article;
  let title: string | undefined;
  if (article && typeof article === 'object') {
    title = typeof article.title === 'string' ? article.title : undefined;
    const body = draftToMarkdown(article.content) || (typeof article.preview_text === 'string' ? article.preview_text : '');
    if (title) parts.push('# ' + title);
    if (body) parts.push(body);
  }
  const own = typeof tweet.text === 'string' ? tweet.text.trim() : '';
  // An article post's own text is usually just the article link.
  if (own && !(article && /^https?:\/\/\S+$/.test(own))) parts.unshift(own);
  const quote = tweet.quote;
  if (quote && typeof quote.text === 'string' && quote.text.trim()) {
    parts.push(`> Quoted post by @${quote.author?.screen_name ?? 'unknown'}:\n> ${quote.text.trim().replace(/\n/g, '\n> ')}`);
  }
  const text = parts.join('\n\n').trim();
  return text ? { text, from: String(tweet.url || 'x'), title } : null;
}

async function fetchX(url: string, http: Http): Promise<FullText | null> {
  const ref = parseXUrl(url);
  if (!ref) return null;
  const api = `https://api.fxtwitter.com/${ref.user ?? 'i'}/status/${ref.id}`;
  const res = await http({ url: api, method: 'GET', headers: { Accept: 'application/json' } });
  if (res.status !== 200) return null;
  try { return textFromFxTwitter(JSON.parse(res.text)); } catch { return null; }
}

async function fetchWeb(url: string, http: Http, parseHtml: HtmlParser): Promise<FullText | null> {
  const res = await http({ url, method: 'GET', headers: { Accept: 'text/html,application/xhtml+xml' } });
  if (res.status < 200 || res.status >= 300 || !res.text || res.text.length > MAX_HTML) return null;
  if (!/<html|<body|<article|<p[\s>]/i.test(res.text.slice(0, 20000))) return null;
  const page = parseHtml(res.text, url);
  return page && page.text.trim() ? { text: page.text.trim(), from: url, title: page.title } : null;
}

// ───────────────────────────── GitHub ─────────────────────────────

const GITHUB_RESERVED = new Set(['orgs', 'features', 'topics', 'settings', 'login', 'marketplace', 'sponsors', 'about', 'pricing',
  'explore', 'collections', 'trending', 'search', 'notifications', 'apps', 'enterprise', 'customer-stories', 'readme', 'security', 'site']);

export function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})(?:[/?#]|$)/i);
  if (!m || GITHUB_RESERVED.has(m[1].toLowerCase())) return null;
  const repo = m[2].replace(/\.git$/i, '');
  if (!repo || repo === '.' || repo === '..') return null;
  return { owner: m[1], repo };
}

/** README → plain-ish Markdown: drop HTML, badges and images that carry no text for a reader. */
export function cleanReadme(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\s*\]\([^)]*\)/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<\/?(?:p|div|span|a|picture|source|br|hr|sup|sub|details|summary|center|h\d)[^>]*>/gi, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function repoFactsText(f: RepoFacts): string {
  const lines = [`- Repository: ${f.url}`];
  if (f.description) lines.push(`- Description: ${f.description}`);
  lines.push(`- Stars: ${f.stars} · Forks: ${f.forks}${f.language ? ' · Language: ' + f.language : ''}${f.license ? ' · License: ' + f.license : ''}`);
  if (f.pushedAt) lines.push(`- Last push: ${f.pushedAt.slice(0, 10)}${f.archived ? ' (archived)' : ''}`);
  if (f.topics.length) lines.push(`- Topics: ${f.topics.join(', ')}`);
  if (f.homepage) lines.push(`- Homepage: ${f.homepage}`);
  return lines.join('\n');
}

export async function fetchGitHub(url: string, http: Http, now = Date.now()): Promise<{ facts: RepoFacts; readme: string } | null> {
  const ref = parseGitHubRepo(url);
  if (!ref) return null;
  const base = `https://api.github.com/repos/${ref.owner}/${ref.repo}`;
  const res = await http({ url: base, method: 'GET', headers: { Accept: 'application/vnd.github+json' } });
  if (res.status !== 200) return null;
  let d: Record<string, any>;
  try { d = JSON.parse(res.text); } catch { return null; }
  if (!d || typeof d.full_name !== 'string') return null;
  const facts: RepoFacts = {
    url: typeof d.html_url === 'string' ? d.html_url : `https://github.com/${d.full_name}`,
    name: d.full_name,
    description: typeof d.description === 'string' ? d.description.slice(0, 400) : '',
    stars: Number(d.stargazers_count) || 0,
    forks: Number(d.forks_count) || 0,
    language: typeof d.language === 'string' ? d.language : '',
    license: typeof d.license?.spdx_id === 'string' && d.license.spdx_id !== 'NOASSERTION' ? d.license.spdx_id : (d.license?.name ?? ''),
    pushedAt: typeof d.pushed_at === 'string' ? d.pushed_at : '',
    archived: !!d.archived,
    topics: Array.isArray(d.topics) ? d.topics.filter((t: unknown) => typeof t === 'string').slice(0, 10) : [],
    homepage: typeof d.homepage === 'string' && /^https?:\/\//.test(d.homepage) ? d.homepage : '',
    fetchedAt: new Date(now).toISOString().slice(0, 10),
  };
  let readme = '';
  try {
    const r = await http({ url: base + '/readme', method: 'GET', headers: { Accept: 'application/vnd.github.raw' } });
    if (r.status === 200 && r.text && !r.text.trimStart().startsWith('{')) readme = cleanReadme(r.text).slice(0, MAX_README);
  } catch { /* README is optional */ }
  return { facts, readme };
}

// ───────────────────────────── orchestration ─────────────────────────────

/** Order candidate links by how likely they hold the real content, de-duplicated. */
export function prioritizeLinks(links: string[]): string[] {
  const seen = new Set<string>();
  const out: { url: string; rank: number }[] = [];
  for (const url of links) {
    const x = parseXUrl(url);
    const key = x ? 'x:' + x.id : url.replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (/^https?:\/\/(?:pbs|video|abs)\.twimg\.com|\.(?:png|jpe?g|gif|webp|mp4|svg)(?:[?#]|$)/i.test(url)) continue;
    if (/^https?:\/\/(?:t\.co|x\.com\/i\/article)\//i.test(url) && !x) continue;
    const rank = x ? 1 : parseGitHubRepo(url) ? 3 : isXUrl(url) ? 9 : 2;
    out.push({ url, rank });
  }
  return out.sort((a, b) => a.rank - b.rank).map((o) => o.url);
}

/** Try candidate links in order; never throws (full text is a bonus, not a requirement). */
export async function recoverFullText(links: string[], opts: FullTextOptions): Promise<FullText | null> {
  let tried = 0;
  for (const url of prioritizeLinks(links)) {
    if (tried >= 3) break;
    try {
      let result: FullText | null = null;
      if (isXUrl(url)) {
        if (!opts.expandX) continue;
        tried++;
        result = await fetchX(url, opts.http);
      } else if (parseGitHubRepo(url)) {
        continue; // repositories are handled by enrichRepos
      } else if (opts.fetchWeb) {
        tried++;
        result = await fetchWeb(url, opts.http, opts.parseHtml);
      }
      if (result && meaningfulLength(result.text) > Math.max(opts.currentChars * 1.3, opts.currentChars + 200)) return result;
    } catch {
      // Network errors, paywalls, odd HTML: fall through to the next candidate.
    }
  }
  return null;
}

/** Facts + README for up to `max` GitHub repositories linked from the note. */
export async function enrichRepos(links: string[], http: Http, max = 2, now = Date.now()): Promise<{ facts: RepoFacts[]; text: string }> {
  const facts: RepoFacts[] = [];
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const url of links) {
    const ref = parseGitHubRepo(url);
    if (!ref) continue;
    const key = `${ref.owner}/${ref.repo}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (facts.length >= max) break;
    try {
      const r = await fetchGitHub(url, http, now);
      if (!r) continue;
      facts.push(r.facts);
      parts.push(`## Repository facts (GitHub API, fetched ${r.facts.fetchedAt}): ${r.facts.name}\n\n${repoFactsText(r.facts)}` +
        (r.readme ? `\n\n### README of ${r.facts.name} (excerpt)\n\n${r.readme}` : ''));
    } catch { /* rate limit or network: skip */ }
  }
  return { facts, text: parts.join('\n\n') };
}

/** Is this X post just a teaser for a long-form X Article? */
export function isXArticleTeaser(rawBody: string, links: string[]): boolean {
  return /## Linked article|\[Read full article\]/i.test(rawBody) || links.some((l) => /x\.com\/i\/article\//i.test(l));
}
