// Pure Markdown rendering for curated notes, digests and the Bases view.
import type { Analysis, Item, Verdict } from './types.ts';
import type { OutputLanguage } from './analysis.ts';

export const MARKER = '%% ai-curator: everything above this line is regenerated. Write your own notes below it. %%';

const L = {
  en: {
    summary: 'Summary', keyIdeas: 'Key ideas', howTo: 'How to apply', caveats: 'Caveats', actions: 'Next actions',
    mentions: 'Mentioned', related: 'Related', source: 'Source', original: 'Original note', link: 'Open original',
    myNotes: 'My notes', partial: 'The saved text was incomplete, so this distillation is partial.',
    verdict: { read: 'Read', skim: 'Skim', reference: 'Reference', skip: 'Skip' } as Record<Verdict, string>,
    digest: 'Reading digest', readNext: 'Read next', worthKeeping: 'Worth keeping for reference', skimmed: 'Skim these summaries',
    stats: (n: number, read: number) => `${n} items curated in this period, ${read} worth reading in full.`,
    empty: 'Nothing new was curated in this period.',
  },
  zh: {
    summary: '摘要', keyIdeas: '核心观点', howTo: '实践方法', caveats: '局限与存疑', actions: '下一步行动',
    mentions: '提及', related: '相关笔记', source: '来源', original: '原始笔记', link: '打开原文',
    myNotes: '我的笔记', partial: '保存的内容不完整，本整理只覆盖了已有部分。',
    verdict: { read: '精读', skim: '速览', reference: '备查', skip: '跳过' } as Record<Verdict, string>,
    digest: '阅读简报', readNext: '值得精读', worthKeeping: '值得备查', skimmed: '读摘要即可',
    stats: (n: number, read: number) => `本期整理 ${n} 篇，其中 ${read} 篇值得精读。`,
    empty: '本期没有新整理的内容。',
  },
};

export function labels(lang: OutputLanguage) { return L[lang] ?? L.en; }

const CALLOUT: Record<Verdict, string> = { read: 'tip', skim: 'info', reference: 'note', skip: 'quote' };

/** A file name that is valid on Windows, macOS, Linux, iOS and Android and inside wikilinks. */
export function safeFileName(title: string, max = 80): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|#^[\]{}%]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  const short = [...cleaned].slice(0, max).join('').trim();
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(short);
  return !short || reserved ? 'Untitled' : short;
}

/** YAML scalar: JSON strings are valid YAML double-quoted scalars. */
function y(value: string | number | boolean): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function yamlList(values: string[]): string {
  return '[' + values.map((v) => JSON.stringify(v)).join(', ') + ']';
}

function linkTarget(path: string): string {
  return path.replace(/\.md$/i, '');
}

