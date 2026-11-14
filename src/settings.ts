import { PRESETS, preset } from './providers.ts';

export type LanguageSetting = 'auto' | 'en' | 'zh';

export interface ProviderSettings {
  baseUrl: string;
  model: string;
  /** Name of the secret in Obsidian's SecretStorage. The key itself is never stored in data.json. */
  secretId: string;
  /** Optional USD per million tokens for models without a built-in price. */
  inputPrice: number;
  outputPrice: number;
}

export interface CuratorSettings {
  /** Vault folders to watch. Empty string is never allowed (no whole-vault scans). */
  sources: string[];
  outputFolder: string;
  provider: string;
  providers: Record<string, ProviderSettings>;
  language: LanguageSetting;
  uiLanguage: LanguageSetting;
  profile: string;
  /** Analyze new items automatically in the background. */
  autoProcess: boolean;
  paused: boolean;
  pauseReason: string;
  /** When a saved note is just a teaser, fetch the original web page (the URL already in the note). */
  fetchFullText: boolean;
  /** Read X/Twitter posts through the public FxTwitter API when a saved post is cut off. */
  expandX: boolean;
  monthlyBudget: number;
  dailyLimit: number;
  /** Minimum seconds a new file must be unchanged before it is queued (clippers write in steps). */
  settleSeconds: number;
  maxInputChars: number;
  onboarded: boolean;
  starInvite: 'pending' | 'shown' | 'dismissed';
  firstSuccessAt: number;
}

export function defaultProviderSettings(id: string): ProviderSettings {
  const p = preset(id);
  return { baseUrl: p.baseUrl, model: p.defaultModel, secretId: '', inputPrice: 0, outputPrice: 0 };
}

export const DEFAULT_SETTINGS: CuratorSettings = {
  sources: [],
  outputFolder: 'AI Curator',
  provider: 'deepseek',
  providers: {},
  language: 'auto',
  uiLanguage: 'auto',
  profile: '',
  autoProcess: true,
  paused: false,
  pauseReason: '',
  fetchFullText: true,
  expandX: false,
  monthlyBudget: 3,
  dailyLimit: 100,
  settleSeconds: 8,
  maxInputChars: 60000,
  onboarded: false,
  starInvite: 'pending',
  firstSuccessAt: 0,
};

/** Normalize a user-entered vault folder: forward slashes, no leading/trailing slash, no traversal. */
export function normalizeFolder(value: string): string {
  const parts = value.replace(/\\/g, '/').split('/').map((p) => p.trim()).filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) return '';
  return parts.join('/');
}

export function isInFolder(path: string, folder: string): boolean {
  return !!folder && (path === folder || path.startsWith(folder + '/'));
}

export function migrateSettings(raw: unknown): CuratorSettings {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Partial<CuratorSettings> & Record<string, unknown>;
  const s: CuratorSettings = { ...DEFAULT_SETTINGS, providers: {} };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof CuratorSettings)[]) {
    if (key !== 'providers' && data[key] !== undefined && typeof data[key] === typeof DEFAULT_SETTINGS[key]) {
      (s as unknown as Record<string, unknown>)[key] = data[key];
    }
  }
  s.sources = (Array.isArray(data.sources) ? data.sources : []).map((f) => normalizeFolder(String(f))).filter(Boolean);
  s.sources = [...new Set(s.sources)];
  s.outputFolder = normalizeFolder(String(s.outputFolder || '')) || DEFAULT_SETTINGS.outputFolder;
  if (!PRESETS.some((p) => p.id === s.provider)) s.provider = DEFAULT_SETTINGS.provider;
  for (const p of PRESETS) {
    const defaults = defaultProviderSettings(p.id);
    const input = data.providers?.[p.id];
    s.providers[p.id] = Object.fromEntries(Object.entries(defaults).map(([key, value]) => {
      const saved = input?.[key as keyof ProviderSettings];
      return [key, typeof saved === typeof value && (typeof saved !== 'number' || Number.isFinite(saved)) ? saved : value];
    })) as unknown as ProviderSettings;
  }
  if (!['auto', 'en', 'zh'].includes(s.language)) s.language = 'auto';
  if (!['auto', 'en', 'zh'].includes(s.uiLanguage)) s.uiLanguage = 'auto';
  s.monthlyBudget = Math.max(0, Number(s.monthlyBudget) || 0);
  s.dailyLimit = Math.max(1, Math.round(Number(s.dailyLimit) || DEFAULT_SETTINGS.dailyLimit));
  s.settleSeconds = Math.min(600, Math.max(0, Number(s.settleSeconds) || 0));
  s.maxInputChars = Math.min(400000, Math.max(4000, Number(s.maxInputChars) || DEFAULT_SETTINGS.maxInputChars));
  if (!['pending', 'shown', 'dismissed'].includes(s.starInvite)) s.starInvite = 'pending';
  // Never keep a raw key around if an old build ever stored one.
  delete (s as unknown as Record<string, unknown>).apiKey;
  return s;
}

/** Sources that live inside the curator's own output folder (the output is always excluded from scans). */
export function sourceConflicts(sources: string[], output: string): string[] {
  return sources.filter((src) => isInFolder(src, output));
}
