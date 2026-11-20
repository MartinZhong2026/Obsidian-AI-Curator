import { translate, uiLanguage } from './i18n.ts';
import { ItemView, Menu, Notice, TFile, type WorkspaceLeaf, debounce, setIcon, setTooltip } from 'obsidian';
import type AICuratorPlugin from './main.ts';
import type { Asset, Item, Verdict } from './types.ts';
import { readingOrder } from './queue.ts';
import { money } from './ui.ts';
import { SetupModal } from './onboarding.ts';
import { openExternal } from './support.ts';
import { VERBATIM_KINDS } from './analysis.ts';
import { formatStars } from './notes.ts';

export const VIEW_TYPE = 'ai-curator-inbox';

type Tab = 'focus' | 'unread' | 'toolbox' | 'incomplete' | 'skip' | 'done' | 'queue';

const TABS: { id: Tab; label: string; hint: string; minor?: boolean }[] = [
  { id: 'focus', label: 'Worth your attention', hint: 'The most valuable unread items, best first' },
  { id: 'unread', label: 'All unread', hint: 'Everything unread except skips' },
  { id: 'toolbox', label: 'Toolbox', hint: 'Prompts, code, tables, repositories and resources you can reuse' },
  { id: 'incomplete', label: 'Needs full text', hint: 'Only a teaser was saved; the verdict is provisional' },
  { id: 'skip', label: 'Skipped', hint: 'Low value for you, with the reason', minor: true },
  { id: 'done', label: 'Done', hint: 'Read or archived', minor: true },
  { id: 'queue', label: 'Queue', hint: 'Waiting, failed or skipped items', minor: true },
];

const VERDICT_LABEL: Record<Verdict, string> = { read: 'Read in full', skim: 'Notes are enough', reference: 'Keep for reuse', skip: 'Skip' };
const FORM_LABEL: Record<string, string> = {
  tutorial: 'Tutorial', explainer: 'Explainer', tool: 'Tool', prompt: 'Prompt', code: 'Code', research: 'Research', analysis: 'Analysis',
  'case-study': 'Case study', 'resource-list': 'Resource list', news: 'News', discussion: 'Discussion', other: 'Other',
  'deep-dive': 'Explainer', opinion: 'Analysis', thread: 'Discussion', project: 'Tool',
};
const SKIP_REASON: Record<string, string> = { 'off-topic': 'Not for you', hype: 'Hype', 'no-substance': 'No substance', outdated: 'Outdated' };
const ASSET_ICON: Record<string, string> = {
  prompt: 'message-square-quote', template: 'file-code', code: 'code', command: 'terminal', config: 'settings-2', table: 'table', checklist: 'list-checks',
  repo: 'github', tool: 'wrench', resource: 'book-open', course: 'graduation-cap', paper: 'file-text', dataset: 'database',
};
const ASSET_LABEL: Record<string, string> = {
  prompt: 'Prompt', template: 'Template', code: 'Code', command: 'Command', config: 'Config', table: 'Table', checklist: 'Checklist',
  repo: 'Repository', tool: 'Tool', resource: 'Resource', course: 'Course', paper: 'Paper', dataset: 'Dataset',
};
const PAGE = 60;

function host(url?: string): string {
  if (!url) return '';
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
}

const isTeaser = (i: Item) => i.analysis?.completeness === 'teaser';
/** Attention order: value first, then "read in full" picks and copy-ready material. Teasers wait in their own lane. */
function priority(i: Item): number {
  const a = i.analysis!;
  return a.score + (a.verdict === 'read' ? 8 : 0) + (a.assets.some((x) => VERBATIM_KINDS.has(x.kind)) ? 3 : 0);
}

interface ToolRow { asset: Asset; item: Item; stars?: number }

export class CuratorView extends ItemView {
  private tab: Tab = 'focus';
  private query = '';
  private topic = '';
  private limit = PAGE;
  private renderedLanguage = uiLanguage();
  private off: (() => void) | null = null;
  private listEl!: HTMLElement;
  private headerEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private tabsEl!: HTMLElement;
  private toolsEl!: HTMLElement;
  private leftovers: string[] = [];
  private refresh = debounce(() => this.render(), 250, true);

