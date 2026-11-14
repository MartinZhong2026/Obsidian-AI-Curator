import { translate } from './i18n.ts';
import { AbstractInputSuggest, type App, TFolder } from 'obsidian';

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  private input: HTMLInputElement;
  private onPick: (path: string) => void;

  constructor(app: App, input: HTMLInputElement, onPick: (path: string) => void) {
    super(app, input);
    this.input = input;
    this.onPick = onPick;
  }
  getSuggestions(query: string): TFolder[] {
    const q = query.toLowerCase();
    return this.app.vault.getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder && !f.isRoot() && f.path.toLowerCase().includes(q))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 50);
  }
  renderSuggestion(folder: TFolder, el: HTMLElement) { el.setText(folder.path); }
  selectSuggestion(folder: TFolder) {
    this.input.value = folder.path;
    this.onPick(folder.path);
    this.close();
  }
}

export function money(value: number | null | undefined): string {
  if (value == null) return translate("unknown");
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}
