import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { analysisJson, deepseekReply, harness } from './helpers.ts';
import { MARKER } from '../src/notes.ts';

const ARTICLE = (title: string, url: string, body = 'Retrieval quality decides answer quality. '.repeat(30)) => `---
title: "${title}"
source: "${url}"
author: "[[Ann Lee]]"
published: 2026-11-01
tags:
  - clippings
---
${body}
`;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

test('existing notes are held as backlog; new saves are curated after they settle', async () => {
  const h = harness(() => deepseekReply(analysisJson()));
  h.vault.add('Clippings/old.md', ARTICLE('Old', 'https://example.com/old', 'An older article about vector databases. '.repeat(30)), h.clock.now - 86_400_000);
  h.curator.scan();
  assert.equal(h.curator.heldItems().length, 1);

  const fresh = h.vault.add('Clippings/new.md', ARTICLE('New', 'https://example.com/new'));
  h.curator.onCreate(fresh);
  await h.idle();
  assert.equal(h.transport.calls.length, 0, 'not analyzed while the clipper may still be writing');

  h.clock.now += 6000;
  h.curator.kick();
  await h.idle();
  assert.equal(h.transport.calls.length, 1);
  const item = h.curator.get('Clippings/new.md')!;
  assert.equal(item.state, 'done');
  assert.equal(item.author, 'Ann Lee');
  assert.equal(h.curator.get('Clippings/old.md')!.state, 'pending');
  assert.deepEqual(h.firstSuccess, ['Clippings/new.md']);

  const note = h.vault.files.get(item.notePath!)!.content;
  assert.equal(item.notePath, 'AI Curator/Notes/How to evaluate RAG pipelines with small golden sets.md');
  assert.match(note, /^source: "\[\[Clippings\/new\]\]"$/m);
  assert.match(note, /^verdict: read$/m);
  assert.ok(h.vault.files.has('AI Curator/Reading list.base'));

  h.curator.releaseBacklog();
  await h.idle();
  assert.equal(h.curator.get('Clippings/old.md')!.state, 'done');
  assert.equal(h.firstSuccess.length, 1, 'first-success hook (star invite) fires once');
  assert.notEqual(h.curator.get('Clippings/old.md')!.notePath, item.notePath, 'same title gets a distinct file');
});

test('source notes are never modified', async () => {
  const h = harness(() => deepseekReply(analysisJson()), { settings: { settleSeconds: 0 } });
  h.curator.scan();
  const content = ARTICLE('A', 'https://example.com/a');
  h.vault.add('Clippings/a.md', content);
  h.curator.onCreate(h.vault.stat('Clippings/a.md')!);
  await h.idle();
  assert.equal(sha(h.vault.files.get('Clippings/a.md')!.content), sha(content));
  assert.ok(h.vault.writes.every((p) => p.startsWith('AI Curator/')));
});

test('duplicates of an already-curated URL cost nothing', async () => {
  const h = harness(() => deepseekReply(analysisJson()), { settings: { settleSeconds: 0 } });
  h.curator.scan();
  h.vault.add('Clippings/a.md', ARTICLE('A', 'https://example.com/post?utm_source=x'));
  h.curator.onCreate(h.vault.stat('Clippings/a.md')!);
  await h.idle();
  h.vault.add('Clippings/a copy.md', ARTICLE('A again', 'https://www.example.com/post'));
  h.curator.onCreate(h.vault.stat('Clippings/a copy.md')!);
  await h.idle();
  const dup = h.curator.get('Clippings/a copy.md')!;
  assert.equal(dup.state, 'skipped');
  assert.equal(dup.skipReason, 'duplicate');
  assert.equal(dup.dedupeOf, 'Clippings/a.md');
  assert.equal(h.transport.calls.length, 1);
});

test('empty notes are skipped without a call; teasers fetch the original page', async () => {
  const page = '<html><body><article><p>' + 'The full original article text explains the method. '.repeat(40) + '</p></article></body></html>';
  const h = harness((req) => (req.url.includes('blog.example') ? { status: 200, text: page } : deepseekReply(analysisJson())), { settings: { settleSeconds: 0 } });
  h.curator.scan();
  h.vault.add('Clippings/empty.md', '---\nsource: "https://img.example/x.png"\n---\n![[pic.png]]\n');
  h.vault.add('Clippings/teaser.md', '---\nsource: "https://blog.example/post"\n---\nA short teaser line about something…\n');
  h.curator.onCreate(h.vault.stat('Clippings/empty.md')!);
  h.curator.onCreate(h.vault.stat('Clippings/teaser.md')!);
  await h.idle();
  assert.equal(h.curator.get('Clippings/empty.md')!.skipReason, 'empty');
  const teaser = h.curator.get('Clippings/teaser.md')!;
  assert.equal(teaser.state, 'done');
  assert.equal(teaser.fullTextFrom, 'https://blog.example/post');
  const aiCall = h.transport.calls.find((c) => c.url.includes('deepseek'))!;
  assert.match(JSON.parse(aiCall.body!).messages[1].content, /full original article text/);
  assert.equal(h.transport.calls.filter((c) => c.url.includes('deepseek')).length, 1);
});

