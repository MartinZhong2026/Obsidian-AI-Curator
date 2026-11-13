import { ItemView, Menu, TFile, type WorkspaceLeaf, debounce, setIcon, setTooltip } from 'obsidian';
import type AICuratorPlugin from './main.ts';
import type { Item, Verdict } from './types.ts';
import { readingOrder } from './queue.ts';
import { money } from './ui.ts';
import { SetupModal } from './onboarding.ts';
import { openExternal } from './support.ts';

export const VIEW_TYPE = 'ai-curator-inbox';

type Tab = 'next' | 'unread' | 'reference' | 'skim' | 'skip' | 'done' | 'queue';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'next', label: 'Read next', hint: 'Unread items worth reading in full' },
  { id: 'unread', label: 'Unread', hint: 'Everything unread except skips' },
  { id: 'reference', label: 'Reference', hint: 'Keep for lookup: docs, lists, tools' },
  { id: 'skim', label: 'Skim', hint: 'The curated note captures most of the value' },
  { id: 'skip', label: 'Skip', hint: 'Low value, hype or outdated' },
  { id: 'done', label: 'Done', hint: 'Read or archived' },
  { id: 'queue', label: 'Queue', hint: 'Waiting, failed or skipped items' },
];

const VERDICT_LABEL: Record<Verdict, string> = { read: 'Read', skim: 'Skim', reference: 'Reference', skip: 'Skip' };
const PAGE = 60;

function host(url?: string): string {
  if (!url) return '';
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
}

export class CuratorView extends ItemView {
  private tab: Tab = 'next';
  private query = '';
  private topic = '';
  private limit = PAGE;
  private off: (() => void) | null = null;
  private listEl!: HTMLElement;
  private headerEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private tabsEl!: HTMLElement;
  private toolsEl!: HTMLElement;
  private refresh = debounce(() => this.render(), 250, true);

