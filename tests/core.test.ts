import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScore, extractJson, normalizeAnalysis, normalizeTag, parseAnalysis, systemPrompt, userMessage } from '../src/analysis.ts';
import { assess, canonicalUrl, cleanBody, fallbackTitle, readMeta, stripFrontmatter, truncateForModel, parseXUrl, hashText } from '../src/extract.ts';
import { isCuratedNote, MARKER, readStatus, relatedItems, renderBase, renderDigest, renderNote, safeFileName, userSection, wikilink } from '../src/notes.ts';
import { backoffMs, budgetCheck, dayKey, emptyUsage, readyItems, recordUsage, rollUsage, readingOrder } from '../src/queue.ts';
import { migrateSettings, normalizeFolder, isInFolder } from '../src/settings.ts';
import { recoverFullText, textFromFxTwitter } from '../src/fulltext.ts';
import { analysisJson } from './helpers.ts';
import type { Item } from '../src/types.ts';

// ───────────── analysis ─────────────

test('normalizeAnalysis clamps scores, normalizes tags and computes a weighted score', () => {
  const a = parseAnalysis(analysisJson({ scores: { relevance: 9, depth: 0, evidence: '3', actionability: 5, originality: 2.6 } }));
  assert.deepEqual(a.scores, { relevance: 5, depth: 1, evidence: 3, actionability: 5, originality: 3 });
  assert.deepEqual(a.tags, ['rag', 'evals', 'llm-ops']);
  assert.equal(a.score, computeScore(a.scores, a.form));
  assert.equal(a.mentions[0].url, 'https://github.com/explodinggradients/ragas');
});

test('verdicts stay consistent with scores', () => {
  const low = normalizeAnalysis(JSON.parse(analysisJson({ verdict: 'read', scores: { relevance: 1, depth: 1, evidence: 1, actionability: 1, originality: 1 } })));
  // A "read" with nothing behind it is not kept as a recommendation; below 2/5 on average it becomes a skip with a reason.
  assert.equal(low.verdict, 'skip');
  assert.equal(low.skip_reason, 'no-substance');
  const high = normalizeAnalysis(JSON.parse(analysisJson({ verdict: 'skip', scores: { relevance: 5, depth: 5, evidence: 5, actionability: 5, originality: 5 } })));
  assert.equal(high.verdict, 'skim');
});

test('teasers are provisional: never "read", never skipped for missing text', () => {
  const s = { relevance: 5, depth: 5, evidence: 5, actionability: 5, originality: 5 };
  assert.equal(computeScore(s, 'tutorial'), 100);
  const read = normalizeAnalysis(JSON.parse(analysisJson({ verdict: 'read', completeness: 'teaser', missing: 'Only the intro was saved.' })));
  assert.notEqual(read.verdict, 'read');
  assert.equal(read.confidence, 'low');
  assert.equal(read.missing, 'Only the intro was saved.');
  const skip = normalizeAnalysis(JSON.parse(analysisJson({ verdict: 'skip', skip_reason: 'no-substance', completeness: 'teaser', scores: { relevance: 2, depth: 1, evidence: 1, actionability: 1, originality: 1 } })));
  assert.notEqual(skip.verdict, 'skip');
  const hype = normalizeAnalysis(JSON.parse(analysisJson({ verdict: 'skip', skip_reason: 'hype', completeness: 'teaser', scores: { relevance: 2, depth: 1, evidence: 1, actionability: 1, originality: 1 } })));
  assert.equal(hype.verdict, 'skip');
});

test('scores are weighted by form: a copy-ready prompt is valued for usability, an argument for evidence', () => {
  const s = { relevance: 4, depth: 2, evidence: 2, actionability: 5, originality: 2 };
  assert.ok(computeScore(s, 'prompt') > computeScore(s, 'analysis'));
  const t = { relevance: 4, depth: 3, evidence: 5, actionability: 1, originality: 3 };
  assert.ok(computeScore(t, 'research') > computeScore(t, 'prompt'));
});

test('extractJson tolerates fences and chatter; rejects non-JSON', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('prefix {"a":{"b":2}} suffix'), { a: { b: 2 } });
  assert.throws(() => extractJson('no json here'));
});

test('malformed fields fall back safely; missing summary is an error', () => {
  const a = normalizeAnalysis({ tldr: 'x', type: 'weird', verdict: 'maybe', completeness: '??', mentions: ['Bun', { name: 'Deno', url: 'javascript:alert(1)' }] });
  assert.equal(a.type, 'other');
  assert.equal(normalizeAnalysis({ tldr: 'x', type: 'Case Study' }).type, 'case-study');
  assert.equal(normalizeAnalysis({ tldr: 'x', type: 'how-to' }).type, 'tutorial');
  assert.equal(a.verdict, 'skim');
  assert.equal(a.completeness, 'full');
  assert.deepEqual(a.mentions.map((m) => [m.name, m.url]), [['Bun', ''], ['Deno', '']]);
  assert.throws(() => normalizeAnalysis({ title: 'only a title' }));
});