  private plugin: AICuratorPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: AICuratorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return translate("Reading inbox"); }
  getIcon() { return 'sparkles'; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('ai-curator-view');
    this.headerEl = root.createDiv({ cls: 'aic-header' });
    this.bannerEl = root.createDiv({ cls: 'aic-banners' });
    this.tabsEl = root.createDiv({ cls: 'aic-tabs', attr: { role: 'tablist' } });
    this.toolsEl = root.createDiv({ cls: 'aic-tools' });
    this.listEl = root.createDiv({ cls: 'aic-list' });
    this.buildTools();
    this.off = this.plugin.onChange(() => { this.refresh(); this.checkLeftovers(); });
    const c = this.curator.counts();
    if (!c.done && (c.pending || c.held || c.errors)) this.tab = 'queue';
    else if (!this.itemsFor('focus', false).length && this.itemsFor('unread', false).length) this.tab = 'unread';
    this.render();
    this.checkLeftovers();
  }

  async onClose() { this.off?.(); }

  private get curator() { return this.plugin.curator; }

  private checkLeftovers = debounce(() => {
    void this.curator.generatedNoteLeftovers().then((next) => {
      if (next.join('|') !== this.leftovers.join('|')) { this.leftovers = next; this.renderBanners(); }
    });
  }, 1500, true);

  private render() {
    if (this.renderedLanguage !== uiLanguage()) {
      this.renderedLanguage = uiLanguage();
      this.toolsEl.empty();
      this.buildTools();
      const search = this.toolsEl.querySelector('input') as HTMLInputElement;
      search.value = this.query;
    }
    this.renderHeader();
    this.renderBanners();
    this.renderTabs();
    this.renderTopicFilter();
    this.renderList();
  }

  // ───────────────────────────── header ─────────────────────────────

  private renderHeader() {
    const el = this.headerEl;
    el.empty();
    const titleRow = el.createDiv({ cls: 'aic-title-row' });
    const t = titleRow.createDiv({ cls: 'aic-title' });
    t.createEl('h2', { text: translate("Reading inbox") });
    t.createDiv({ cls: 'aic-subtitle', text: this.stateLine() });
    const actions = titleRow.createDiv({ cls: 'aic-header-actions' });
    const button = (icon: string, label: string, onClick: () => void) => {
      const b = actions.createEl('button', { cls: 'clickable-icon aic-icon-btn', attr: { 'aria-label': label } });
      setIcon(b, icon);
      b.addEventListener('click', onClick);
      return b;
    };
    button('refresh-cw', translate("Scan and process now"), () => { this.curator.scan(); this.curator.kick(true); });
    const paused = this.plugin.settings.paused;
    button(paused ? 'play' : 'pause', paused ? translate("Resume curation") : translate("Pause curation"), () => { void this.plugin.pause(!paused); });
    button('wrench', translate("Open toolbox note"), async () => this.openPath(await this.curator.writeToolbox(), true));
    button('newspaper', translate("Create weekly digest"), async () => this.openPath(await this.curator.writeDigest(7), true));
    button('settings', translate("Settings"), () => {
      const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
      setting?.open();
      setting?.openTabById(this.plugin.manifest.id);
    });

    // One line that says where you stand; each part jumps to its lane.
    const focus = this.itemsFor('focus', false).length;
    const unread = this.itemsFor('unread', false).length;
    const tools = this.toolRows(false).length;
    const incomplete = this.itemsFor('incomplete', false).length;
    const line = el.createDiv({ cls: 'aic-summary' });
    const part = (n: number, label: string, tab: Tab, cls = '') => {
      const b = line.createEl('button', { cls: 'aic-summary-part ' + cls });
      b.createSpan({ cls: 'aic-summary-n', text: String(n) });
      b.createSpan({ text: ' ' + label });
      b.addEventListener('click', () => { this.tab = tab; this.limit = PAGE; this.render(); });
    };
    part(focus, translate("worth your attention"), 'focus', 'is-accent');
    part(unread, translate("unread"), 'unread');
    part(tools, translate("reusable assets"), 'toolbox');
    if (incomplete) part(incomplete, translate("need the full text"), 'incomplete', 'is-warn');
    const u = this.curator.usage();
    const c = this.curator.counts();
    el.createDiv({ cls: 'aic-summary-meta', text: translate("{0} curated · {1} this month", c.done, money(u.cost)) });
  }

  private stateLine(): string {
    const st = this.curator.state;
    const c = this.curator.counts();
    switch (st.kind) {
      case 'working': return translate("Curating “{0}”…", st.current);
      case 'paused': return translate("Paused");
      case 'needs-setup': return translate("Setup needed");
      case 'limit': return st.reason === 'daily' ? translate("Daily limit reached; continues tomorrow") : translate("Monthly budget reached");
      default:
        if (c.pending) return translate("{0} waiting (new saves settle for a few seconds first)", c.pending);
        return c.done ? translate("All caught up") : translate("Waiting for your first saves");
    }
  }

  // ───────────────────────────── banners ─────────────────────────────

  private banner(kind: 'info' | 'warn' | 'error', icon: string, text: string, actions: [string, () => void, boolean?][]) {
    const b = this.bannerEl.createDiv({ cls: `aic-banner is-${kind}` });
    setIcon(b.createDiv({ cls: 'aic-banner-icon' }), icon);
    b.createDiv({ cls: 'aic-banner-text', text });
    const a = b.createDiv({ cls: 'aic-banner-actions' });
    for (const [label, fn, cta] of actions) {
      const btn = a.createEl('button', { text: label, cls: cta ? 'mod-cta' : '' });
      btn.addEventListener('click', fn);
    }
  }

  private renderBanners() {
    this.bannerEl.empty();
    const st = this.curator.state;
    const s = this.plugin.settings;
    if (st.kind === 'needs-setup') {
      const text = st.reason === 'sources' ? translate("Choose which folders to curate.")
        : st.reason === 'key' ? translate("Add your AI provider’s API key to start curating.")
        : translate("Choose an AI model to start curating.");
      this.banner('info', 'wand-2', text, [[translate("Open setup"), () => new SetupModal(this.app, this.plugin).open(), true]]);
    }
    if (s.paused) {
      this.banner(s.pauseReason && s.pauseReason !== 'Paused by you.' ? 'error' : 'warn', 'pause-circle',
        s.pauseReason && s.pauseReason !== 'Paused by you.' ? translate("Paused: {0}", s.pauseReason) : translate("Curation is paused."),
        [[translate("Resume"), () => { void this.plugin.pause(false); }, true]]);
    }
    if (st.kind === 'limit') {
      this.banner('warn', 'wallet', st.reason === 'daily'
        ? translate("Daily limit of {0} items reached. Curation continues tomorrow.", s.dailyLimit)
        : translate("Monthly budget of {0} reached. Raise it in settings to continue.", money(s.monthlyBudget)), []);
    }
    const legacy = this.curator.legacyItems();
    if (legacy.length) {
      const cost = this.curator.estimateCost(legacy);
      const actions: [string, () => void, boolean?][] = [[translate("Curate all {0} again", legacy.length), () => this.curator.recurate(legacy), true]];
      if (legacy.length > 10) actions.push([translate("Top 10"), () => this.curator.recurate(legacy.slice(0, 10))]);
      this.banner('info', 'sparkles', translate("{0} items were curated by version 1.0, which did not keep prompts, repositories or knowledge points. Curating them again costs about {1}.", legacy.length, cost == null ? '?' : money(cost)), actions);
    }
    const xItems = this.curator.recoverableX();
    if (xItems.length && !s.expandX) {
      this.banner('info', 'twitter', translate("{0} saved X posts are long-form articles, but only their first paragraph was saved. Turn on X expansion to read the full text (the post link is sent to the public FxTwitter service).", xItems.length), [
        [translate("Turn on and curate again"), async () => { s.expandX = true; await this.plugin.saveSettings(); this.curator.recurate(xItems); }, true],
      ]);
    }
    if (this.leftovers.length) {
      this.banner('warn', 'trash-2', translate("{0} curated notes describe placeholder files written by another program (not your saves). Move them to the trash? Notes you wrote in are kept.", this.leftovers.length), [
        [translate("Move to trash"), async () => { const n = await this.curator.trashGeneratedLeftovers(); this.leftovers = []; new Notice(translate("Moved {0} notes to the trash.", n)); this.render(); }],
      ]);
    }
    const held = this.curator.heldItems();
    if (held.length) {
      const est = this.curator.backlogEstimate();
      const cost = est.cost == null ? '' : translate(" Curating all costs about {0}.", money(est.cost));
      const actions: [string, () => void, boolean?][] = [];
      if (held.length > 10) actions.push([translate("Newest 10"), () => this.curator.releaseBacklog(10), true]);
      actions.push([translate("All {0}", held.length), () => this.curator.releaseBacklog(), held.length <= 10]);
      this.banner('info', 'archive', translate("{0} notes were already in your folders before AI Curator. New saves are curated automatically; choose what to do with these.{1}", held.length, cost), actions);
    }
    const errors = this.curator.counts().errors;
    if (errors) this.banner('error', 'alert-triangle', translate("{0} items failed.", errors), [[translate("Retry"), () => this.curator.retryErrors()], [translate("Show"), () => { this.tab = 'queue'; this.render(); }]]);
  }

  // ───────────────────────────── tabs and filters ─────────────────────────────

  private tabCount(tab: Tab): number { return tab === 'toolbox' ? this.toolRows(false).length : this.itemsFor(tab, false).length; }

  private renderTabs() {
    this.tabsEl.empty();
    for (const t of TABS) {
      const n = this.tabCount(t.id);
      if (t.minor && !n && this.tab !== t.id) continue;
      const el = this.tabsEl.createEl('button', { cls: 'aic-tab' + (this.tab === t.id ? ' is-active' : '') + (t.minor ? ' is-minor' : ''), attr: { role: 'tab', 'aria-selected': String(this.tab === t.id) } });
      el.createSpan({ text: translate(t.label) });
      if (n) el.createSpan({ cls: 'aic-tab-count', text: String(n) });
      setTooltip(el, translate(t.hint));
      el.addEventListener('click', () => { this.tab = t.id; this.limit = PAGE; this.render(); });
    }
  }

  private buildTools() {
    const search = this.toolsEl.createEl('input', { cls: 'aic-search', attr: { type: 'search', placeholder: translate("Search titles, summaries, knowledge, tools…"), 'aria-label': translate("Search") } });
    search.addEventListener('input', debounce(() => { this.query = search.value.trim().toLowerCase(); this.limit = PAGE; this.renderList(); this.renderTabs(); }, 200, true));
    this.toolsEl.createEl('select', { cls: 'dropdown aic-topic', attr: { 'aria-label': translate("Filter by topic") } });
  }

  private renderTopicFilter() {
    const select = this.toolsEl.querySelector('select.aic-topic') as HTMLSelectElement;
    const topics = new Map<string, number>();
    for (const i of this.curator.items()) if (i.analysis) topics.set(i.analysis.topic, (topics.get(i.analysis.topic) ?? 0) + 1);
    select.empty();
    select.createEl('option', { value: '', text: translate("All topics") });
    for (const [t, n] of [...topics].sort((a, b) => b[1] - a[1])) select.createEl('option', { value: t, text: `${t} (${n})` });
    if (this.topic && !topics.has(this.topic)) this.topic = '';
    select.value = this.topic;
    select.onchange = () => { this.topic = select.value; this.limit = PAGE; this.renderList(); this.renderTabs(); };
    select.toggle(topics.size > 1);
  }

  private matches(i: Item): boolean {
    if (this.topic && i.analysis?.topic !== this.topic) return false;
    if (!this.query) return true;
    const a = i.analysis;
    const hay = [i.title, i.author, i.url, a?.title, a?.tldr, a?.summary, a?.payoff, a?.topic, ...(a?.tags ?? []),
      ...(a?.knowledge ?? []).map((k) => k.point), ...(a?.assets ?? []).map((x) => x.name + ' ' + x.purpose)].join(' ').toLowerCase();
    return hay.includes(this.query);
  }

  private itemsFor(tab: Tab, filtered = true): Item[] {
    const all = this.curator.items().filter((i) => !filtered || this.matches(i));
    const done = all.filter((i) => i.state === 'done' && i.analysis);
    const unread = done.filter((i) => i.status === 'unread');
    const byPriority = (a: Item, b: Item) => priority(b) - priority(a) || (b.analyzedAt ?? 0) - (a.analyzedAt ?? 0);
    switch (tab) {
      case 'focus': return unread.filter((i) => !isTeaser(i) && i.analysis!.verdict !== 'skip' && (i.analysis!.verdict === 'read' || i.analysis!.score >= 50)).sort(byPriority);
      case 'unread': return unread.filter((i) => i.analysis!.verdict !== 'skip').sort((a, b) => Number(isTeaser(a)) - Number(isTeaser(b)) || byPriority(a, b));
      case 'toolbox': return [];
      case 'incomplete': return unread.filter((i) => isTeaser(i) && !(i.analysis!.verdict === 'skip' && ['hype', 'off-topic'].includes(i.analysis!.skip_reason))).sort(byPriority);
      case 'skip': return unread.filter((i) => i.analysis!.verdict === 'skip').sort(readingOrder);
      case 'done': return done.filter((i) => i.status !== 'unread').sort((a, b) => (b.analyzedAt ?? 0) - (a.analyzedAt ?? 0));
      case 'queue': {
        const rank = (i: Item) => ({ analyzing: 0, error: 1, pending: i.held ? 3 : 2, skipped: 4, done: 5 } as const)[i.state];
        return all.filter((i) => i.state !== 'done' && i.skipReason !== 'generated').sort((a, b) => rank(a) - rank(b) || b.mtime - a.mtime);
      }
    }
  }

  /** Every reusable asset in items that are not skipped or archived; copy-ready material first. */
  private toolRows(filtered = true): ToolRow[] {
    const rows: ToolRow[] = [];
    const seen = new Set<string>();
    const items = this.curator.items().filter((i) => i.state === 'done' && i.analysis && i.analysis.verdict !== 'skip' && i.status !== 'archived' && (!filtered || this.matches(i)));
    for (const item of items) {
      for (const asset of item.analysis!.assets) {
        if (VERBATIM_KINDS.has(asset.kind) && !asset.verbatim) continue;
        const key = (asset.url || asset.kind + ':' + asset.name + ':' + asset.content.slice(0, 60)).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const facts = item.repos?.find((f) => asset.url && f.url.toLowerCase() === asset.url.toLowerCase().replace(/\/$/, ''));
        rows.push({ asset, item, stars: facts?.stars });
      }
    }
    const rank = (r: ToolRow) => (VERBATIM_KINDS.has(r.asset.kind) ? 0 : r.asset.kind === 'repo' || r.asset.kind === 'tool' ? 1 : 2);
    return rows.sort((a, b) => rank(a) - rank(b) || (b.item.analysis!.score - a.item.analysis!.score));
  }

  // ───────────────────────────── lists ─────────────────────────────

  private renderList() {
    const el = this.listEl;
    el.empty();
    if (this.tab === 'toolbox') { this.renderToolbox(el); return; }
    const items = this.itemsFor(this.tab);
    if (!items.length) { this.renderEmpty(el); return; }
    if (this.tab === 'incomplete') el.createDiv({ cls: 'aic-lane-hint', text: translate("These verdicts are provisional: only part of the original was saved. Fetch the full text before deciding.") });
    for (const item of items.slice(0, this.limit)) {
      if (this.tab === 'queue') this.renderQueueRow(el, item);
      else this.renderCard(el, item);
    }
    if (items.length > this.limit) {
      const more = el.createEl('button', { cls: 'aic-more', text: translate("Show more ({0})", items.length - this.limit) });
      more.addEventListener('click', () => { this.limit += PAGE; this.renderList(); });
    }
  }

  private renderEmpty(el: HTMLElement) {
    const e = el.createDiv({ cls: 'aic-empty' });
    setIcon(e.createDiv({ cls: 'aic-empty-icon' }), this.tab === 'queue' ? 'check-circle-2' : 'inbox');
    const c = this.curator.counts();
    let text: string;
    if (this.query || this.topic) text = translate("Nothing matches your filter.");
    else if (this.tab === 'queue') text = translate("The queue is empty.");
    else if (!c.done) text = this.plugin.settings.sources.length
      ? translate("Save something with Web Clipper (or any tool that writes Markdown into your folders). It will appear here, curated, within a minute.")
      : translate("Pick the folders where your clippings land, and AI Curator takes it from there.");
    else if (this.tab === 'focus') text = translate("Nothing valuable is waiting. Check All unread or the Toolbox.");
    else if (this.tab === 'toolbox') text = translate("No reusable prompts, code or tools yet. They appear here as items are curated.");
    else text = translate("Nothing here right now.");
    e.createDiv({ cls: 'aic-empty-text', text });
    if (!this.plugin.settings.sources.length) {
      const b = e.createEl('button', { cls: 'mod-cta', text: translate("Set up AI Curator") });
      b.addEventListener('click', () => new SetupModal(this.app, this.plugin).open());
    }
  }

  private async openPath(path: string | undefined, newTab = false) {
    if (!path) return;
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(f);
  }

  private async copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      new Notice(translate("Copied {0}.", what));
    } catch {
      new Notice(translate("Could not copy to the clipboard."));
    }
  }

  /** What the reader gets, at a glance: copy-ready material, repositories, knowledge, steps, weighed claims. */
  private chips(card: HTMLElement, item: Item) {
    const a = item.analysis!;
    const row = card.createDiv({ cls: 'aic-gains' });
    const chip = (icon: string, text: string, tip: string, onClick?: () => void) => {
      const c = row.createEl(onClick ? 'button' : 'span', { cls: 'aic-gain' + (onClick ? ' is-clickable' : '') });
      setIcon(c.createSpan({ cls: 'aic-gain-icon' }), icon);
      c.createSpan({ text });
      setTooltip(c, tip);
      if (onClick) c.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    };
    const verbatim = a.assets.filter((x) => VERBATIM_KINDS.has(x.kind) && x.verbatim && x.content);
    const byKind = new Map<string, Asset[]>();
    for (const x of verbatim) byKind.set(x.kind, [...(byKind.get(x.kind) ?? []), x]);
    for (const [kind, list] of byKind) {
      const label = translate(ASSET_LABEL[kind] ?? kind) + (list.length > 1 ? ` ×${list.length}` : '');
      chip(ASSET_ICON[kind] ?? 'clipboard', label, translate("Copy “{0}”", list[0].name), () => void this.copy(list[0].content, list[0].name));
    }
    const repos = item.repos ?? [];
    for (const f of repos.slice(0, 2)) chip('github', `${f.name.split('/')[1]} ★${formatStars(f.stars)}`, f.description || f.name, () => openExternal(f.url));
    const others = a.assets.filter((x) => !VERBATIM_KINDS.has(x.kind) && !repos.some((f) => x.url && f.url.toLowerCase() === x.url.toLowerCase().replace(/\/$/, '')));
    if (others.length) chip('link', translate("{0} tools and resources", others.length), others.slice(0, 6).map((x) => x.name).join(' · '));
    if (a.knowledge.length) chip('lightbulb', translate("{0} knowledge points", a.knowledge.length), a.knowledge.slice(0, 4).map((k) => k.point).join('\n'));
    if (a.steps.length) chip('list-ordered', translate("{0} steps", a.steps.length), a.steps.slice(0, 3).join('\n'));
    if (a.argument.evidence.length) chip('scale', translate("{0} claims weighed", a.argument.evidence.length), a.argument.thesis);
    if (!row.childElementCount) row.remove();
  }

  private renderCard(el: HTMLElement, item: Item) {
    const a = item.analysis!;
    const teaser = a.completeness === 'teaser';
    const card = el.createDiv({ cls: `aic-card verdict-${a.verdict}` + (item.status !== 'unread' ? ' is-done' : '') + (teaser ? ' is-teaser' : '') });
    const top = card.createDiv({ cls: 'aic-card-top' });
    top.createSpan({ cls: `aic-badge verdict-${a.verdict}`, text: a.verdict === 'skip' && SKIP_REASON[a.skip_reason] ? translate(SKIP_REASON[a.skip_reason]) : translate(VERDICT_LABEL[a.verdict]) });
    top.createSpan({ cls: 'aic-form-chip', text: translate(FORM_LABEL[a.form] ?? a.form) });
    top.createSpan({ cls: 'aic-topic-chip', text: a.topic });
    if (a.completeness !== 'full') {
      const w = top.createSpan({ cls: 'aic-chip is-warn', text: translate(teaser ? 'teaser' : 'partial') });
      setTooltip(w, a.missing || translate("The saved text was incomplete; the analysis covers only what was saved."));
    }
    if (item.stale) {
      const w = top.createSpan({ cls: 'aic-chip is-warn', text: translate("changed") });
      setTooltip(w, translate("The original note changed after it was curated. Use “Curate again” to refresh."));
    }
    const score = top.createSpan({ cls: 'aic-score', text: teaser ? `${a.score}?` : String(a.score) });
    setTooltip(score, translate("Score {0}/100 · relevance {1}, depth {2}, evidence {3}, usability {4}, originality {5} · confidence {6}",
      a.score, a.scores.relevance, a.scores.depth, a.scores.evidence, a.scores.actionability, a.scores.originality, translate(a.confidence)));

    const title = card.createEl('a', { cls: 'aic-card-title', text: a.title, href: '#' });
    title.addEventListener('click', (e) => { e.preventDefault(); void this.openPath(item.notePath ?? item.path, e.ctrlKey || e.metaKey); });
    if (a.payoff) {
      const p = card.createDiv({ cls: 'aic-payoff' });
      p.createSpan({ cls: 'aic-label', text: translate("You get") });
      p.createSpan({ text: a.payoff });
    }
    card.createDiv({ cls: 'aic-tldr', text: a.tldr });
    this.chips(card, item);
    if (a.verdict_reason) {
      const why = card.createDiv({ cls: 'aic-reason' });
      why.createSpan({ cls: 'aic-label', text: translate("Why") });
      why.createSpan({ text: a.verdict_reason });
    }
    if (teaser) {
      const m = card.createDiv({ cls: 'aic-missing' });
      setIcon(m.createSpan({ cls: 'aic-gain-icon' }), 'file-question');
      m.createSpan({ text: a.missing || translate("Only a teaser was saved.") });
    }

    const meta = card.createDiv({ cls: 'aic-meta' });
    const bits = [item.author, host(item.url), item.published].filter(Boolean) as string[];
    meta.setText(bits.join(' · '));

    const actions = card.createDiv({ cls: 'aic-card-actions' });
    const act = (icon: string, label: string, fn: () => void, cls = '') => {
      const b = actions.createEl('button', { cls: 'aic-act ' + cls, attr: { 'aria-label': label } });
      setIcon(b.createSpan(), icon);
      b.createSpan({ text: label });
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    };
    act('file-text', translate("Open notes"), () => void this.openPath(item.notePath ?? item.path));
    if (item.url) act('external-link', translate("Original"), () => openExternal(item.url!));
    if (teaser) {
      if (item.recoverable === 'x' && !this.plugin.settings.expandX) {
        act('download', translate("Fetch full text"), async () => {
          this.plugin.settings.expandX = true;
          await this.plugin.saveSettings();
          this.curator.recurate([item]);
          new Notice(translate("X expansion is on. Curating again with the full text."));
        }, 'is-primary');
      } else act('refresh-cw', translate("Curate again"), () => this.curator.reanalyze(item.path));
    }
    if (item.status === 'unread') {
      act('check', translate("Mark read"), () => void this.curator.setStatus(item.path, 'read'), teaser ? '' : 'is-primary');
      act('archive', translate("Archive"), () => void this.curator.setStatus(item.path, 'archived'));
    } else {
      act('rotate-ccw', translate("Back to unread"), () => void this.curator.setStatus(item.path, 'unread'));
    }
    const more = actions.createEl('button', { cls: 'aic-act clickable-icon', attr: { 'aria-label': translate("More") } });
    setIcon(more, 'more-horizontal');
    more.addEventListener('click', (e) => {
      const menu = new Menu();
      for (const asset of a.assets.filter((x) => VERBATIM_KINDS.has(x.kind) && x.content).slice(0, 5)) {
        menu.addItem((m) => m.setTitle(translate("Copy “{0}”", asset.name)).setIcon('copy').onClick(() => void this.copy(asset.content, asset.name)));
      }
      menu.addItem((m) => m.setTitle(translate("Open saved original note")).setIcon('file').onClick(() => void this.openPath(item.path)));
      menu.addItem((m) => m.setTitle(translate("Curate again")).setIcon('sparkles').onClick(() => this.curator.reanalyze(item.path)));
      menu.showAtMouseEvent(e);
    });
  }

  private renderToolbox(el: HTMLElement) {
    const rows = this.toolRows();
    if (!rows.length) { this.renderEmpty(el); return; }
    const head = el.createDiv({ cls: 'aic-lane-hint' });
    head.createSpan({ text: translate("Reusable material pulled from your saves. Prompts, code and tables are exact copies of the original text.") + ' ' });
    const open = head.createEl('a', { text: translate("Open as a note"), href: '#' });
    open.addEventListener('click', async (e) => { e.preventDefault(); await this.openPath(await this.curator.writeToolbox(), true); });
    for (const { asset, item, stars } of rows.slice(0, this.limit)) {
      const row = el.createDiv({ cls: 'aic-tool-row' });
      setIcon(row.createDiv({ cls: 'aic-tool-icon' }), ASSET_ICON[asset.kind] ?? 'box');
      const body = row.createDiv({ cls: 'aic-tool-body' });
      const name = body.createDiv({ cls: 'aic-tool-name' });
      name.createSpan({ text: asset.name });
      name.createSpan({ cls: 'aic-tool-kind', text: translate(ASSET_LABEL[asset.kind] ?? asset.kind) + (stars !== undefined ? ` · ★${formatStars(stars)}` : '') });
      if (asset.purpose) body.createDiv({ cls: 'aic-tool-purpose', text: asset.purpose });
      if (VERBATIM_KINDS.has(asset.kind)) body.createDiv({ cls: 'aic-tool-preview', text: asset.content.slice(0, 160).replace(/\s+/g, ' ') + (asset.content.length > 160 ? '…' : '') });
      const from = body.createEl('a', { cls: 'aic-tool-from', text: translate("from “{0}”", item.analysis!.title), href: '#' });
      from.addEventListener('click', (e) => { e.preventDefault(); void this.openPath(item.notePath ?? item.path); });
      const actions = row.createDiv({ cls: 'aic-tool-actions' });
      if (VERBATIM_KINDS.has(asset.kind)) {
        const b = actions.createEl('button', { cls: 'mod-cta', text: translate("Copy") });
        b.addEventListener('click', () => void this.copy(asset.content, asset.name));
      }
      if (asset.url) {
        const b = actions.createEl('button', { text: translate("Open") });
        b.addEventListener('click', () => openExternal(asset.url));
      }
    }
    if (rows.length > this.limit) {
      const more = el.createEl('button', { cls: 'aic-more', text: translate("Show more ({0})", rows.length - this.limit) });
      more.addEventListener('click', () => { this.limit += PAGE; this.renderList(); });
    }
  }

  private renderQueueRow(el: HTMLElement, item: Item) {
    const row = el.createDiv({ cls: `aic-row state-${item.state}` });
    const icon = row.createDiv({ cls: 'aic-row-icon' });
    const label = item.state === 'analyzing' ? ['loader', translate("Analyzing")]
      : item.state === 'error' ? ['alert-triangle', translate("Failed")]
      : item.state === 'skipped' ? (item.skipReason === 'duplicate' ? ['copy', translate("Duplicate")] : item.skipReason === 'generated' ? ['bot', translate("Program-written")] : ['circle-slash', translate("No content")])
      : item.held ? ['archive', translate("Backlog")]
      : (item.nextAttemptAt ?? 0) > Date.now() ? ['clock', translate("Retrying soon")] : ['clock', translate("Waiting")];
    setIcon(icon, label[0]);
    const body = row.createDiv({ cls: 'aic-row-body' });
    const title = body.createEl('a', { cls: 'aic-row-title', text: item.title, href: '#' });
    title.addEventListener('click', (e) => { e.preventDefault(); void this.openPath(item.path); });
    const detail = item.state === 'error' || (item.state === 'pending' && item.error) ? item.error
      : item.skipReason === 'duplicate' ? translate("Same source as “{0}”", this.curator.get(item.dedupeOf ?? '')?.analysis?.title ?? item.dedupeOf)
      : item.skipReason === 'empty' ? translate("The note has no text to analyze (only a link, image or embed).")
      : item.skipReason === 'generated' ? translate("Written by a program about another note (for example a placeholder), so it is not analyzed.")
      : item.path;
    body.createDiv({ cls: 'aic-row-detail', text: `${label[1]} · ${detail ?? ''}` });
    const actions = row.createDiv({ cls: 'aic-row-actions' });
    if (item.state !== 'analyzing' && item.skipReason !== 'generated') {
      const b = actions.createEl('button', { text: item.state === 'pending' && !item.held ? translate("Now") : translate("Curate") });
      setTooltip(b, item.state === 'skipped' ? translate("Analyze anyway") : translate("Analyze this item now"));
      b.addEventListener('click', () => this.curator.reanalyze(item.path));
    }
  }
}
