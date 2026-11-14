import { translate, setUiLanguage } from './i18n.ts';
import { Notice, Plugin, TFile, TFolder, type TAbstractFile, getLanguage, normalizePath } from 'obsidian';
import { Curator } from './curator.ts';
import type { OutputLanguage } from './analysis.ts';
import { ObsidianVault, parseHtml, transport, vaultFile } from './platform.ts';
import { chat, listModels, preset } from './providers.ts';
import { type CuratorSettings, type ProviderSettings, isInFolder, migrateSettings } from './settings.ts';
import { CuratorSettingTab } from './settings-tab.ts';
import { showStarInvite } from './support.ts';
import { CuratorView, VIEW_TYPE } from './view.ts';
import { SetupModal } from './onboarding.ts';
import type { IndexData } from './types.ts';
import { IndexStore } from './index-store.ts';

const INDEX_FILE = 'index.json';

export default class AICuratorPlugin extends Plugin {
  declare settings: CuratorSettings;
  curator!: Curator;
  private statusEl!: HTMLElement;
  private saveIndexTimer: number | null = null;
  private indexStore!: IndexStore;
  private listeners = new Set<() => void>();

  async onload() {
    this.settings = migrateSettings(await this.loadData());
    this.configureLanguage();
    const vault = new ObsidianVault(this.app);
    this.indexStore = new IndexStore(this.app.vault.adapter, normalizePath(this.manifest.dir + '/' + INDEX_FILE));
    this.curator = new Curator({
      vault,
      transport,
      parseHtml,
      settings: () => this.settings,
      apiKey: () => this.apiKey(),
      language: () => this.language(),
      persist: () => this.scheduleIndexSave(),
      saveSettings: () => { void this.saveSettings(); },
      changed: () => this.emitChange(),
      firstSuccess: (item) => this.onFirstSuccess(item.analysis?.title ?? item.title),
      notify: (message) => new Notice(message, 10000),
    }, await this.loadIndex());

    this.registerView(VIEW_TYPE, (leaf) => new CuratorView(leaf, this));
    this.addSettingTab(new CuratorSettingTab(this.app, this));
    this.addRibbonIcon('sparkles', translate("AI Curator: reading inbox"), () => { void this.activateView(); });
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass('mod-clickable', 'ai-curator-status');
    this.statusEl.addEventListener('click', () => { void this.activateView(); });
    this.onChange(() => this.updateStatusBar());
    this.registerCommands();

    this.app.workspace.onLayoutReady(() => {
      // Register vault events only now: Obsidian fires "create" for every file while indexing.
      this.registerEvent(this.app.vault.on('create', (f) => this.withFile(f, (file) => {
        this.curator.onCreate(vaultFile(file));
        this.kickAfterSettle();
      })));
      this.registerEvent(this.app.vault.on('modify', (f) => this.withFile(f, (file) => this.curator.onModify(vaultFile(file)))));
      this.registerEvent(this.app.vault.on('delete', (f) => this.curator.onDelete(f.path)));
      this.registerEvent(this.app.vault.on('rename', (f, oldPath) => {
        if (f instanceof TFolder) {
          const move = (path: string) => isInFolder(path, oldPath) ? f.path + path.slice(oldPath.length) : path;
          this.settings.sources = this.settings.sources.map(move);
          this.settings.outputFolder = move(this.settings.outputFolder);
          this.curator.onRenameFolder(oldPath, f.path);
          void this.saveSettings();
          this.curator.kick();
        } else this.withFile(f, (file) => this.curator.onRename(vaultFile(file), oldPath));
      }));
      this.curator.scan();
      this.curator.kick();
      this.registerInterval(window.setInterval(() => this.curator.kick(), 60_000));
      if (!this.settings.onboarded) new SetupModal(this.app, this).open();
    });
  }

  onunload() {
    this.curator?.stop();
    void this.flushIndex();
  }

  // ───────────── persistence ─────────────

  private async loadIndex(): Promise<IndexData | null> {
    const result = await this.indexStore.load();
    if (result.recovered) new Notice(translate("AI Curator recovered its index from a local backup."), 8000);
    else if (result.damaged) new Notice(translate("AI Curator could not recover its index. Existing source notes and curated notes are safe; review the queue before processing."), 15000);
    return result.data;
  }

  private scheduleIndexSave() {
    if (this.saveIndexTimer !== null) return;
    this.saveIndexTimer = window.setTimeout(() => { void this.flushIndex(); }, 1500);
  }

  async flushIndex() {
    if (this.saveIndexTimer !== null) { window.clearTimeout(this.saveIndexTimer); this.saveIndexTimer = null; }
    if (!this.curator) return;
    try {
      await this.indexStore.save(this.curator.index);
    } catch (error) {
      console.error(translate("AI Curator: could not save the index."), error);
      new Notice(translate("AI Curator could not save its queue. Check disk space and vault permissions."), 10000);
    }
  }

  async saveSettings() {
    this.configureLanguage();
    await this.saveData(this.settings);
    this.curator?.refreshState();
    this.emitChange();
  }

  // ───────────── change notifications ─────────────

