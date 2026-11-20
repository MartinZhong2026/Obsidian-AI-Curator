// 1.1: content recovery, grounded extraction and decision rules found while auditing a real library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeBrackets, extractJson, locateSpan, normalizeAnalysis, normalizeForMatch, parseAnalysis, quoteFound, upgradeAnalysis } from '../src/analysis.ts';
import { isGeneratedNote, readMeta, stripFrontmatter } from '../src/extract.ts';
import { draftToMarkdown, enrichRepos, isXArticleTeaser, parseGitHubRepo, prioritizeLinks, textFromFxTwitter } from '../src/fulltext.ts';
import { renderNote, renderToolbox } from '../src/notes.ts';
import { analysisJson, deepseekReply, harness } from './helpers.ts';
import type { Item } from '../src/types.ts';

const PROMPT_POST = `下面是一段用于测试的论文阅读提示词：

请将以下学术论文制作成一个完整的双栏批注HTML文件，重点呈现论文的论证结构与逻辑层次。
【示例要求】
1. 顶部导航栏
- 颜色图例：
• 黄色 = 核心论点/thesis
• 红色 = 关键概念/术语
- 响应式（移动端单栏）

后面是演示图片，如下图`;

// ───────────── grounded extraction ─────────────

test('prompts are copied verbatim from anchors, never retyped', () => {
  const span = locateSpan(PROMPT_POST, '请将以下学术论文制作成一个完整的', '- 响应式（移动端单栏）');
  assert.ok(span);
  assert.ok(span!.startsWith('请将以下学术论文'));
  assert.ok(span!.endsWith('响应式（移动端单栏）'));
  assert.ok(span!.includes('• 黄色 = 核心论点/thesis'));
  assert.ok(!span!.includes('如下图'));
  // Anchors with different whitespace, Markdown emphasis and full-width punctuation still resolve.
  assert.ok(locateSpan(PROMPT_POST, '请将以下学术论文 制作成', '响应式(移动端单栏)'));
  assert.equal(locateSpan(PROMPT_POST, '这句话不在原文里面出现', '响应式（移动端单栏）'), null);
});

test('analysis copies prompt assets and checks quotes against the text', () => {
  const a = normalizeAnalysis(JSON.parse(analysisJson({
    form: 'prompt',
    assets: [{ kind: 'prompt', name: '论文双栏批注', purpose: '读论文', url: '', usage: '', start: '请将以下学术论文制作成', end: '响应式（移动端单栏）', content: '' },
      { kind: 'repo', name: 'fake', purpose: '', url: 'https://github.com/invented/repo', usage: '', start: '', end: '', content: '' }],
    knowledge: [
      { kind: 'method', point: '五色高亮', detail: '', basis: 'stated', quote: '黄色 = 核心论点' },
      { kind: 'method', point: '编造', detail: '', basis: 'stated', quote: '作者测试了 200 篇论文' },
      { kind: 'pitfall', point: '长论文会截断', detail: '', basis: 'inferred', quote: '' },
    ],
  })), { source: PROMPT_POST });
  const prompt = a.assets.find((x) => x.kind === 'prompt')!;
  assert.equal(prompt.verbatim, true);
  assert.ok(prompt.content.includes('【示例要求】'));
  // A URL that is not in the saved text is dropped instead of shown as a source.
  assert.equal(a.assets.find((x) => x.name === 'fake')?.url, '');
  assert.equal(a.knowledge[0].quoteOk, true);
  assert.equal(a.knowledge[1].quoteOk, false);
  assert.equal(a.knowledge[1].quote, '');
  assert.equal(a.knowledge[2].basis, 'inferred');
  assert.equal(a.v, 2);
});

test('quote matching ignores spacing and Markdown but not wording', () => {
  const norm = normalizeForMatch('The **golden set** has 50\nreal questions.').text;
  assert.equal(quoteFound(norm, 'golden set has 50 real questions'), true);
  assert.equal(quoteFound(norm, 'golden set … real questions'), true);
  assert.equal(quoteFound(norm, 'golden set has 500 real questions'), false);
});

test('reusable material is kept instead of skipped; a bare mention is not enough', () => {
  const src = 'x'.repeat(10) + '\n```\nnpx skills add example/repo && run --mode audit --target ./src --fix\n```\n';
  const keep = normalizeAnalysis(JSON.parse(analysisJson({
    verdict: 'skip', skip_reason: 'no-substance', scores: { relevance: 3, depth: 2, evidence: 2, actionability: 3, originality: 2 },
    assets: [{ kind: 'command', name: 'install', purpose: '', url: '', usage: '', start: 'npx skills add example', end: '--target ./src --fix', content: '' }],
  })), { source: src });
  assert.equal(keep.verdict, 'reference');
  const bare = normalizeAnalysis(JSON.parse(analysisJson({
    verdict: 'skim', scores: { relevance: 2, depth: 1, evidence: 1, actionability: 2, originality: 1 },
    assets: [{ kind: 'tool', name: 'search-site.com', purpose: '', url: '', usage: '', start: '', end: '', content: '' }],
  })));
  assert.equal(bare.verdict, 'skip');
});

