// Recover the full text of a saved item when the note only holds a teaser.
// Only URLs that are already in the user's note are fetched.
import type { Http } from './providers.ts';
import { isXUrl, meaningfulLength, parseXUrl } from './extract.ts';

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

function blocksText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((b) => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : ''))
    .filter(Boolean)
    .join('\n\n');
}

/** FxTwitter JSON → text: long posts, X Articles and quoted posts. */
export function textFromFxTwitter(json: unknown): FullText | null {
  const tweet = (json as { tweet?: Record<string, any> })?.tweet;
  if (!tweet) return null;
  const parts: string[] = [];
  const article = tweet.article;
  let title: string | undefined;
  if (article && typeof article === 'object') {
    title = typeof article.title === 'string' ? article.title : undefined;
    const body = blocksText(article.content?.blocks) || (typeof article.preview_text === 'string' ? article.preview_text : '');
    if (title) parts.push('# ' + title);
    if (body) parts.push(body);
  }
  if (typeof tweet.text === 'string' && tweet.text.trim()) parts.unshift(tweet.text.trim());
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

/** Try candidate links in order; never throws (full text is a bonus, not a requirement). */
export async function recoverFullText(links: string[], opts: FullTextOptions): Promise<FullText | null> {
  for (const url of links.slice(0, 3)) {
    try {
      let result: FullText | null = null;
      if (isXUrl(url)) {
        if (opts.expandX) result = await fetchX(url, opts.http);
      } else if (opts.fetchWeb) {
        result = await fetchWeb(url, opts.http, opts.parseHtml);
      }
      if (result && meaningfulLength(result.text) > Math.max(opts.currentChars * 1.3, opts.currentChars + 200)) return result;
    } catch {
      // Network errors, paywalls, odd HTML: fall through to the next candidate.
    }
  }
  return null;
}
