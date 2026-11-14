import { translate } from './i18n.ts';
import { Notice, setIcon } from 'obsidian';

export const REPO_URL = 'https://github.com/MartinZhong2026/Obsidian-AI-Curator';
export const ISSUES_URL = REPO_URL + '/issues';

export function openExternal(url: string) {
  window.open(url, '_blank', 'noopener');
}

/** Shown once, after the first real AI result. Non-blocking; closes on any choice. */
export function showStarInvite(title: string, onClose: (starred: boolean) => void) {
  const fragment = document.createDocumentFragment();
  const box = fragment.createDiv({ cls: 'ai-curator-invite' });
  const head = box.createDiv({ cls: 'ai-curator-invite-head' });
  setIcon(head.createSpan({ cls: 'ai-curator-invite-icon' }), 'sparkles');
  head.createSpan({ text: translate("Your first item is curated") });
  box.createEl('p', { text: translate("“{0}” is ready in your reading inbox.", title.slice(0, 80)) });
  box.createEl('p', {
    cls: 'ai-curator-muted',
    text: translate("AI Curator is free and open source. If it saves you time, a GitHub star helps other readers find it."),
  });
  const actions = box.createDiv({ cls: 'ai-curator-actions' });
  const star = actions.createEl('button', { cls: 'mod-cta', text: translate("Star on GitHub") });
  const later = actions.createEl('button', { text: translate("No thanks") });
  const notice = new Notice(fragment, 0);
  let done = false;
  const close = (starred: boolean) => {
    if (done) return;
    done = true;
    notice.hide();
    onClose(starred);
  };
  star.addEventListener('click', (e) => { e.stopPropagation(); openExternal(REPO_URL); close(true); });
  later.addEventListener('click', (e) => { e.stopPropagation(); close(false); });
}

export function renderSupportCard(container: HTMLElement) {
  const card = container.createDiv({ cls: 'ai-curator-support' });
  setIcon(card.createDiv({ cls: 'ai-curator-support-icon' }), 'star');
  const content = card.createDiv({ cls: 'ai-curator-support-content' });
  content.createEl('strong', { text: translate("Enjoying AI Curator?") });
  content.createEl('p', {
    text: translate("It is built in the open. Stars, bug reports and ideas all help. Starring happens on GitHub; the plugin never touches your GitHub account."),
  });
  const actions = content.createDiv({ cls: 'ai-curator-actions' });
  actions.createEl('button', { cls: 'mod-cta', text: translate("Star on GitHub") }).addEventListener('click', () => openExternal(REPO_URL));
  actions.createEl('button', { text: translate("Report an issue") }).addEventListener('click', () => openExternal(ISSUES_URL));
}
