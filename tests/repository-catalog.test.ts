import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CatalogStore, type RepositoryCatalog } from '../src/repositories/catalog-store';

const io = vi.hoisted(() => ({ failRename: false }));
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, rename: async (...args: Parameters<typeof fs.rename>) => {
    if (io.failRename) throw new Error('Injected catalog replacement failure');
    return fs.rename(...args);
  } };
});
const directories: string[] = [];
const empty = (): RepositoryCatalog => ({ schemaVersion: 1, revision: 0, roots: [], exclusions: [], collections: [], assignments: {} });
async function fixture() { const directory = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-catalog-')); directories.push(directory); return directory; }
afterEach(async () => {
  io.failRename = false;
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('alwaygit-catalog-')) throw new Error('Unsafe cleanup target');
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

describe('authoritative shared repository catalog', () => {
  it('serializes independent hosts with stale migration snapshots across add, remove, move and order changes', async () => {
    const directory = await fixture(), first = new CatalogStore(directory, empty), staleMigration = vi.fn(empty);
    const second = new CatalogStore(directory, staleMigration);
    await first.transaction(catalog => {
      catalog.roots = ['A', 'B']; catalog.collections = [{ id: 'client', name: 'Client' }];
      catalog.order = { root: ['repository:A', 'repository:B', 'collection:client'], collections: { client: [] } };
    });
    await second.reload();
    await Promise.all([
      first.transaction(catalog => { catalog.roots = catalog.roots.filter(root => root !== 'A'); catalog.exclusions.push('A'); catalog.order!.root = catalog.order!.root.filter(key => key !== 'repository:A'); }),
      second.transaction(catalog => { catalog.roots.push('C'); catalog.assignments.B = 'client'; catalog.order!.root = ['repository:C', 'collection:client']; catalog.order!.collections.client = ['repository:B']; }),
    ]);
    await first.reload();
    expect(first.snapshot()).toMatchObject({ roots: ['B', 'C'], exclusions: ['A'], assignments: { B: 'client' }, order: { root: ['repository:C', 'collection:client'], collections: { client: ['repository:B'] } } });
    expect(staleMigration).not.toHaveBeenCalled();
  });
  it('migrates exactly once and rejects corrupt or unknown schemas without replacing them', async () => {
    const directory = await fixture(), migrate = vi.fn(() => ({ ...empty(), roots: ['legacy'], exclusions: ['removed'] }));
    const store = new CatalogStore(directory, migrate); await store.reload(); await store.reload();
    expect(migrate).toHaveBeenCalledOnce(); expect(store.snapshot().roots).toEqual(['legacy']);
    for (const text of ['broken JSON', JSON.stringify({ ...empty(), schemaVersion: 2 })]) {
      await writeFile(store.filename, text);
      await expect(store.transaction(catalog => { catalog.roots.push('new'); })).rejects.toThrow('preserved');
      expect(await readFile(store.filename, 'utf8')).toBe(text); expect(store.snapshot().roots).toEqual(['legacy']);
    }
  });
  it('keeps the previous disk and confirmed snapshot when atomic replacement fails, then permits a retry', async () => {
    const directory = await fixture(), store = new CatalogStore(directory, empty); await store.transaction(catalog => { catalog.roots.push('A'); });
    const previous = await readFile(store.filename, 'utf8'), revision = store.snapshot().revision;
    io.failRename = true;
    await expect(store.transaction(catalog => { catalog.roots.push('B'); })).rejects.toThrow('replacement failure');
    expect(await readFile(store.filename, 'utf8')).toBe(previous); expect(store.snapshot()).toMatchObject({ roots: ['A'], revision });
    io.failRename = false; await store.transaction(catalog => { catalog.roots.push('B'); });
    expect(store.snapshot().roots).toEqual(['A', 'B']);
  });
});