test('normalizeTag handles CJK, hashes and spaces', () => {
  assert.equal(normalizeTag('#Machine Learning'), 'machine-learning');
  assert.equal(normalizeTag('大模型 应用'), '大模型-应用');
  assert.equal(normalizeTag('--a__b--'), 'a-b');
});

test('prompts mark saved content as untrusted and include the reader profile', () => {
  const sys = systemPrompt('zh', 'I build agents');
  assert.match(sys, /untrusted data/);
  assert.match(sys, /I build agents/);
  assert.match(sys, /简体中文/);
  const user = userMessage({ title: 'T', text: 'body', truncated: true, topics: ['AI'], tags: ['rag'] });
  assert.match(user, /<saved_item_text>\nbody\n<\/saved_item_text>/);
  assert.match(user, /shortened for length/);
});

// ───────────── extraction ─────────────

const WEB_CLIPPER = `---
title: "Building effective agents"
source: "https://www.anthropic.com/engineering/building-effective-agents?utm_source=x"
author:
  - "[[Erik S]]"
published: 2024-12-19
created: 2026-11-01
tags:
  - "clippings"
---
![hero](https://img.example/hero.png)
Over the past year, we've worked with dozens of teams building LLM agents across industries.
<!-- comment -->
%% obsidian comment %%
`;

test('reads Web Clipper metadata and cleans the body', () => {
  const body = stripFrontmatter(WEB_CLIPPER);
  const fm = { title: 'Building effective agents', source: 'https://www.anthropic.com/engineering/building-effective-agents?utm_source=x', author: ['[[Erik S]]'], published: '2024-12-19' };
  const meta = readMeta(fm, body);
  assert.equal(meta.author, 'Erik S');
  assert.equal(meta.published, '2024-12-19');
  assert.equal(meta.title, 'Building effective agents');
  const clean = cleanBody(body);
  assert.doesNotMatch(clean, /hero|comment/);
  assert.match(clean, /dozens of teams/);
});

test('reads X Bookmarks Sync style notes and finds article links', () => {
  const fm = { id: '1850000000000000000', author: 'Jane', username: 'jane', url: 'https://x.com/jane/status/1850000000000000000', article_url: 'https://x.com/i/article/1850000000000000001' };
  const body = 'Short teaser about agent memory…\n\n[Read full article](https://x.com/i/article/1850000000000000001)';
  const meta = readMeta(fm, body);
  assert.equal(meta.url, fm.url);
  assert.ok(meta.links.includes(fm.article_url));
  const a = assess(cleanBody(body), meta, body);
  assert.equal(a.thin, true);
  assert.equal(a.empty, false);
});

test('canonical URLs de-duplicate tracking params and X mirrors', () => {
  assert.equal(canonicalUrl('https://www.Example.com/a/?utm_source=x&id=2#top'), 'example.com/a?id=2');
  assert.equal(canonicalUrl('https://fxtwitter.com/u/status/12345678'), canonicalUrl('https://x.com/other/status/12345678'));
  assert.equal(parseXUrl('https://x.com/i/web/status/123456')?.id, '123456');
  assert.equal(canonicalUrl('not a url'), undefined);
});

test('empty and media-only notes are detected', () => {
  const body = '![[photo.png]]\n\nhttps://example.com';
  const meta = readMeta({}, body);
  assert.equal(assess(cleanBody(body), meta, body).empty, true);
});

test('fallback titles skip dates and handle untitled notes', () => {
  assert.equal(fallbackTitle('2026-10-27-Some Great Post', ''), 'Some Great Post');
  assert.equal(fallbackTitle('Untitled 3', '# Real heading\nbody'), 'Real heading');
});

test('long input is shortened in the middle, keeping the conclusion', () => {
  const text = 'A'.repeat(1000) + 'END';
  const t = truncateForModel(text, 100);
  assert.equal(t.truncated, true);
  assert.ok(t.text.startsWith('A'.repeat(80)));
  assert.ok(t.text.endsWith('END'));
  assert.equal(hashText('abc'), hashText('abc'));
  assert.notEqual(hashText('abc'), hashText('abd'));
});

// ───────────── notes ─────────────