test('auth or balance errors pause everything and keep the item queued', async () => {
  const h = harness(() => ({ status: 402, text: '{"error":{"message":"Insufficient Balance"}}' }), { settings: { settleSeconds: 0 } });
  h.curator.scan();
  for (const n of [1, 2, 3]) h.vault.add(`Clippings/${n}.md`, ARTICLE(`T${n}`, `https://example.com/${n}`));
  h.curator.scan();
  h.curator.releaseBacklog();
  await h.idle();
  assert.equal(h.settings.paused, true);
  assert.match(h.settings.pauseReason, /Insufficient Balance/);
  assert.ok(h.transport.calls.length <= 2, 'stops quickly instead of burning through the queue');
  assert.ok(h.curator.items().every((i) => i.state === 'pending' && i.attempts === 0));
  assert.equal(h.notices.length >= 1, true);
});

test('transient errors back off and eventually mark the item failed', async () => {
  const h = harness(() => ({ status: 503, text: 'busy' }), { settings: { settleSeconds: 0 } });
  h.curator.scan();
  h.vault.add('Clippings/a.md', ARTICLE('A', 'https://example.com/a'));
  h.curator.onCreate(h.vault.stat('Clippings/a.md')!);
  await h.idle();
  const item = h.curator.get('Clippings/a.md')!;
  assert.equal(item.state, 'pending');
  assert.equal(item.attempts, 1);
  h.curator.kick();
  await h.idle();
  assert.equal(h.transport.calls.length, 1, 'waits for the backoff');
  for (let i = 0; i < 5; i++) { h.clock.now += 31 * 60_000; h.curator.kick(); await h.idle(); }
  assert.equal(item.state, 'error');
  assert.equal(h.transport.calls.length, 4);
  h.curator.retryErrors();
  assert.equal(item.state, 'pending');
});

test('unparseable model output is retried once, then reported', async () => {
  const h = harness(() => deepseekReply('I cannot produce JSON today.'), { settings: { settleSeconds: 0 } });
  h.curator.scan();
  h.vault.add('Clippings/a.md', ARTICLE('A', 'https://example.com/a'));
  h.curator.onCreate(h.vault.stat('Clippings/a.md')!);
  await h.idle();
  h.clock.now += 60_000;
  h.curator.kick();
  await h.idle();
  const item = h.curator.get('Clippings/a.md')!;
  assert.equal(item.state, 'error');
  assert.equal(h.transport.calls.length, 2);
  assert.equal(h.curator.usage().items, 2, 'paid calls are counted even when the reply is unusable');
});

test('the monthly budget stops processing before the cap is passed', async () => {
  const h = harness(() => deepseekReply(analysisJson(), { prompt_tokens: 2_000_000, completion_tokens: 0 }), { settings: { settleSeconds: 0, monthlyBudget: 0.5 } });
  h.curator.scan();
  for (const n of [1, 2]) {
    h.vault.add(`Clippings/${n}.md`, ARTICLE(`T${n}`, `https://example.com/${n}`, `Body number ${n}. `.repeat(40)));
    h.curator.onCreate(h.vault.stat(`Clippings/${n}.md`)!);
    await h.idle();
  }
  assert.equal(h.transport.calls.length, 1);
  assert.equal(h.curator.state.kind, 'limit');
  assert.equal(h.curator.items().filter((i) => i.state === 'pending').length, 1);
});

test('a missing key means no calls and a setup prompt', async () => {
  const h = harness(() => deepseekReply(analysisJson()), { key: '', settings: { settleSeconds: 0 } });
  h.curator.scan();
  h.vault.add('Clippings/a.md', ARTICLE('A', 'https://example.com/a'));
  h.curator.onCreate(h.vault.stat('Clippings/a.md')!);
  await h.idle();
  assert.equal(h.transport.calls.length, 0);
  assert.deepEqual(h.curator.state, { kind: 'needs-setup', reason: 'key' });
});

test('re-curating keeps user notes and status; status edits sync back', async () => {
  let title = 'First title';
  const h = harness(() => deepseekReply(analysisJson({ title })), { settings: { settleSeconds: 0 } });
  h.curator.scan();
  h.vault.add('Clippings/a.md', ARTICLE('A', 'https://example.com/a'));
  h.curator.onCreate(h.vault.stat('Clippings/a.md')!);
  await h.idle();
  const item = h.curator.get('Clippings/a.md')!;
  const path = item.notePath!;
  await h.curator.setStatus('Clippings/a.md', 'read');
  const f = h.vault.files.get(path)!;
  f.content += 'Remember to try this on project X.\n';
  title = 'Second title';
  h.curator.reanalyze('Clippings/a.md');
  await h.idle();
  assert.equal(item.notePath, path, 'same file is updated in place');
  const note = h.vault.files.get(path)!.content;
  assert.match(note, /title: "Second title"/);
  assert.match(note, /^status: read$/m);
  assert.match(note.split(MARKER)[1], /project X/);

  h.vault.files.get(path)!.content = note.replace('status: read', 'status: archived');
  h.curator.onModify(h.vault.stat(path)!);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(item.status, 'archived');
});

