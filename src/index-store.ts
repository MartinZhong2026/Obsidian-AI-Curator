import type { IndexData } from './types.ts';

export interface IndexAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<unknown>;
  remove(path: string): Promise<unknown>;
}

/** Validate the container before handing persisted data to the engine. */
export function parseIndex(text: string): IndexData {
  const data = JSON.parse(text);
  if (data?.version !== 1 || !data.items || typeof data.items !== 'object' || Array.isArray(data.items) ||
      !data.usage || typeof data.usage.month !== 'string' || typeof data.usage.day !== 'string' ||
      !['cost', 'items', 'inputTokens', 'outputTokens', 'dayItems'].every((k) => Number.isFinite(data.usage[k]) && data.usage[k] >= 0) ||
      (data.seededFolders !== undefined && (!Array.isArray(data.seededFolders) || !data.seededFolders.every((s: unknown) => typeof s === 'string')))) {
    throw new Error('Invalid AI Curator index.');
  }
  for (const [path, item] of Object.entries(data.items) as [string, any][]) {
    if (!item || item.path !== path || typeof item.title !== 'string' || typeof item.hash !== 'string' ||
        !['pending', 'analyzing', 'done', 'skipped', 'error'].includes(item.state) ||
        !Number.isFinite(item.mtime) || !Number.isFinite(item.chars)) throw new Error('Invalid indexed item.');
  }
  return data;
}

/** Serializes snapshots; keeps recovery copies instead of deleting the only good index. */
export class IndexStore {
  private adapter: IndexAdapter;
  private path: string;
  private tail: Promise<void> = Promise.resolve();
  constructor(adapter: IndexAdapter, path: string) { this.adapter = adapter; this.path = path; }

  async load(): Promise<{ data: IndexData | null; recovered: boolean; damaged: boolean }> {
    let damaged = false;
    for (const suffix of ['', '.tmp', '.bak']) {
      try {
        if (!(await this.adapter.exists(this.path + suffix))) continue;
        return { data: parseIndex(await this.adapter.read(this.path + suffix)), recovered: !!suffix, damaged };
      } catch { damaged = true; }
    }
    return { data: null, recovered: false, damaged };
  }

  save(data: IndexData): Promise<void> {
    const snapshot = JSON.stringify(data);
    const save = this.tail.then(async () => {
      // Preserve the last valid state, including one recovered from an interrupted save.
      const previous = await this.load();
      if (previous.data) await this.adapter.write(this.path + '.bak', JSON.stringify(previous.data));
      await this.adapter.write(this.path + '.tmp', snapshot);
      await this.adapter.write(this.path, snapshot);
      await this.adapter.remove(this.path + '.tmp');
    });
    this.tail = save.catch(() => {});
    return save;
  }
}