function doneItem(path: string, over: Partial<Item> = {}, analysis: Record<string, unknown> = {}): Item {
  return {
    path, hash: 'h', mtime: 0, state: 'done', addedAt: 0, status: 'unread', title: path, chars: 1000, attempts: 0,
    notePath: 'AI Curator/Notes/' + path.split('/').pop(), analyzedAt: Date.UTC(2026, 10, 12),
    analysis: parseAnalysis(analysisJson(analysis)), ...over,
  };
}

test('file names are safe on every platform', () => {
  assert.equal(safeFileName('a/b:c*d?"e"<f>|g#h^[i]'), 'a b c d e f g h i');
  assert.equal(safeFileName('CON'), 'Untitled');
  assert.equal(safeFileName('   ...  '), 'Untitled');
  assert.equal([...safeFileName('长'.repeat(200))].length, 80);
  assert.equal(wikilink('Clippings/a.md', 'x | y [z]'), '[[Clippings/a|x y z]]');
});

test('curated notes keep user notes and reading status across regeneration', () => {
  const item = doneItem('Clippings/a.md', { url: 'https://example.com/a', author: 'Ann' });
  const input = { item, analysis: item.analysis!, lang: 'en' as const, related: [], analyzedAt: Date.UTC(2026, 10, 13), model: 'deepseek-flash' };
  const first = renderNote(input, null, 'unread');
  assert.ok(isCuratedNote(first));
  assert.match(first, /^source: "\[\[Clippings\/a\]\]"$/m);
  assert.match(first, /> \[!tip\] Read in full · \d+\/100/);
  assert.match(first, /- \[ \] Build a 20-question set/);
  const edited = first.replace('status: unread', 'status: read') + 'My own thoughts here.\n';
  assert.equal(readStatus(edited), 'read');
  const second = renderNote(input, edited, readStatus(edited)!);
  assert.match(second, /My own thoughts here\./);
  assert.match(second, /^status: read$/m);
  assert.equal(second.split(MARKER).length, 2);
  assert.match(userSection(null, 'zh'), /我的笔记/);
});

test('frontmatter values are quoted so titles cannot break YAML', () => {
  const item = doneItem('Clippings/a.md');
  const input = { item, analysis: { ...item.analysis!, title: 'Colons: "quotes" and\nnewlines', topic: 'a: b' }, lang: 'en' as const, related: [], analyzedAt: 0, model: 'm' };
  const note = renderNote(input, null, 'unread');
  assert.match(note, /^title: "Colons: \\"quotes\\" and\\nnewlines"$/m);
  assert.match(note, /^topic: "a: b"$/m);
});

test('related items come from shared tags, topics and mentions', () => {
  const a = doneItem('Clippings/a.md');
  const b = doneItem('Clippings/b.md');
  const c = doneItem('Clippings/c.md', {}, { tags: ['cooking'], topic: 'Food', mentions: [] });
  const rel = relatedItems(a, [a, b, c]);
  assert.deepEqual(rel.map((r) => r.path), ['Clippings/b.md']);
});