function aliasText(text: string): string {
  return text.replace(/[|\]\[]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function wikilink(path: string, alias?: string): string {
  return alias ? `[[${linkTarget(path)}|${aliasText(alias)}]]` : `[[${linkTarget(path)}]]`;
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

function bullets(items: string[], checkbox = false): string {
  return items.map((i) => (checkbox ? '- [ ] ' : '- ') + oneLine(i)).join('\n');
}

export interface RelatedRef { path: string; title: string }

export interface NoteInput {
  item: Item;
  analysis: Analysis;
  lang: OutputLanguage;
  related: RelatedRef[];
  analyzedAt: number;
  model: string;
}

export function renderFrontmatter(input: NoteInput, status: string): string {
  const { item, analysis: a } = input;
  const lines = [
    '---',
    `title: ${y(a.title)}`,
    `source: ${y(wikilink(item.path))}`,
  ];
  if (item.url) lines.push(`url: ${y(item.url)}`);
  if (item.author) lines.push(`author: ${y(item.author)}`);
  if (item.published) lines.push(`published: ${y(item.published)}`);
  lines.push(
    `verdict: ${a.verdict}`,
    `score: ${a.score}`,
    `topic: ${y(a.topic)}`,
    `type: ${a.type}`,
    `tags: ${yamlList(a.tags)}`,
    `status: ${status}`,
    `completeness: ${a.completeness}`,
    `analyzed: ${new Date(input.analyzedAt).toISOString().slice(0, 10)}`,
    `model: ${y(input.model)}`,
    'ai-curator: 1',
    '---',
  );
  return lines.join('\n');
}

export function renderBody(input: NoteInput): string {
  const { item, analysis: a, lang } = input;
  const t = labels(lang);
  const out: string[] = [];
  const reason = a.verdict_reason ? ` — ${oneLine(a.verdict_reason)}` : '';
  out.push(`> [!${CALLOUT[a.verdict]}] ${t.verdict[a.verdict]} · ${a.score}/100${reason}`);
  out.push(`> ${oneLine(a.tldr)}`);
  if (a.relevance) out.push(`>`, `> ${oneLine(a.relevance)}`);
  out.push('');
  if (a.completeness !== 'full') out.push(`> [!warning] ${t.partial}`, '');
  out.push(`## ${t.summary}`, '', a.summary.trim(), '');
  if (a.key_ideas.length) out.push(`## ${t.keyIdeas}`, '', bullets(a.key_ideas), '');
  if (a.how_to.length) out.push(`## ${t.howTo}`, '', a.how_to.map((s, i) => `${i + 1}. ${oneLine(s)}`).join('\n'), '');
  if (a.actions.length) out.push(`## ${t.actions}`, '', bullets(a.actions, true), '');
  if (a.caveats.length) out.push(`## ${t.caveats}`, '', bullets(a.caveats), '');
  if (a.mentions.length) {
    out.push(`## ${t.mentions}`, '');
    for (const m of a.mentions) out.push(`- ${m.url ? `[${aliasText(m.name)}](${m.url})` : m.name} · ${m.kind}`);
    out.push('');
  }
  if (input.related.length) {
    out.push(`## ${t.related}`, '', input.related.map((r) => '- ' + wikilink(r.path, r.title)).join('\n'), '');
  }
  const src = [`${t.source}: ${wikilink(item.path, t.original)}`];
  if (item.url) src.push(`[${t.link}](${item.url})`);
  out.push('---', src.join(' · '), '');
  return out.join('\n');
}

/** Read the reading status a user may have edited in an existing curated note. */
export function readStatus(existing: string | null): string | undefined {
  const m = existing?.match(/^---\r?\n[\s\S]*?^status:\s*["']?(\w+)["']?\s*$/m);
  return m?.[1];
}

/** Everything the user wrote below the marker survives regeneration. */
export function userSection(existing: string | null, lang: OutputLanguage): string {
  if (existing) {
    const at = existing.indexOf(MARKER);
    if (at >= 0) return existing.slice(at + MARKER.length).replace(/^\r?\n/, '');
  }
  return `\n## ${labels(lang).myNotes}\n\n`;
}

export function renderNote(input: NoteInput, existing: string | null, status: string): string {
  return [renderFrontmatter(input, status), '', renderBody(input), MARKER, userSection(existing, input.lang)].join('\n');
}

/** Is this file something the curator wrote (safe to overwrite above the marker)? */
export function isCuratedNote(text: string): boolean {
  return /^---\r?\n[\s\S]*?^ai-curator:\s*1\s*$/m.test(text);
}

/** Local, free knowledge links: shared tags, topic and mentioned tools. */
export function relatedItems(target: Item, all: Item[], limit = 5): Item[] {
  const a = target.analysis;
  if (!a) return [];
  const tags = new Set(a.tags);
  const mentions = new Set(a.mentions.map((m) => m.name.toLowerCase()));
  const scored: { item: Item; score: number }[] = [];
  for (const other of all) {
    const b = other.analysis;
    if (!b || other.path === target.path || !other.notePath || other.state !== 'done') continue;
    let score = 0;
    for (const tag of b.tags) if (tags.has(tag)) score += 2;
    if (b.topic.toLowerCase() === a.topic.toLowerCase()) score += 1;
    for (const m of b.mentions) if (mentions.has(m.name.toLowerCase())) score += 3;
    if (score >= 3) scored.push({ item: other, score: score + b.score / 100 });
  }
  return scored.sort((x, y2) => y2.score - x.score).slice(0, limit).map((s) => s.item);
}

export interface DigestInput {
  items: Item[];
  from: number;
  to: number;
  lang: OutputLanguage;
}

export function renderDigest({ items, from, to, lang }: DigestInput): string {
  const t = labels(lang);
  const inRange = items
    .filter((i) => i.state === 'done' && i.analysis && i.notePath && (i.analyzedAt ?? 0) >= from && (i.analyzedAt ?? 0) < to)
    .sort((a, b) => b.analysis!.score - a.analysis!.score);
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const out = ['---', `title: ${y(`${t.digest} ${day(from)} – ${day(to - 1)}`)}`, 'ai-curator: 1', 'tags: [ai-curator/digest]', '---', ''];
  if (!inRange.length) return out.concat(t.empty, '').join('\n');
  const read = inRange.filter((i) => i.analysis!.verdict === 'read');
  out.push(t.stats(inRange.length, read.length), '');
  const section = (title: string, list: Item[]) => {
    if (!list.length) return;
    out.push(`## ${title}`, '');
    for (const i of list) {
      const a = i.analysis!;
      out.push(`- **${wikilink(i.notePath!, a.title)}** · ${a.score} · ${a.topic}`, `  ${oneLine(a.tldr)}`);
    }
    out.push('');
  };
  section(t.readNext, read);
  section(t.worthKeeping, inRange.filter((i) => i.analysis!.verdict === 'reference'));
  section(t.skimmed, inRange.filter((i) => i.analysis!.verdict === 'skim'));
  const topics = new Map<string, number>();
  for (const i of inRange) topics.set(i.analysis!.topic, (topics.get(i.analysis!.topic) ?? 0) + 1);
  out.push('---', [...topics].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(' · '), '');
  return out.join('\n');
}

/** An Obsidian Bases file over the curated notes folder (core plugin, Obsidian 1.9+). */
export function renderBase(notesFolder: string): string {
  const folder = JSON.stringify(notesFolder);
  const order = ['file.name', 'verdict', 'score', 'topic', 'type', 'status', 'author', 'analyzed'];
  const view = (name: string, filters: string[]) => [
    '  - type: table',
    `    name: ${JSON.stringify(name)}`,
    ...(filters.length ? ['    filters:', '      and:', ...filters.map((f) => `        - ${JSON.stringify(f)}`)] : []),
    '    order:',
    ...order.map((o) => `      - ${o}`),
    '    sort:',
    '      - property: score',
    '        direction: DESC',
  ].join('\n');
  return [
    'filters:',
    '  and:',
    `    - ${JSON.stringify(`file.inFolder(${folder})`)}`,
    '    - \'file.ext == "md"\'',
    'views:',
    view('Read next', ['verdict == "read"', 'status == "unread"']),
    view('Unread', ['status == "unread"', 'verdict != "skip"']),
    view('All curated', []),
    view('Reference', ['verdict == "reference"']),
    '',
  ].join('\n');
}
