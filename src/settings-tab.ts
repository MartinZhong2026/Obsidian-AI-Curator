import { type App, Notice, PluginSettingTab, SecretComponent, Setting, TFolder } from 'obsidian';
import { FolderSuggest, money } from './ui.ts';
import { SetupModal } from './onboarding.ts';
import type AICuratorPlugin from './main.ts';
import { PRESETS, PRICES, preset } from './providers.ts';
import { defaultProviderSettings, isInFolder, normalizeFolder } from './settings.ts';
import { openExternal, renderSupportCard, REPO_URL } from './support.ts';

export class CuratorSettingTab extends PluginSettingTab {
  private plugin: AICuratorPlugin;

  constructor(app: App, plugin: AICuratorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('ai-curator-settings');
    this.sources(containerEl);
    this.provider(containerEl);
    this.curation(containerEl);
    this.budget(containerEl);
    this.maintenance(containerEl);
    this.about(containerEl);
  }

  private get s() { return this.plugin.settings; }
  private save = async () => { await this.plugin.saveSettings(); };

  private sources(el: HTMLElement) {
    new Setting(el).setName('What to curate').setHeading();
    el.createEl('p', {
      cls: 'setting-item-description',
      text: 'Pick the folders where your clippings and bookmarks land (Web Clipper, X Bookmarks Sync, Readwise, or anything else that writes Markdown). Notes there are never modified.',
    });
    for (const folder of this.s.sources) {
      const missing = !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder);
      new Setting(el)
        .setName(folder)
        .setDesc(missing ? 'This folder does not exist yet. It will be picked up when it does.' : '')
        .addExtraButton((b) => b.setIcon('x').setTooltip('Stop watching this folder').onClick(async () => {
          this.s.sources = this.s.sources.filter((f) => f !== folder);
          await this.save();
          this.plugin.curator.scan();
          this.display();
        }));
    }
    let pending = '';
    const add = async () => {
      const folder = normalizeFolder(pending);
      if (!folder) { new Notice('Choose a folder inside your vault.'); return; }
      if (isInFolder(folder, this.s.outputFolder)) { new Notice('That is the AI Curator output folder.'); return; }
      if (!this.s.sources.includes(folder)) this.s.sources.push(folder);
      await this.save();
      this.plugin.curator.scan();
      const held = this.plugin.curator.heldItems().length;
      if (held) new Notice(`${held} existing notes found in “${folder}”. Open the reading inbox to choose how many to curate.`, 8000);
      this.display();
    };
    new Setting(el)
      .setName('Add a folder')
      .addSearch((search) => {
        search.setPlaceholder('Clippings');
        search.onChange((v) => { pending = v; });
        new FolderSuggest(this.app, search.inputEl, (p) => { pending = p; });
      })
      .addButton((b) => b.setButtonText('Add').setCta().onClick(add));