test('digest groups the period by verdict; base file targets the notes folder', () => {
  const items = [doneItem('Clippings/a.md'), doneItem('Clippings/b.md', {}, { verdict: 'reference' })];
  const digest = renderDigest({ items, from: Date.UTC(2026, 10, 6), to: Date.UTC(2026, 10, 14), lang: 'en' });
  assert.match(digest, /2 items curated/);
  assert.match(digest, /## Read next/);
  assert.match(digest, /## Worth keeping/);
  const base = renderBase('AI Curator/Notes');
  assert.match(base, /file\.inFolder\(\\"AI Curator\/Notes\\"\)/);
  assert.match(base, /name: "Read next"/);
});

// ───────────── queue & budget ─────────────

test('usage rolls over by local day and month', () => {
  const t0 = new Date(2026, 10, 13, 23, 0).getTime();
  let u = recordUsage(emptyUsage(t0), t0, 1000, 500, 0.01);
  assert.equal(u.dayItems, 1);
  const nextDay = new Date(2026, 10, 14, 1, 0).getTime();
  u = rollUsage(u, nextDay);
  assert.equal(u.dayItems, 0);
  assert.equal(u.items, 1);
  assert.equal(u.day, dayKey(nextDay));
  const nextMonth = new Date(2026, 11, 1).getTime();
  assert.equal(rollUsage(u, nextMonth).items, 0);
  assert.equal(recordUsage(u, nextDay, 1, 1, null).costComplete, false);
});

test('budget blocks before a call would pass the monthly cap or daily limit', () => {
  const now = Date.now();
  const u = { ...emptyUsage(now), cost: 2.999, dayItems: 3 };
  assert.deepEqual(budgetCheck(u, now, { monthlyBudget: 3, dailyLimit: 100 }, 0.002), { blocked: true, reason: 'monthly' });
  assert.deepEqual(budgetCheck(u, now, { monthlyBudget: 0, dailyLimit: 3 }, 0.002), { blocked: true, reason: 'daily' });
  assert.deepEqual(budgetCheck(u, now, { monthlyBudget: 0, dailyLimit: 100 }, 99), { blocked: false });
});

test('retry backoff grows and is capped', () => {
  assert.equal(backoffMs(1), 30_000);
  assert.equal(backoffMs(2), 60_000);
  assert.equal(backoffMs(20), 30 * 60_000);
});

test('ready items skip held, future-retry and finished items, newest first', () => {
  const base = { hash: '', addedAt: 0, status: 'unread' as const, title: '', chars: 0, attempts: 0 };
  const items: Item[] = [
    { ...base, path: 'old', mtime: 1, state: 'pending' },
    { ...base, path: 'new', mtime: 5, state: 'pending' },
    { ...base, path: 'held', mtime: 9, state: 'pending', held: true },
    { ...base, path: 'later', mtime: 9, state: 'pending', nextAttemptAt: 1000 },
    { ...base, path: 'done', mtime: 9, state: 'done' },
  ];
  assert.deepEqual(readyItems(items, 100).map((i) => i.path), ['new', 'old']);
  const read = doneItem('r.md'), skim = doneItem('s.md', {}, { verdict: 'skim' });
  assert.deepEqual([skim, read].sort(readingOrder).map((i) => i.path), ['r.md', 's.md']);
});

// ───────────── settings ─────────────

test('settings migration normalizes folders and never keeps a raw API key', () => {
  const s = migrateSettings({ sources: ['/Clippings/', 'a\\b', '../escape', 'Clippings'], apiKey: 'sk-leak', outputFolder: '', dailyLimit: -5 });
  assert.deepEqual(s.sources, ['Clippings', 'a/b']);
  assert.equal(s.outputFolder, 'AI Curator');
  assert.equal(s.provider, 'deepseek');
  assert.equal(s.providers.deepseek.model, 'deepseek-flash');
  assert.equal((s as unknown as Record<string, unknown>).apiKey, undefined);
  assert.equal(s.dailyLimit, 1);
  assert.equal(normalizeFolder('a/./b'), 'a/b');
  assert.ok(isInFolder('A/b.md', 'A'));
  assert.ok(!isInFolder('AB/b.md', 'A'));
});

// ───────────── full text ─────────────

test('FxTwitter JSON yields post, article and quote text', () => {
  const r = textFromFxTwitter({ tweet: { url: 'https://x.com/a/status/1', text: 'Thread intro', article: { title: 'Deep dive', content: { blocks: [{ text: 'Para 1' }, { text: 'Para 2' }] } }, quote: { text: 'quoted', author: { screen_name: 'b' } } } });
  assert.ok(r);
  assert.match(r.text, /Thread intro[\s\S]*# Deep dive[\s\S]*Para 1\n\nPara 2[\s\S]*@b/);
  assert.equal(textFromFxTwitter({}), null);
});

test('full-text recovery respects settings and only accepts meaningfully longer text', async () => {
  const urls: string[] = [];
  const longHtml = '<html><body><p>' + 'Real article sentence. '.repeat(80) + '</p></body></html>';
  const http = async (req: { url: string }) => {
    urls.push(req.url);
    if (req.url.includes('fxtwitter')) return { status: 200, text: JSON.stringify({ tweet: { url: 'x', text: 'Long post '.repeat(100) } }) };
    if (req.url.includes('short')) return { status: 200, text: '<html><p>tiny</p></html>' };
    return { status: 200, text: longHtml };
  };
  const parseHtml = (html: string) => ({ text: html.replace(/<[^>]+>/g, ' ').trim() });
  const opts = { http, parseHtml, fetchWeb: true, expandX: false, currentChars: 50 };
  assert.equal(await recoverFullText(['https://x.com/a/status/123456'], opts), null);
  assert.equal(urls.length, 0, 'X is not contacted unless enabled');
  assert.equal(await recoverFullText(['https://short.example/'], opts), null);
  const ok = await recoverFullText(['https://short.example/', 'https://blog.example/post'], opts);
  assert.equal(ok?.from, 'https://blog.example/post');
  const x = await recoverFullText(['https://x.com/a/status/123456'], { ...opts, expandX: true });
  assert.match(x!.text, /Long post/);
  assert.ok(urls.some((u) => u === 'https://api.fxtwitter.com/a/status/123456'));
});
