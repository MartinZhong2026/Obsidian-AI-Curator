import { type App, Modal, Notice, Setting, TFile, TFolder, setIcon } from 'obsidian';
import type AICuratorPlugin from './main.ts';
import { PRESETS, preset } from './providers.ts';
import { defaultProviderSettings, isInFolder, normalizeFolder } from './settings.ts';
import { FolderSuggest, money } from './ui.ts';
import { openExternal } from './support.ts';

interface Candidate { path: string; count: number; hint: string }

const WEB_CLIPPER = 'https://obsidian.md/clipper';

/** Find folders that look like clipping/bookmark inboxes: many notes with a source URL. */
export function detectSources(app: App, output: string): Candidate[] {
  const byFolder = new Map<string, { count: number; x: number }>();
  for (const file of app.vault.getMarkdownFiles()) {
    if (isInFolder(file.path, output)) continue;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) continue;
    const url = [fm.source, fm.url, fm.link, fm.original_url].find((v) => typeof v === 'string' && /^https?:\/\//.test(v)) as string | undefined;
    if (!url) continue;
    const folder = file.parent?.path ?? '';
    if (!folder || folder === '/') continue;
    const entry = byFolder.get(folder) ?? { count: 0, x: 0 };
    entry.count++;
    if (/^https?:\/\/(www\.)?(x|twitter)\.com\//.test(url)) entry.x++;
    byFolder.set(folder, entry);
  }
  const out: Candidate[] = [...byFolder]
    .filter(([, e]) => e.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6)
    .map(([path, e]) => ({
      path, count: e.count,
      hint: e.x > e.count / 2 ? 'Looks like X bookmarks' : path.toLowerCase().includes('clipping') ? 'Looks like Web Clipper' : 'Notes with source links',
    }));
  const clippings = app.vault.getAbstractFileByPath('Clippings');
  if (clippings instanceof TFolder && !out.some((c) => c.path === 'Clippings')) {
    out.unshift({ path: 'Clippings', count: clippings.children.filter((f) => f instanceof TFile).length, hint: 'Web Clipper’s default folder' });
  }
  return out;
}

export class SetupModal extends Modal {
  private step = 0;
  private chosen = new Set<string>();
  private candidates: Candidate[] = [];
  private backlog: 'ten' | 'all' | 'none' = 'ten';
  private keyDraft = '';
  private testResult = '';

  private plugin: AICuratorPlugin;

  constructor(app: App, plugin: AICuratorPlugin) {
    super(app);
    this.plugin = plugin;
    this.modalEl.addClass('ai-curator-setup');
  }

  onOpen() {
    this.candidates = detectSources(this.app, this.plugin.settings.outputFolder);
    for (const s of this.plugin.settings.sources) this.chosen.add(s);
    if (!this.chosen.size && this.candidates[0]) this.chosen.add(this.candidates[0].path);
    this.render();
  }

  onClose() {
    this.contentEl.empty();
    this.plugin.curator.refreshState();
  }

  private get s() { return this.plugin.settings; }

  private steps = [
    { title: 'Where do your saves land?', render: (el: HTMLElement) => this.renderSources(el) },
    { title: 'Connect an AI model', render: (el: HTMLElement) => this.renderProvider(el) },
    { title: 'Make it yours', render: (el: HTMLElement) => this.renderPersonal(el) },
    { title: 'Your existing saves', render: (el: HTMLElement) => this.renderBacklog(el) },
  ];

  private render() {
    const el = this.contentEl;
    el.empty();
    const head = el.createDiv({ cls: 'aic-setup-head' });
    setIcon(head.createDiv({ cls: 'aic-setup-logo' }), 'sparkles');
    const h = head.createDiv();
    h.createDiv({ cls: 'aic-setup-kicker', text: `AI Curator · step ${this.step + 1} of ${this.steps.length}` });
    h.createEl('h2', { text: this.steps[this.step].title });
    const dots = el.createDiv({ cls: 'aic-setup-dots' });
    this.steps.forEach((_, i) => dots.createSpan({ cls: 'aic-dot' + (i <= this.step ? ' is-done' : '') }));
    const body = el.createDiv({ cls: 'aic-setup-body' });
    this.steps[this.step].render(body);
    const nav = el.createDiv({ cls: 'aic-setup-nav' });
    if (this.step > 0) nav.createEl('button', { text: 'Back' }).addEventListener('click', () => { this.step--; this.render(); });
    else nav.createEl('button', { text: 'Later' }).addEventListener('click', () => this.close());
    const last = this.step === this.steps.length - 1;
    const next = nav.createEl('button', { cls: 'mod-cta', text: last ? 'Start curating' : 'Continue' });
    next.addEventListener('click', () => { void this.next(); });
  }

  private async next() {
    if (this.step === 0) {
      if (!this.chosen.size) { new Notice('Pick at least one folder.'); return; }
      this.s.sources = [...this.chosen];
      await this.plugin.saveSettings();
      this.plugin.curator.scan();
    }
    if (this.step === 1) {
      if (this.keyDraft.trim()) { await this.plugin.setApiKey(this.keyDraft); this.keyDraft = ''; }
      if (preset(this.s.provider).needsKey && !this.plugin.apiKey()) {
        new Notice('Add an API key to continue, or choose a local model.');
        return;
      }
    }
    if (this.step === this.steps.length - 1) {
      this.s.onboarded = true;
      await this.plugin.saveSettings();
      if (this.backlog === 'ten') this.plugin.curator.releaseBacklog(10);
      else if (this.backlog === 'all') this.plugin.curator.releaseBacklog();
      this.plugin.curator.kick(true);
      this.close();
      await this.plugin.activateView();
      return;
    }
    this.step++;
    this.render();
  }

  private renderSources(el: HTMLElement) {
    el.createEl('p', { text: 'Choose the folders where clipped articles and bookmarks arrive. AI Curator only reads these folders and never edits the notes in them.' });
    const list = el.createDiv({ cls: 'aic-choices' });
    const all = [...this.candidates];
    for (const path of this.chosen) if (!all.some((c) => c.path === path)) all.push({ path, count: 0, hint: 'Chosen by you' });
    for (const c of all) {
      const row = list.createEl('label', { cls: 'aic-choice' });
      const box = row.createEl('input', { attr: { type: 'checkbox' } });
      box.checked = this.chosen.has(c.path);
      box.addEventListener('change', () => { if (box.checked) this.chosen.add(c.path); else this.chosen.delete(c.path); });
      const text = row.createDiv();
      text.createDiv({ cls: 'aic-choice-title', text: c.path });
      text.createDiv({ cls: 'aic-choice-hint', text: `${c.hint}${c.count ? ` · ${c.count} notes` : ''}` });
    }
    if (!all.length) {
      el.createEl('p', { cls: 'aic-muted', text: 'No clipping folder found yet. The free Obsidian Web Clipper saves to “Clippings” by default.' });
    }
    let draft = '';
    new Setting(el)
      .setName('Another folder')
      .addSearch((s) => { s.setPlaceholder('Search folders'); s.onChange((v) => { draft = v; }); new FolderSuggest(this.app, s.inputEl, (p) => { draft = p; }); })
      .addButton((b) => b.setButtonText('Add').onClick(() => {
        const f = normalizeFolder(draft);
        if (f && !isInFolder(f, this.s.outputFolder)) { this.chosen.add(f); this.render(); }
      }));
    if (!(this.app.vault.getAbstractFileByPath('Clippings') instanceof TFolder)) {
      new Setting(el)
        .setName('Starting fresh?')
        .setDesc('Create a “Clippings” folder for Obsidian Web Clipper and curate it.')
        .addButton((b) => b.setButtonText('Create Clippings').onClick(async () => {
          await this.app.vault.createFolder('Clippings').catch(() => {});
          this.chosen.add('Clippings');
          this.candidates = detectSources(this.app, this.s.outputFolder);
          this.render();
        }))
        .addExtraButton((b) => b.setIcon('external-link').setTooltip('Get Web Clipper').onClick(() => openExternal(WEB_CLIPPER)));
    }
  }

  private renderProvider(el: HTMLElement) {
    const p = preset(this.s.provider);
    el.createEl('p', { text: 'AI Curator sends the text of each saved item to the AI provider you choose, and nothing else. DeepSeek is a good default: about $0.002 per article.' });
    new Setting(el).setName('Provider').addDropdown((d) => {
      for (const option of PRESETS) d.addOption(option.id, option.name);
      d.setValue(this.s.provider).onChange(async (v) => {
        this.s.provider = v;
        this.s.providers[v] ??= defaultProviderSettings(v);
        this.testResult = '';
        await this.plugin.saveSettings();
        this.render();
      });
    });
    const ps = this.plugin.providerSettings();
    if (!p.models.length || p.local || p.id === 'custom') {
      if (p.local || p.id === 'custom') {
        new Setting(el).setName('API address').addText((t) => t.setValue(ps.baseUrl).setPlaceholder('http://localhost:11434/v1').onChange(async (v) => { ps.baseUrl = v.trim(); await this.plugin.saveSettings(); }));
      }
      new Setting(el).setName('Model').setDesc('For example gpt-5-mini, gemini-flash or qwen3:14b.').addText((t) => t.setValue(ps.model).onChange(async (v) => { ps.model = v.trim(); await this.plugin.saveSettings(); }));
    }
    if (p.needsKey || p.id === 'custom') {
      const has = !!this.plugin.apiKey();
      new Setting(el)
        .setName('API key')
        .setDesc(createFragment((f) => {
          f.appendText(has ? 'A key is saved. Paste a new one to replace it. ' : 'Kept in Obsidian’s secure storage, never in your notes. ');
          if (p.keyUrl) { const a = f.createEl('a', { text: `Get a ${p.name.split(' ')[0]} key`, href: p.keyUrl }); a.addEventListener('click', (e) => { e.preventDefault(); openExternal(p.keyUrl!); }); }
        }))
        .addText((t) => { t.inputEl.type = 'password'; t.inputEl.autocomplete = 'off'; t.setPlaceholder(has ? '••••••••' : 'sk-…').onChange((v) => { this.keyDraft = v; }); });
    }
    const test = new Setting(el).setName('Check it works').setDesc(this.testResult || 'Sends a one-word test request.');
    test.addButton((b) => b.setButtonText('Test').onClick(async () => {
      if (this.keyDraft.trim()) { await this.plugin.setApiKey(this.keyDraft); this.keyDraft = ''; }
      b.setDisabled(true).setButtonText('Testing…');
      const r = await this.plugin.testConnection();
      this.testResult = (r.ok ? '✓ ' : '✗ ') + r.message;
      this.render();
    }));
    if (p.kind === 'anthropic') el.createEl('p', { cls: 'aic-muted', text: 'Claude works great if the API is available in your region. Requests go directly from Obsidian to Anthropic.' });
  }

  private renderPersonal(el: HTMLElement) {
    el.createEl('p', { text: 'Optional, but it makes the recommendations much better: tell the curator what you care about.' });
    new Setting(el).setName('Language of curated notes').addDropdown((d) => d
      .addOption('auto', 'Same as Obsidian').addOption('en', 'English').addOption('zh', '简体中文')
      .setValue(this.s.language).onChange(async (v) => { this.s.language = v as typeof this.s.language; await this.plugin.saveSettings(); }));
    const area = new Setting(el).setName('About you').setDesc('Your work, goals and interests. Sent with each item to judge relevance.');
    area.addTextArea((t) => {
      t.setPlaceholder('e.g. Product manager learning AI engineering. I want practical tutorials, not news.');
      t.setValue(this.s.profile).onChange(async (v) => { this.s.profile = v.slice(0, 2000); await this.plugin.saveSettings(); });
      t.inputEl.rows = 4;
      t.inputEl.addClass('ai-curator-wide');
    });
    area.settingEl.addClass('aic-stacked');
    const xLike = this.candidates.some((c) => this.chosen.has(c.path) && c.hint.includes('X'));
    new Setting(el)
      .setName('Expand cut-off X posts')
      .setDesc('Reads long X posts and X Articles through the public FxTwitter API, which receives the post ID.')
      .addToggle((t) => t.setValue(this.s.expandX || xLike).onChange(async (v) => { this.s.expandX = v; await this.plugin.saveSettings(); }));
    if (xLike && !this.s.expandX) { this.s.expandX = true; void this.plugin.saveSettings(); }
  }

  private renderBacklog(el: HTMLElement) {
    const est = this.plugin.curator.backlogEstimate();
    if (!est.count) {
      el.createEl('p', { text: 'All set. From now on, everything you save into your folders is curated automatically, usually within a minute.' });
      el.createEl('p', { cls: 'aic-muted', text: `Monthly budget: ${money(this.s.monthlyBudget)} (change it in settings).` });
      this.backlog = 'none';
      return;
    }
    const per = est.cost != null ? est.cost / est.count : null;
    el.createEl('p', { text: `You already have ${est.count} saved notes in these folders. New saves are always curated automatically. What about these?` });
    const opts: { id: 'ten' | 'all' | 'none'; title: string; hint: string }[] = [
      { id: 'ten', title: 'Start with the newest 10', hint: `See the results first${per != null ? ` · about ${money(per * Math.min(10, est.count))}` : ''}. Curate the rest later from the inbox.` },
      { id: 'all', title: `Curate all ${est.count}`, hint: est.cost != null ? `About ${money(est.cost)} in total; runs in the background.` : 'Runs in the background.' },
      { id: 'none', title: 'Only new saves', hint: 'Leave existing notes alone. You can start them any time from the inbox.' },
    ];
    if (est.count <= 10) opts.splice(0, 1);
    if (!opts.some((o) => o.id === this.backlog)) this.backlog = opts[0].id;
    const list = el.createDiv({ cls: 'aic-choices' });
    for (const o of opts) {
      const row = list.createEl('label', { cls: 'aic-choice' });
      const radio = row.createEl('input', { attr: { type: 'radio', name: 'aic-backlog' } });
      radio.checked = this.backlog === o.id;
      radio.addEventListener('change', () => { this.backlog = o.id; });
      const text = row.createDiv();
      text.createDiv({ cls: 'aic-choice-title', text: o.title });
      text.createDiv({ cls: 'aic-choice-hint', text: o.hint });
    }
    el.createEl('p', { cls: 'aic-muted', text: `Spending is capped at ${money(this.s.monthlyBudget)} per month and ${this.s.dailyLimit} items per day. Costs are estimates; your provider’s bill is authoritative.` });
  }
}