test('a dropped closing bracket is repaired and misplaced fields are lifted back', () => {
  const broken = '{"title":"T","tldr":"x","summary":"y","argument":{"thesis":"t","evidence":[],"limitations":[],"counterpoints":[],"scores":{"relevance":5,"depth":4,"evidence":3,"actionability":4,"originality":3},"verdict":"read","completeness":"full"}';
  assert.ok(closeBrackets(broken));
  const a = parseAnalysis(broken);
  assert.equal(a.verdict, 'read');
  assert.equal(a.scores.relevance, 5);
  assert.throws(() => extractJson('{"a":[1,2}}'));
});

test('1.0 analyses are readable and keep their verdict and score', () => {
  const old = { ...JSON.parse(analysisJson()), score: 63, verdict: 'read', mentions: [{ name: 'Ragas', kind: 'tool', url: 'https://github.com/explodinggradients/ragas' }] };
  const a = upgradeAnalysis(old);
  assert.equal(a.v, undefined);
  assert.equal(a.score, 63);
  assert.equal(a.verdict, 'read');
  assert.equal(a.knowledge[0].point, 'Small curated sets beat large noisy ones');
  assert.deepEqual(a.steps, ['Collect 50 real questions', 'Label expected sources']);
  assert.equal(a.assets[0].name, 'Ragas');
});

// ───────────── inputs ─────────────

const PLACEHOLDER = `---
curator_generated: true
source_path: Demo X Bookmarks/2026-10-27-demo_reader-Data-review.md
url: https://x.com/demo_reader/status/1000000000000000001
ai_processed: false
queue_state: pending
---

# AI 阅读分析

原始收藏：[[Demo X Bookmarks/2026-10-27-demo_reader-Data-review]]

> 此文件由程序维护；个人批注请写在原始笔记或独立笔记中。

尚未完成 AI 分析，未生成摘要或评分。
`;

test('program-written placeholder notes are recognised; real saves are not', () => {
  assert.equal(isGeneratedNote({ curator_generated: true }, stripFrontmatter(PLACEHOLDER)), true);
  assert.equal(isGeneratedNote({ source_path: 'x', ai_processed: false }, stripFrontmatter(PLACEHOLDER)), true);
  assert.equal(isGeneratedNote({ 'ai-curator': 1 }, '> [!tip] Read'), true);
  assert.equal(isGeneratedNote({ url: 'https://x.com/a/status/1' }, '# Tweet\n\nAI 分析工具真好用，我尚未完成学习计划。'), false);
});

test('bare links after CJK punctuation are found', () => {
  const meta = readMeta({}, '项目叫 demo-video-tool。\nGitHub：https://github.com/example-org/demo-video-tool\n文档见（https://docs.example.com/guide）。');
  assert.ok(meta.links.includes('https://github.com/example-org/demo-video-tool'));
  assert.ok(meta.links.includes('https://docs.example.com/guide'));
});

test('GitHub repository links are parsed; site pages are not', () => {
  assert.deepEqual(parseGitHubRepo('https://github.com/example-org/demo-video-tool/blob/main/README.md'), { owner: 'example-org', repo: 'demo-video-tool' });
  assert.equal(parseGitHubRepo('https://github.com/features/copilot'), null);
  assert.equal(parseGitHubRepo('https://gitlab.com/a/b'), null);
  assert.deepEqual(prioritizeLinks(['https://x.com/a/status/12345', 'https://twitter.com/b/status/12345', 'https://pbs.twimg.com/media/x.jpg', 'https://github.com/o/r', 'https://blog.example.com/p']),
    ['https://x.com/a/status/12345', 'https://blog.example.com/p', 'https://github.com/o/r']);
});