  private configureLanguage() {
    let locale = 'en';
    try { locale = getLanguage(); } catch { /* English fallback */ }
    setUiLanguage(this.settings.uiLanguage === 'auto' ? locale : this.settings.uiLanguage);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitChange() {
    for (const l of this.listeners) { try { l(); } catch (e) { console.error(e); } }
  }

  private updateStatusBar() {
    const c = this.curator.counts();
    const st = this.curator.state;
    let text: string;
    if (st.kind === 'working') text = translate("Curating… {0} left", c.pending + c.analyzing);
    else if (st.kind === 'paused') text = translate("Curator paused");
    else if (st.kind === 'needs-setup') text = translate("Curator: finish setup");
    else if (st.kind === 'limit') text = st.reason === 'daily' ? translate("Curator: daily limit") : translate("Curator: budget reached");
    else if (c.pending) text = translate("Curator: {0} queued", c.pending);
    else text = c.unread ? translate("{0} to read", c.unread) : translate("Curator ready");
    this.statusEl.setText('✦ ' + text);
    this.statusEl.setAttribute('aria-label', translate("Open AI Curator reading inbox"));
  }

  // ───────────── helpers used by the UI ─────────────

  providerSettings(): ProviderSettings { return this.settings.providers[this.settings.provider]; }

  apiKey(): string {
    const id = this.providerSettings()?.secretId;
    if (!id) return '';
    try { return this.app.secretStorage.getSecret(id) ?? ''; } catch { return ''; }
  }

  /** Store a pasted key in Obsidian's SecretStorage (OS keychain where available), never in data.json. */
  async setApiKey(value: string) {
    const ps = this.providerSettings();
    const id = ps.secretId || `ai-curator-${this.settings.provider}`;
    this.app.secretStorage.setSecret(id, value.trim());
    ps.secretId = id;
    if (this.settings.paused && /HTTP 40[13]/.test(this.settings.pauseReason)) { this.settings.paused = false; this.settings.pauseReason = ''; }
    await this.saveSettings();
  }

  language(): OutputLanguage {
    if (this.settings.language !== 'auto') return this.settings.language;
    let lang = 'en';
    try { lang = getLanguage(); } catch { /* older Obsidian */ }
    return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }

  /** A real, minimal round trip: proves key, model and network all work. Costs a few tokens. */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const ps = this.providerSettings();
    const p = preset(this.settings.provider);
    if (p.needsKey && !this.apiKey()) return { ok: false, message: translate("Add an API key first.") };
    try {
      const res = await chat(
        { provider: this.settings.provider, baseUrl: ps.baseUrl, model: ps.model, apiKey: this.apiKey(), timeoutMs: 60_000 },
        { system: 'Reply with the single word OK.', user: 'ping', maxTokens: 16 },
        transport,
      );
      return { ok: true, message: translate("Connected to {0}.", res.model) };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async fetchModels(): Promise<string[]> {
    const ps = this.providerSettings();
    return listModels({ provider: this.settings.provider, baseUrl: ps.baseUrl, model: ps.model, apiKey: this.apiKey() }, transport);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async pause(paused: boolean) {
    this.settings.paused = paused;
    this.settings.pauseReason = paused ? 'Paused by you.' : '';
    await this.saveSettings();
    if (!paused) this.curator.kick(true);
  }

  private onFirstSuccess(title: string) {
    this.settings.firstSuccessAt = Date.now();
    const invite = this.settings.starInvite === 'pending';
    if (invite) this.settings.starInvite = 'shown';
    void this.saveSettings();
    if (invite) {
      showStarInvite(title, (starred) => {
        this.settings.starInvite = 'dismissed';
        void this.saveSettings();
        if (!starred) new Notice(translate("Got it. You can always find the GitHub link under Settings → AI Curator → About."), 6000);
      });
    } else {
      new Notice(translate("AI Curator: “{0}” is ready.", title), 5000);
    }
  }

  private withFile(f: TAbstractFile, fn: (file: TFile) => void) {
    if (f instanceof TFile && f.extension === 'md') fn(f);
  }

  private kickAfterSettle() {
    window.setTimeout(() => this.curator.kick(), (this.settings.settleSeconds + 1) * 1000);
  }

  private registerCommands() {
    this.addCommand({ id: 'open-inbox', name: translate("Open reading inbox"), callback: () => { void this.activateView(); } });
    this.addCommand({ id: 'process-now', name: translate("Process queue now"), callback: () => { this.curator.scan(); this.curator.kick(true); } });
    this.addCommand({
      id: 'toggle-pause', name: translate("Pause or resume automatic curation"),
      callback: () => { void this.pause(!this.settings.paused).then(() => new Notice(this.settings.paused ? translate("AI Curator paused.") : translate("AI Curator resumed."))); },
    });
    this.addCommand({
      id: 'curate-current', name: translate("Curate the current note"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (checking) return true;
        if (this.curator.addManual(vaultFile(file))) new Notice(translate("Queued “{0}” for curation.", file.basename));
        else new Notice(translate("This note is in the AI Curator output folder."));
        return true;
      },
    });
    this.addCommand({
      id: 'write-digest', name: translate("Create weekly reading digest"),
      callback: async () => {
        const path = await this.curator.writeDigest(7);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(file);
      },
    });
    this.addCommand({
      id: 'refresh-notes', name: translate("Refresh related links in curated notes (no AI calls)"),
      callback: async () => { const n = await this.curator.refreshNotes(); new Notice(translate("Refreshed {0} curated notes.", n)); },
    });
    this.addCommand({ id: 'retry-failed', name: translate("Retry failed items"), callback: () => this.curator.retryErrors() });
    this.addCommand({ id: 'setup', name: translate("Open setup guide"), callback: () => new SetupModal(this.app, this).open() });
  }
}