  private plugin: AICuratorPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: AICuratorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Reading inbox'; }
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
    this.off = this.plugin.onChange(() => this.refresh());
    // Pick the most useful starting tab.
    const c = this.plugin.curator.counts();
    if (!c.read && c.unread) this.tab = 'unread';
    if (!c.done && (c.pending || c.held || c.errors)) this.tab = 'queue';
    this.render();
  }

  async onClose() { this.off?.(); }

  private get curator() { return this.plugin.curator; }

  private render() {
    this.renderHeader();
    this.renderBanners();
    this.renderTabs();
    this.renderTopicFilter();
    this.renderList();
  }

  private renderHeader() {
    const el = this.headerEl;
    el.empty();
    const titleRow = el.createDiv({ cls: 'aic-title-row' });
    const t = titleRow.createDiv({ cls: 'aic-title' });
    t.createEl('h2', { text: 'Reading inbox' });
    t.createDiv({ cls: 'aic-subtitle', text: this.stateLine() });
    const actions = titleRow.createDiv({ cls: 'aic-header-actions' });
    const button = (icon: string, label: string, onClick: () => void) => {
      const b = actions.createEl('button', { cls: 'clickable-icon aic-icon-btn', attr: { 'aria-label': label } });
      setIcon(b, icon);
      b.addEventListener('click', onClick);
      return b;
    };
    button('refresh-cw', 'Scan and process now', () => { this.curator.scan(); this.curator.kick(true); });
    const paused = this.plugin.settings.paused;
    button(paused ? 'play' : 'pause', paused ? 'Resume curation' : 'Pause curation', () => { void this.plugin.pause(!paused); });
    button('newspaper', 'Create weekly digest', async () => {
      const path = await this.curator.writeDigest(7);
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(f);
    });
    button('settings', 'Settings', () => {
      const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
      setting?.open();
      setting?.openTabById(this.plugin.manifest.id);
    });

    const c = this.curator.counts();
    const stats = el.createDiv({ cls: 'aic-stats' });
    const stat = (value: number | string, label: string, cls = '') => {
      const s = stats.createDiv({ cls: 'aic-stat ' + cls });
      s.createDiv({ cls: 'aic-stat-value', text: String(value) });
      s.createDiv({ cls: 'aic-stat-label', text: label });
    };
    const readNext = this.curator.items().filter((i) => i.state === 'done' && i.status === 'unread' && i.analysis?.verdict === 'read').length;
    stat(readNext, 'worth reading', 'is-accent');
    stat(c.unread, 'unread');
    stat(c.done, 'curated');
    stat(c.pending + c.analyzing, 'in queue');
    const u = this.curator.usage();
    stat(money(u.cost), 'this month');
  }

  private stateLine(): string {
    const st = this.curator.state;
    const c = this.curator.counts();
    switch (st.kind) {
      case 'working': return `Curating “${st.current}”…`;
      case 'paused': return 'Paused';
      case 'needs-setup': return 'Setup needed';
      case 'limit': return st.reason === 'daily' ? 'Daily limit reached; continues tomorrow' : 'Monthly budget reached';
      default:
        if (c.pending) return `${c.pending} waiting (new saves settle for a few seconds first)`;
        return c.done ? 'All caught up' : 'Waiting for your first saves';
    }
  }

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
      const text = st.reason === 'sources' ? 'Choose which folders to curate.'
        : st.reason === 'key' ? 'Add your AI provider’s API key to start curating.'
        : 'Choose an AI model to start curating.';
      this.banner('info', 'wand-2', text, [['Open setup', () => new SetupModal(this.app, this.plugin).open(), true]]);
    }
    if (s.paused) {
      this.banner(s.pauseReason && s.pauseReason !== 'Paused by you.' ? 'error' : 'warn', 'pause-circle',
        s.pauseReason && s.pauseReason !== 'Paused by you.' ? `Paused: ${s.pauseReason}` : 'Curation is paused.',
        [['Resume', () => { void this.plugin.pause(false); }, true]]);
    }
    if (st.kind === 'limit') {
      this.banner('warn', 'wallet', st.reason === 'daily'
        ? `Daily limit of ${s.dailyLimit} items reached. Curation continues tomorrow.`
        : `Monthly budget of ${money(s.monthlyBudget)} reached. Raise it in settings to continue.`, []);
    }
    const held = this.curator.heldItems();
    if (held.length) {
      const est = this.curator.backlogEstimate();
      const cost = est.cost == null ? '' : ` Curating all costs about ${money(est.cost)}.`;
      const actions: [string, () => void, boolean?][] = [];
      if (held.length > 10) actions.push(['Newest 10', () => this.curator.releaseBacklog(10), true]);
      actions.push([`All ${held.length}`, () => this.curator.releaseBacklog(), held.length <= 10]);
      this.banner('info', 'archive', `${held.length} notes were already in your folders before AI Curator. New saves are curated automatically; choose what to do with these.${cost}`, actions);
    }
    const errors = this.curator.counts().errors;
    if (errors) this.banner('error', 'alert-triangle', `${errors} item${errors > 1 ? 's' : ''} failed.`, [['Retry', () => this.curator.retryErrors()], ['Show', () => { this.tab = 'queue'; this.render(); }]]);
  }

  private tabCount(tab: Tab): number { return this.itemsFor(tab, false).length; }

  private renderTabs() {
    this.tabsEl.empty();
    for (const t of TABS) {
      const n = this.tabCount(t.id);
      const el = this.tabsEl.createEl('button', { cls: 'aic-tab' + (this.tab === t.id ? ' is-active' : ''), attr: { role: 'tab', 'aria-selected': String(this.tab === t.id) } });
      el.createSpan({ text: t.label });
      if (n) el.createSpan({ cls: 'aic-tab-count', text: String(n) });
      setTooltip(el, t.hint);
      el.addEventListener('click', () => { this.tab = t.id; this.limit = PAGE; this.render(); });
    }
  }

  private buildTools() {
    const search = this.toolsEl.createEl('input', { cls: 'aic-search', attr: { type: 'search', placeholder: 'Search titles, summaries, tags…', 'aria-label': 'Search' } });
    search.addEventListener('input', debounce(() => { this.query = search.value.trim().toLowerCase(); this.limit = PAGE; this.renderList(); this.renderTabs(); }, 200, true));
    this.toolsEl.createEl('select', { cls: 'dropdown aic-topic', attr: { 'aria-label': 'Filter by topic' } });
  }

  private renderTopicFilter() {
    const select = this.toolsEl.querySelector('select.aic-topic') as HTMLSelectElement;
    const topics = new Map<string, number>();
    for (const i of this.curator.items()) if (i.analysis) topics.set(i.analysis.topic, (topics.get(i.analysis.topic) ?? 0) + 1);
    select.empty();
    select.createEl('option', { value: '', text: 'All topics' });
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
    const hay = [i.title, i.author, i.url, a?.title, a?.tldr, a?.summary, a?.topic, ...(a?.tags ?? [])].join(' ').toLowerCase();
    return hay.includes(this.query);
  }

  private itemsFor(tab: Tab, filtered = true): Item[] {
    const all = this.curator.items().filter((i) => !filtered || this.matches(i));
    const done = all.filter((i) => i.state === 'done' && i.analysis);
    switch (tab) {
      case 'next': return done.filter((i) => i.status === 'unread' && i.analysis!.verdict === 'read').sort(readingOrder);
      case 'unread': return done.filter((i) => i.status === 'unread' && i.analysis!.verdict !== 'skip').sort(readingOrder);
      case 'reference': return done.filter((i) => i.status === 'unread' && i.analysis!.verdict === 'reference').sort(readingOrder);
      case 'skim': return done.filter((i) => i.status === 'unread' && i.analysis!.verdict === 'skim').sort(readingOrder);
      case 'skip': return done.filter((i) => i.status === 'unread' && i.analysis!.verdict === 'skip').sort(readingOrder);
      case 'done': return done.filter((i) => i.status !== 'unread').sort((a, b) => (b.analyzedAt ?? 0) - (a.analyzedAt ?? 0));
      case 'queue': {
        const rank = (i: Item) => ({ analyzing: 0, error: 1, pending: i.held ? 3 : 2, skipped: 4, done: 5 } as const)[i.state];
        return all.filter((i) => i.state !== 'done').sort((a, b) => rank(a) - rank(b) || b.mtime - a.mtime);
      }
    }
  }

  private renderList() {
    const el = this.listEl;
    el.empty();
    const items = this.itemsFor(this.tab);
    if (!items.length) { this.renderEmpty(el); return; }
    for (const item of items.slice(0, this.limit)) {
      if (this.tab === 'queue') this.renderQueueRow(el, item);
      else this.renderCard(el, item);
    }
    if (items.length > this.limit) {
      const more = el.createEl('button', { cls: 'aic-more', text: `Show more (${items.length - this.limit})` });
      more.addEventListener('click', () => { this.limit += PAGE; this.renderList(); });
    }
  }

  private renderEmpty(el: HTMLElement) {
    const e = el.createDiv({ cls: 'aic-empty' });
    setIcon(e.createDiv({ cls: 'aic-empty-icon' }), this.tab === 'queue' ? 'check-circle-2' : 'inbox');
    const c = this.curator.counts();
    let text: string;
    if (this.query || this.topic) text = 'Nothing matches your filter.';
    else if (this.tab === 'queue') text = 'The queue is empty.';
    else if (!c.done) text = this.plugin.settings.sources.length
      ? 'Save something with Web Clipper (or any tool that writes Markdown into your folders). It will appear here, curated, within a minute.'
      : 'Pick the folders where your clippings land, and AI Curator takes it from there.';
    else if (this.tab === 'next') text = 'Nothing marked “worth reading” is waiting. Check Unread or Reference.';
    else text = 'Nothing here right now.';
    e.createDiv({ cls: 'aic-empty-text', text });
    if (!this.plugin.settings.sources.length) {
      const b = e.createEl('button', { cls: 'mod-cta', text: 'Set up AI Curator' });
      b.addEventListener('click', () => new SetupModal(this.app, this.plugin).open());
    }
  }

  private async openPath(path: string | undefined, newTab = false) {
    if (!path) return;
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(f);
  }

  private renderCard(el: HTMLElement, item: Item) {
    const a = item.analysis!;
    const card = el.createDiv({ cls: `aic-card verdict-${a.verdict}` + (item.status !== 'unread' ? ' is-done' : '') });
    const top = card.createDiv({ cls: 'aic-card-top' });
    top.createSpan({ cls: `aic-badge verdict-${a.verdict}`, text: VERDICT_LABEL[a.verdict] });
    const score = top.createSpan({ cls: 'aic-score', text: String(a.score) });
    setTooltip(score, `Score ${a.score}/100 · relevance ${a.scores.relevance}, depth ${a.scores.depth}, evidence ${a.scores.evidence}, actionability ${a.scores.actionability}, originality ${a.scores.originality}`);
    top.createSpan({ cls: 'aic-topic-chip', text: a.topic });
    if (a.completeness !== 'full') {
      const w = top.createSpan({ cls: 'aic-chip is-warn', text: a.completeness === 'teaser' ? 'teaser' : 'partial' });
      setTooltip(w, 'The saved text was incomplete; the analysis covers only what was saved.');
    }
    if (item.stale) {
      const w = top.createSpan({ cls: 'aic-chip is-warn', text: 'changed' });
      setTooltip(w, 'The original note changed after it was curated. Use “Curate again” to refresh.');
    }

    const title = card.createEl('a', { cls: 'aic-card-title', text: a.title, href: '#' });
    title.addEventListener('click', (e) => { e.preventDefault(); void this.openPath(item.notePath ?? item.path, e.ctrlKey || e.metaKey); });
    card.createDiv({ cls: 'aic-tldr', text: a.tldr });
    if (a.verdict_reason) card.createDiv({ cls: 'aic-reason', text: a.verdict_reason });

    const meta = card.createDiv({ cls: 'aic-meta' });
    const bits = [item.author, host(item.url), item.published].filter(Boolean) as string[];
    meta.setText(bits.join(' · '));
    if (a.tags.length) {
      const tags = card.createDiv({ cls: 'aic-tags' });
      for (const t of a.tags.slice(0, 5)) tags.createSpan({ cls: 'aic-tag', text: '#' + t });
    }

    const actions = card.createDiv({ cls: 'aic-card-actions' });
    const act = (icon: string, label: string, fn: () => void, cls = '') => {
      const b = actions.createEl('button', { cls: 'aic-act ' + cls, attr: { 'aria-label': label } });
      setIcon(b.createSpan(), icon);
      b.createSpan({ text: label });
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    };
    act('file-text', 'Open notes', () => void this.openPath(item.notePath ?? item.path));
    if (item.url) act('external-link', 'Original', () => openExternal(item.url!));
    if (item.status === 'unread') {
      act('check', 'Mark read', () => void this.curator.setStatus(item.path, 'read'), 'is-primary');
      act('archive', 'Archive', () => void this.curator.setStatus(item.path, 'archived'));
    } else {
      act('rotate-ccw', 'Back to unread', () => void this.curator.setStatus(item.path, 'unread'));
    }
    const more = actions.createEl('button', { cls: 'aic-act clickable-icon', attr: { 'aria-label': 'More' } });
    setIcon(more, 'more-horizontal');
    more.addEventListener('click', (e) => {
      const menu = new Menu();
      menu.addItem((m) => m.setTitle('Open saved original note').setIcon('file').onClick(() => void this.openPath(item.path)));
      menu.addItem((m) => m.setTitle('Curate again').setIcon('sparkles').onClick(() => this.curator.reanalyze(item.path)));
      menu.showAtMouseEvent(e);
    });
  }

  private renderQueueRow(el: HTMLElement, item: Item) {
    const row = el.createDiv({ cls: `aic-row state-${item.state}` });
    const icon = row.createDiv({ cls: 'aic-row-icon' });
    const label = item.state === 'analyzing' ? ['loader', 'Analyzing']
      : item.state === 'error' ? ['alert-triangle', 'Failed']
      : item.state === 'skipped' ? (item.skipReason === 'duplicate' ? ['copy', 'Duplicate'] : ['circle-slash', 'No content'])
      : item.held ? ['archive', 'Backlog']
      : (item.nextAttemptAt ?? 0) > Date.now() ? ['clock', 'Retrying soon'] : ['clock', 'Waiting'];
    setIcon(icon, label[0]);
    const body = row.createDiv({ cls: 'aic-row-body' });
    const title = body.createEl('a', { cls: 'aic-row-title', text: item.title, href: '#' });
    title.addEventListener('click', (e) => { e.preventDefault(); void this.openPath(item.path); });
    const detail = item.state === 'error' || (item.state === 'pending' && item.error) ? item.error
      : item.skipReason === 'duplicate' ? `Same source as “${this.curator.get(item.dedupeOf ?? '')?.analysis?.title ?? item.dedupeOf}”`
      : item.skipReason === 'empty' ? 'The note has no text to analyze (only a link, image or embed).'
      : item.path;
    body.createDiv({ cls: 'aic-row-detail', text: `${label[1]} · ${detail ?? ''}` });
    const actions = row.createDiv({ cls: 'aic-row-actions' });
    if (item.state !== 'analyzing') {
      const b = actions.createEl('button', { text: item.state === 'pending' && !item.held ? 'Now' : 'Curate' });
      setTooltip(b, item.state === 'skipped' ? 'Analyze anyway' : 'Analyze this item now');
      b.addEventListener('click', () => this.curator.reanalyze(item.path));
    }
  }
}