test('X Articles keep headings, lists, links and tables', () => {
  const md = draftToMarkdown({
    blocks: [
      { type: 'unstyled', text: '整条链路分成八步。' },
      { type: 'header-one', text: '第一步：先定数据规范' },
      { type: 'unordered-list-item', text: 'OCR 用 PaddleOCR', entityRanges: [{ key: 0, offset: 6, length: 9 }] },
      { type: 'unordered-list-item', text: 'ASR 用 Whisper' },
      { type: 'atomic', text: ' ', entityRanges: [{ key: 1, offset: 0, length: 1 }] },
      { type: 'atomic', text: ' ', entityRanges: [{ key: 2, offset: 0, length: 1 }] },
    ],
    entityMap: [
      { key: '0', value: { type: 'LINK', data: { url: 'https://github.com/PaddlePaddle/PaddleOCR' } } },
      { key: '1', value: { type: 'MARKDOWN', data: { markdown: '\n| 参与者 | 措施 |\n| --- | --- |\n| 领导 | 试点 |\n' } } },
      { key: '2', value: { type: 'MEDIA', data: {} } },
    ],
  });
  assert.match(md, /## 第一步：先定数据规范/);
  assert.match(md, /- OCR 用 \[PaddleOCR\]\(https:\/\/github\.com\/PaddlePaddle\/PaddleOCR\)\n- ASR 用 Whisper/);
  assert.match(md, /\| 领导 \| 试点 \|/);
  assert.match(md, /\[image\]/);
  const full = textFromFxTwitter({ tweet: { url: 'https://x.com/a/status/1', text: 'https://x.com/i/article/2', article: { title: 'FDE 实战', content: { blocks: [{ type: 'unstyled', text: '正文' }], entityMap: [] } } } });
  assert.equal(full?.text, '# FDE 实战\n\n正文');
  assert.equal(isXArticleTeaser('## Linked article\n\n**T**\n\n[Read full article](https://x.com/i/article/2)', []), true);
});

test('repository facts and README come from the GitHub API, never from the post', async () => {
  const calls: string[] = [];
  const http = async (req: { url: string }) => {
    calls.push(req.url);
    if (req.url.endsWith('/readme')) return { status: 200, text: '# demo-video-tool\n\n![badge](https://img.shields.io/x)\n\nInstall: `pip install demo-video-tool`' };
    return { status: 200, text: JSON.stringify({ full_name: 'example-org/demo-video-tool', html_url: 'https://github.com/example-org/demo-video-tool', description: 'Shot-by-shot video teardown',
      stargazers_count: 10508, forks_count: 900, language: 'Python', license: { spdx_id: 'MIT' }, pushed_at: '2026-11-17T00:00:00Z', topics: ['video'] }) };
  };
  const r = await enrichRepos(['https://x.com/a/status/1', 'https://github.com/example-org/demo-video-tool', 'https://github.com/example-org/demo-video-tool/issues'], http, 2, Date.UTC(2026, 10, 18));
  assert.equal(r.facts.length, 1);
  assert.equal(r.facts[0].stars, 10508);
  assert.equal(r.facts[0].license, 'MIT');
  assert.match(r.text, /Repository facts \(GitHub API, fetched 2026-11-18\)/);
  assert.match(r.text, /pip install demo-video-tool/);
  assert.doesNotMatch(r.text, /shields\.io/);
  assert.equal(calls.length, 2);
  const failing = await enrichRepos(['https://github.com/o/r'], async () => { throw new Error('timeout'); });
  assert.equal(failing.facts.length, 0);
});

// ───────────── engine ─────────────

const REAL_SAVE = (title: string) => `---
id: "1000000000000000001"
author: "Demo Reader"
url: "https://x.com/demo_reader/status/1000000000000000001"
---

# Tweet by Demo Reader

## Linked article

**${title}**

这是一篇关于清洗虚构零售数据的练习。

[Read full article](https://x.com/i/article/1000000000000000002)
`;

test('placeholders are skipped for free and never hide the real save as a "duplicate"', async () => {
  const h = harness(() => deepseekReply(analysisJson({ completeness: 'teaser' })), { settings: { settleSeconds: 0, sources: ['Clippings', 'Legacy'] } });
  h.vault.add('Legacy/placeholder.md', PLACEHOLDER);
  h.vault.add('Clippings/real.md', REAL_SAVE('FDE 实战案例｜数据清洗'));
  h.curator.scan();
  h.curator.releaseBacklog();
  await h.idle();
  assert.equal(h.curator.get('Legacy/placeholder.md')?.state, 'skipped');
  assert.equal(h.curator.get('Legacy/placeholder.md')?.skipReason, 'generated');
  const real = h.curator.get('Clippings/real.md')!;
  assert.equal(real.state, 'done');
  // Without X expansion the article could not be fetched: say how to get it instead of judging the teaser.
  assert.equal(real.recoverable, 'x');
  assert.equal(h.transport.calls.filter((c) => /chat\/completions/.test(c.url)).length, 1);
});

test('a 1.0 library is repaired on upgrade: placeholders dropped, hidden saves curated', async () => {
  const h = harness(() => deepseekReply(analysisJson()), { settings: { settleSeconds: 0, sources: ['Clippings', 'Legacy'] } });
  h.vault.add('Legacy/placeholder.md', PLACEHOLDER);
  h.vault.add('Clippings/real.md', REAL_SAVE('FDE'));
  h.curator.scan();
  // Simulate what 1.0 left behind.
  const ph = h.curator.get('Legacy/placeholder.md')!, real = h.curator.get('Clippings/real.md')!;
  Object.assign(ph, { state: 'done', held: false, analysis: upgradeAnalysis({ ...JSON.parse(analysisJson()), verdict: 'skip', score: 0 }), notePath: 'AI Curator/Notes/占位.md', needsCheck: true });
  Object.assign(real, { state: 'skipped', held: false, skipReason: 'duplicate', dedupeOf: 'Legacy/placeholder.md' });
  h.curator.kick(true);
  await h.idle();
  assert.equal(ph.skipReason, 'generated');
  assert.equal(ph.analysis, undefined);
  assert.equal(real.state, 'done');
});

test('toolbox and notes put copy-ready material first and label provenance', () => {
  const a = normalizeAnalysis(JSON.parse(analysisJson({
    form: 'prompt', payoff: 'A copy-ready prompt.',
    assets: [{ kind: 'prompt', name: 'Paper prompt', purpose: 'Read papers', url: '', usage: 'Paste the paper after it', start: '请将以下学术论文制作成', end: '响应式（移动端单栏）', content: '' }],
    argument: { thesis: 'HTML beats PDF for close reading', evidence: [{ claim: 'Faster', support: 'assertion', quote: '' }], limitations: [], counterpoints: ['Formatting may drift on long papers'] },
  })), { source: PROMPT_POST });
  const item = { path: 'Clippings/p.md', notePath: 'AI Curator/Notes/p.md', state: 'done', status: 'unread', analysis: a, title: 'p', hash: '', mtime: 0, addedAt: 0, chars: 0, attempts: 0,
    repos: [{ url: 'https://github.com/o/r', name: 'o/r', description: 'd', stars: 12345, forks: 1, language: 'Python', license: 'MIT', pushedAt: '2026-11-01T00:00:00Z', archived: false, topics: [], homepage: '', fetchedAt: '2026-11-18' }] } as Item;
  const note = renderNote({ item, analysis: a, lang: 'zh', related: [], analyzedAt: Date.UTC(2026, 10, 18), model: 'm' }, null, 'unread');
  assert.match(note, /\*\*你将获得\*\*：A copy-ready prompt\./);
  assert.match(note, /## 可直接使用[\s\S]*```text\n请将以下学术论文/);
  assert.match(note, /逐字摘自原文/);
  assert.match(note, /另一种看法（AI 推断）/);
  assert.match(note, /★ 12\.3k · Python · MIT/);
  const box = renderToolbox({ items: [item], lang: 'en', now: Date.UTC(2026, 10, 18) });
  assert.match(box, /## Prompts and templates/);
  assert.match(box, /\[\[AI Curator\/Notes\/p\|/);
});

test('valid JSON without scores or verdict is rejected', () => {
  for (const missing of ['scores', 'verdict']) {
    const raw = JSON.parse(analysisJson());
    delete raw[missing];
    assert.throws(() => parseAnalysis(JSON.stringify(raw)), /no scores or verdict/);
  }
});

test('copy-ready fallback content must be an exact source excerpt', () => {
  const original = 'Read the full document and list all proven claims.';
  const raw = JSON.parse(analysisJson({
    assets: [
      { kind: 'prompt', name: 'Exact', content: original },
      { kind: 'prompt', name: 'Rewritten', content: 'Read the article and list the proven facts.' },
    ],
  }));
  const assets = normalizeAnalysis(raw, { source: original }).assets.filter((a) => a.kind === 'prompt');
  assert.deepEqual(assets.map(({ name, content, verbatim }) => ({ name, content, verbatim })),
    [{ name: 'Exact', content: original, verbatim: true }]);
});

test('an unrecovered teaser stays provisional even when the model calls it full text', async () => {
  const h = harness(() => deepseekReply(analysisJson({
    completeness: 'full',
    verdict: 'read',
    scores: { relevance: 5, depth: 5, evidence: 5, actionability: 5, originality: 5 },
  })), { settings: { settleSeconds: 0, fetchFullText: false } });
  const path = 'Clippings/preview.md';
  h.curator.onCreate(h.vault.add(path, '---\nsource: https://example.com/preview\n---\nA short preview of the complete article.'));
  await h.idle();
  const result = h.curator.get(path)?.analysis;
  assert.equal(result?.completeness, 'teaser');
  assert.equal(result?.verdict, 'skim');
  assert.equal(result?.confidence, 'low');
  assert.deepEqual(h.curator.needsSource().map((item) => item.path), [path]);
});