test('renames and deletes keep the index consistent', async () => {
  const h = harness(() => deepseekReply(analysisJson()), { settings: { settleSeconds: 0 } });
  h.curator.scan();
  h.vault.add('Clippings/a.md', ARTICLE('A', 'https://example.com/a'));
  h.curator.onCreate(h.vault.stat('Clippings/a.md')!);
  await h.idle();
  const content = h.vault.files.get('Clippings/a.md')!;
  h.vault.files.delete('Clippings/a.md');
  h.vault.files.set('Clippings/sub/b.md', content);
  h.curator.onRename(h.vault.stat('Clippings/sub/b.md')!, 'Clippings/a.md');
  assert.equal(h.curator.get('Clippings/a.md'), undefined);
  assert.equal(h.curator.get('Clippings/sub/b.md')!.state, 'done');

  const notePath = h.curator.get('Clippings/sub/b.md')!.notePath!;
  h.curator.onRename({ ...h.vault.stat(notePath)!, path: 'Elsewhere/n.md' }, notePath);
  assert.equal(h.curator.get('Clippings/sub/b.md')!.notePath, 'Elsewhere/n.md');

  h.curator.onDelete('Clippings/sub/b.md');
  assert.equal(h.curator.items().length, 0);
  assert.equal(h.transport.calls.length, 1);
});

test('a sync tool filling in a teaser later triggers one automatic re-analysis', async () => {
  const h = harness(() => deepseekReply(analysisJson({ completeness: 'teaser' })), { settings: { settleSeconds: 0, fetchFullText: false } });
  h.curator.scan();
  h.vault.add('Clippings/x.md', '---\nurl: "https://x.com/a/status/123456"\n---\nTeaser about a big idea that continues in the article and gets cut off…\n');
  h.curator.onCreate(h.vault.stat('Clippings/x.md')!);
  await h.idle();
  assert.equal(h.transport.calls.length, 1);
  h.clock.now += 1000;
  h.vault.add('Clippings/x.md', '---\nurl: "https://x.com/a/status/123456"\n---\n' + 'Now the full article text is here. '.repeat(40));
  h.curator.onModify(h.vault.stat('Clippings/x.md')!);
  await h.idle();
  assert.equal(h.transport.calls.length, 2);
  // A property-only edit does not trigger another paid call.
  h.clock.now += 1000;
  const f = h.vault.files.get('Clippings/x.md')!;
  f.content = f.content.replace('---\nurl', '---\nstatus: read\nurl');
  f.mtime = h.clock.now;
  h.curator.onModify(h.vault.stat('Clippings/x.md')!);
  await h.idle();
  assert.equal(h.transport.calls.length, 2);
});

test('only chosen folders are read; the output folder is never a source', async () => {
  const h = harness(() => deepseekReply(analysisJson()), { settings: { settleSeconds: 0, sources: ['Clippings'] } });
  h.vault.add('Private/diary.md', ARTICLE('Diary', 'https://example.com/d'));
  h.vault.add('AI Curator/Notes/x.md', ARTICLE('Gen', 'https://example.com/g'));
  h.curator.scan();
  assert.equal(h.curator.items().length, 0);
  assert.equal(h.curator.isSource('Clippings/a.md'), true);
  assert.equal(h.curator.isSource('Clippings/a.png'), false);
  // A note outside the folders can be curated on explicit request.
  assert.equal(h.curator.addManual(h.vault.stat('Private/diary.md')!), true);
  await h.idle();
  assert.equal(h.curator.get('Private/diary.md')!.state, 'done');
  assert.equal(h.curator.addManual(h.vault.stat('AI Curator/Notes/x.md')!), false);
  h.curator.scan();
  assert.ok(h.curator.get('Private/diary.md'), 'manual items survive rescans');
});

test('crash recovery: items stuck in "analyzing" are re-queued on load', () => {
  const h = harness(() => deepseekReply(analysisJson()), {
    index: { version: 1, seededFolders: ['Clippings'], usage: { month: '2026-11', items: 0, inputTokens: 0, outputTokens: 0, cost: 0, costComplete: true, day: '2026-11-13', dayItems: 0 },
      items: { 'Clippings/a.md': { path: 'Clippings/a.md', hash: '', mtime: 0, state: 'analyzing', addedAt: 0, status: 'unread', title: 'a', chars: 0, attempts: 0 } } },
  });
  assert.equal(h.curator.get('Clippings/a.md')!.state, 'pending');
});

test('digest is written to the output folder', async () => {
  const h = harness(() => deepseekReply(analysisJson()), { settings: { settleSeconds: 0 } });
  h.curator.scan();
  h.vault.add('Clippings/a.md', ARTICLE('A', 'https://example.com/a'));
  h.curator.onCreate(h.vault.stat('Clippings/a.md')!);
  await h.idle();
  const path = await h.curator.writeDigest(7);
  assert.match(path, /^AI Curator\/Digests\/2026-11-13\.md$/);
  assert.match(h.vault.files.get(path)!.content, /Read next/);
});