    new Setting(el)
      .setName('Output folder')
      .setDesc('Curated notes, digests and a Bases reading list go here.')
      .addText((t) => {
        t.setValue(this.s.outputFolder).onChange(async (v) => {
          const folder = normalizeFolder(v);
          if (folder) { this.s.outputFolder = folder; await this.save(); }
        });
        new FolderSuggest(this.app, t.inputEl, async (p) => { this.s.outputFolder = p; await this.save(); });
      });
  }

  private provider(el: HTMLElement) {
    new Setting(el).setName('AI provider').setHeading();
    const p = preset(this.s.provider);
    const ps = this.plugin.providerSettings();
    new Setting(el)
      .setName('Provider')
      .setDesc('DeepSeek is the default: fast, inexpensive and good at both English and Chinese. Any OpenAI-compatible service works too.')
      .addDropdown((d) => {
        for (const option of PRESETS) d.addOption(option.id, option.name);
        d.setValue(this.s.provider).onChange(async (v) => {
          this.s.provider = v;
          this.s.providers[v] ??= defaultProviderSettings(v);
          await this.save();
          this.display();
        });
      });

    if (p.id === 'custom' || p.local || p.id === 'openai' || p.id === 'openrouter' || p.id === 'gemini') {
      new Setting(el)
        .setName('API address')
        .setDesc(p.local ? 'Your local server. Nothing leaves this computer.' : 'Base URL of the OpenAI-compatible API (must use https).')
        .addText((t) => t.setPlaceholder('https://…/v1').setValue(ps.baseUrl).onChange(async (v) => { ps.baseUrl = v.trim(); await this.save(); }));
    }

    const model = new Setting(el).setName('Model');
    if (p.models.length) {
      model.setDesc(p.id === 'deepseek' ? 'deepseek-flash is recommended for everyday triage.' : 'The default works well; larger models cost more.');
      model.addDropdown((d) => {
        for (const m of p.models) d.addOption(m, PRICES[m] ? `${m} ($${PRICES[m].input}/$${PRICES[m].output} per M tokens)` : m);
        if (ps.model && !p.models.includes(ps.model)) d.addOption(ps.model, ps.model);
        d.setValue(ps.model).onChange(async (v) => { ps.model = v; await this.save(); });
      });
    } else {
      model.setDesc('Type a model name, or load the list from your provider.');
      model.addText((t) => t.setPlaceholder('model-name').setValue(ps.model).onChange(async (v) => { ps.model = v.trim(); await this.save(); }));
      model.addButton((b) => b.setButtonText('Load models').onClick(async () => {
        try {
          const models = await this.plugin.fetchModels();
          new Notice(models.length ? `Available: ${models.slice(0, 15).join(', ')}${models.length > 15 ? '…' : ''}` : 'No models returned.', 12000);
        } catch (e) { new Notice('Could not load models: ' + (e instanceof Error ? e.message : String(e))); }
      }));
    }

    if (p.needsKey || p.id === 'custom') {
      const key = new Setting(el)
        .setName('API key')
        .setDesc(createFragment((f) => {
          f.appendText('Stored in Obsidian’s secure secret storage, not in plugin files or your notes. ');
          if (p.keyUrl) { const a = f.createEl('a', { text: 'Get a key', href: p.keyUrl }); a.addEventListener('click', (e) => { e.preventDefault(); openExternal(p.keyUrl!); }); }
        }));
      key.addComponent((cEl) => new SecretComponent(this.app, cEl).setValue(ps.secretId).onChange(async (v) => {
        ps.secretId = v ?? '';
        await this.save();
      }));
      let typed = '';
      new Setting(el)
        .setName('Paste a new key')
        .setDesc('Quick way to save a key without leaving this page.')
        .addText((t) => { t.inputEl.type = 'password'; t.inputEl.autocomplete = 'off'; t.setPlaceholder('sk-…').onChange((v) => { typed = v; }); })
        .addButton((b) => b.setButtonText('Save key').onClick(async () => {
          if (!typed.trim()) return;
          await this.plugin.setApiKey(typed);
          new Notice('API key saved securely.');
          this.display();
        }));
    }

    const test = new Setting(el).setName('Test connection').setDesc('Sends a one-word request to check the key, model and network.');
    test.addButton((b) => b.setButtonText('Test').onClick(async () => {
      b.setDisabled(true).setButtonText('Testing…');
      const r = await this.plugin.testConnection();
      b.setDisabled(false).setButtonText('Test');
      test.setDesc(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`);
      new Notice(r.ok ? `AI Curator: ${r.message}` : `AI Curator: ${r.message}`, 8000);
    }));

    if (!PRICES[ps.model]) {
      new Setting(el)
        .setName('Price per million tokens (USD)')
        .setDesc('Optional, for cost tracking and the monthly budget. Input / output.')
        .addText((t) => t.setPlaceholder('input').setValue(ps.inputPrice ? String(ps.inputPrice) : '').onChange(async (v) => { ps.inputPrice = Math.max(0, Number(v) || 0); await this.save(); }))
        .addText((t) => t.setPlaceholder('output').setValue(ps.outputPrice ? String(ps.outputPrice) : '').onChange(async (v) => { ps.outputPrice = Math.max(0, Number(v) || 0); await this.save(); }));
    }
  }

  private curation(el: HTMLElement) {
    new Setting(el).setName('Curation').setHeading();
    new Setting(el)
      .setName('Curate automatically')
      .setDesc('Analyze new saves in the background while Obsidian is open. When off, use “Process queue now”.')
      .addToggle((t) => t.setValue(this.s.autoProcess).onChange(async (v) => { this.s.autoProcess = v; await this.save(); if (v) this.plugin.curator.kick(); }));
    new Setting(el)
      .setName('Language of curated notes')
      .addDropdown((d) => d
        .addOption('auto', 'Same as Obsidian')
        .addOption('en', 'English')
        .addOption('zh', '简体中文')
        .setValue(this.s.language)
        .onChange(async (v) => { this.s.language = v as typeof this.s.language; await this.save(); }));
    new Setting(el)
      .setName('About you')
      .setDesc('Optional. What you work on and want to learn. Used to judge relevance and suggest next actions. Sent to the AI provider with each item.')
      .addTextArea((t) => {
        t.setPlaceholder('e.g. Frontend engineer moving into AI agents. Interested in evals, RAG, and shipping side projects.');
        t.setValue(this.s.profile).onChange(async (v) => { this.s.profile = v.slice(0, 2000); await this.save(); });
        t.inputEl.rows = 4;
        t.inputEl.addClass('ai-curator-wide');
      });
    new Setting(el)
      .setName('Fetch full text for teasers')
      .setDesc('If a saved note is only a snippet, download the original page from the link already in the note.')
      .addToggle((t) => t.setValue(this.s.fetchFullText).onChange(async (v) => { this.s.fetchFullText = v; await this.save(); }));
    new Setting(el)
      .setName('Expand X (Twitter) posts')
      .setDesc('For cut-off X posts and X Articles, read the public post through the FxTwitter API (a third-party service that receives the post ID).')
      .addToggle((t) => t.setValue(this.s.expandX).onChange(async (v) => { this.s.expandX = v; await this.save(); }));
  }

  private budget(el: HTMLElement) {
    new Setting(el).setName('Budget').setHeading();
    const u = this.plugin.curator.usage();
    el.createEl('p', {
      cls: 'setting-item-description',
      text: `This month: ${u.items} items, ${(u.inputTokens / 1000).toFixed(0)}k input + ${(u.outputTokens / 1000).toFixed(0)}k output tokens, about ${money(u.cost)}${u.costComplete ? '' : ' (some prices unknown)'}. Estimates only; your provider’s bill is authoritative.`,
    });
    new Setting(el)
      .setName('Monthly budget (USD)')
      .setDesc('Curation pauses when the estimated spend would pass this. 0 means no limit.')
      .addText((t) => t.setValue(String(this.s.monthlyBudget)).onChange(async (v) => { this.s.monthlyBudget = Math.max(0, Number(v) || 0); await this.save(); }));
    new Setting(el)
      .setName('Daily item limit')
      .setDesc('Maximum items analyzed per day.')
      .addText((t) => t.setValue(String(this.s.dailyLimit)).onChange(async (v) => { this.s.dailyLimit = Math.max(1, Math.round(Number(v) || 1)); await this.save(); }));
  }

  private maintenance(el: HTMLElement) {
    new Setting(el).setName('Maintenance').setHeading();
    new Setting(el).setName('Setup guide').setDesc('Run the first-time setup again.')
      .addButton((b) => b.setButtonText('Open').onClick(() => new SetupModal(this.app, this.plugin).open()));
    new Setting(el).setName('Retry failed items')
      .addButton((b) => b.setButtonText('Retry').onClick(() => { this.plugin.curator.retryErrors(); new Notice('Failed items queued again.'); }));
    new Setting(el).setName('Refresh curated notes').setDesc('Rebuild related links and headings in all curated notes. No AI calls; your own notes below the marker are kept.')
      .addButton((b) => b.setButtonText('Refresh').onClick(async () => { const n = await this.plugin.curator.refreshNotes(); new Notice(`Refreshed ${n} notes.`); }));
  }

  private about(el: HTMLElement) {
    new Setting(el).setName('About').setHeading();
    el.createEl('p', {
      cls: 'setting-item-description',
      text: `AI Curator ${this.plugin.manifest.version} — Save anything. Read what matters. Your notes are sent only to the AI provider you choose, only from the folders you pick. No telemetry.`,
    });
    renderSupportCard(el);
    new Setting(el).setName('Source code and documentation')
      .addButton((b) => b.setButtonText('Open GitHub').onClick(() => openExternal(REPO_URL)));
  }
}
