import test from 'node:test';
import assert from 'node:assert/strict';
import { IndexStore, parseIndex, type IndexAdapter } from '../src/index-store.ts';
import { emptyIndex } from '../src/queue.ts';

function memory() {
  const files = new Map<string, string>();
  const adapter: IndexAdapter = {
    exists: async (p) => files.has(p),
    read: async (p) => { if (!files.has(p)) throw new Error('missing'); return files.get(p)!; },
    write: async (p, s) => { await new Promise((r) => setTimeout(r, 2)); files.set(p, s); },
    remove: async (p) => { files.delete(p); },
  };
  return { files, adapter, store: new IndexStore(adapter, 'index.json') };
}

test('overlapping index saves serialize captured snapshots and preserve a backup', async () => {
  const { store, files } = memory();
  const data = emptyIndex(Date.now());
  const first = store.save(data);
  data.usage.items = 2;
  const second = store.save(data);
  data.usage.items = 99;
  await Promise.all([first, second]);
  assert.equal((await store.load()).data?.usage.items, 2);
  assert.equal(parseIndex(files.get('index.json.bak')!).usage.items, 0);
  assert.equal(files.has('index.json.tmp'), false);
});

test('an interrupted primary write recovers the complete temporary snapshot', async () => {
  const { store, files, adapter } = memory();
  await store.save(emptyIndex(Date.now()));
  const write = adapter.write;
  adapter.write = async (p, text) => {
    if (p === 'index.json') { files.set(p, '{broken'); throw new Error('disk full'); }
    return write(p, text);
  };
  const next = emptyIndex(Date.now());
  next.usage.items = 3;
  await assert.rejects(store.save(next), /disk full/);
  const recovered = await store.load();
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.data?.usage.items, 3);
  adapter.write = write;
  await store.save(recovered.data!);
  assert.equal((await store.load()).recovered, false);
});

test('corrupt primary and temporary files fall back to the last valid backup', async () => {
  const { store, files } = memory();
  await store.save(emptyIndex(Date.now()));
  await store.save(emptyIndex(Date.now()));
  files.set('index.json', '{}');
  files.set('index.json.tmp', '{');
  assert.equal((await store.load()).recovered, true);
  files.set('index.json.bak', 'null');
  assert.deepEqual(await store.load(), { data: null, recovered: false, damaged: true });
});
