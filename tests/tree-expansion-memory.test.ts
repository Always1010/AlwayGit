import { describe, expect, it, vi } from 'vitest';
import { TreeExpansionMemory } from '../src/application/tree-expansion-persistence';
import {
  defaultTreeExpansion,
  patchTreeExpansion,
  treeDirectoryExpanded,
  treeExpansionPatchSchema,
} from '../src/protocol/tree-expansion';
import { localCacheClearSchema } from '../src/protocol/local-cache';

function storageFixture(initial: [string, unknown][] = []) {
  const values = new Map(initial);
  return {
    values,
    keys: () => [...values.keys()],
    get: <T>(key: string, fallback: T) => (values.has(key) ? values.get(key) : fallback) as T,
    update: vi.fn(async (key: string, value: unknown) => {
      if (value === undefined) values.delete(key);
      else values.set(key, value);
    }),
  };
}

describe('repository directory expansion memory', () => {
  it('serializes panel path patches against latest storage and keeps repositories isolated', async () => {
    const values = new Map<string, unknown>();
    let active = 0,
      peak = 0;
    const memory = new TreeExpansionMemory({
      get: <T>(key: string, fallback: T) => (values.get(key) ?? fallback) as T,
      update: async (key, value) => {
        peak = Math.max(peak, ++active);
        await Promise.resolve();
        values.set(key, value);
        active--;
      },
    });
    await Promise.all([
      memory.patch('repo', { kind: 'directory', path: 'src', expanded: false }),
      memory.patch('repo', { kind: 'directory', path: 'src/deep', expanded: true }),
      memory.patch('other', { kind: 'mode', mode: 'collapsed' }),
    ]);
    expect(peak).toBe(1);
    expect(await memory.read('repo')).toEqual({
      mode: 'auto',
      overrides: { src: false, 'src/deep': true },
    });
    expect(await memory.read('other')).toEqual({ mode: 'collapsed', overrides: {} });
    await memory.patch('repo', { kind: 'directory', path: 'src', expanded: null });
    expect((await memory.read('repo')).overrides).toEqual({ 'src/deep': true });
    await memory.patch('repo', { kind: 'mode', mode: 'expanded' });
    expect(await memory.read('repo')).toEqual({ mode: 'expanded', overrides: {} });
    await memory.reset('repo');
    expect(await memory.read('repo')).toEqual(defaultTreeExpansion());
    expect(await memory.read('other')).toEqual({ mode: 'collapsed', overrides: {} });
  });

  it('does not overwrite unreadable state and recovers the write queue after failures', async () => {
    const saved = { mode: 'collapsed', overrides: { legacy: true } },
      update = vi.fn(async (_key: string, _value: unknown) => {});
    let unreadable = true;
    const memory = new TreeExpansionMemory({
      get: <T>(_key: string, _fallback: T) => {
        if (unreadable) throw new Error('read failed');
        return saved as T;
      },
      update,
    });
    await expect(memory.read('repo')).rejects.toThrow('read failed');
    await expect(
      memory.patch('repo', { kind: 'directory', path: 'new', expanded: true }),
    ).rejects.toThrow('read failed');
    expect(update).not.toHaveBeenCalled();
    unreadable = false;
    update.mockRejectedValueOnce(new Error('write failed'));
    await expect(
      memory.patch('repo', { kind: 'directory', path: 'new', expanded: true }),
    ).rejects.toThrow('write failed');
    await expect(
      memory.patch('repo', { kind: 'directory', path: 'next', expanded: false }),
    ).resolves.toEqual({ mode: 'collapsed', overrides: { legacy: true, next: false } });
  });

  it('retains path choices independently of snapshot identity and hidden parents', () => {
    const preferences = patchTreeExpansion(
      patchTreeExpansion(defaultTreeExpansion(), {
        kind: 'directory',
        path: 'src/deep',
        expanded: true,
      }),
      { kind: 'directory', path: 'src', expanded: false },
    );
    expect(treeDirectoryExpanded(preferences, 'src', 30)).toBe(false);
    expect(treeDirectoryExpanded(preferences, 'src/deep', 30)).toBe(true);
    expect(treeDirectoryExpanded(defaultTreeExpansion(), 'top', 5001)).toBe(true);
    expect(treeDirectoryExpanded(defaultTreeExpansion(), 'top/deep', 5001)).toBe(false);
    expect(treeDirectoryExpanded(defaultTreeExpansion(), 'top/deep', 5000)).toBe(true);
    for (const path of [
      '../repo',
      '/absolute',
      'folder/../other',
      'folder\0ghost',
      'folder//child',
    ])
      expect(
        treeExpansionPatchSchema.safeParse({ kind: 'directory', path, expanded: true }).success,
      ).toBe(false);
  });

  it('migrates all current workspace records, retains removed repositories and never revives cleared records', async () => {
    const repo = { id: '/repo', name: 'Project', root: '/repo' },
      key = `alwaygit.treeExpansion.${encodeURIComponent(repo.id)}`;
    const legacy = storageFixture([
      [key, { mode: 'collapsed', overrides: { src: true } }],
      ['alwaygit.treeExpansion.removed', { mode: 'expanded', overrides: {} }],
      ['alwaygit.session', { drafts: { repo: 'keep me' } }],
    ]);
    const global = storageFixture(),
      memory = new TreeExpansionMemory(global, legacy);
    expect(await memory.list([repo])).toEqual([
      {
        repoId: repo.id,
        name: repo.name,
        root: repo.root,
        registered: true,
        directories: 1,
        mode: 'collapsed',
      },
      { repoId: 'removed', registered: false, directories: 0, mode: 'expanded' },
    ]);
    expect(legacy.values.has(key)).toBe(false);
    const cleared = vi.fn();
    expect(
      await memory.clear({ kind: 'repositories', repoIds: ['removed'] }, [repo], cleared),
    ).toHaveLength(1);
    expect(cleared).toHaveBeenCalledWith('removed');
    expect(await memory.clear({ kind: 'all' }, [repo])).toEqual([]);
    const reopened = new TreeExpansionMemory(global, legacy);
    expect(await reopened.read(repo.id, repo)).toEqual(defaultTreeExpansion());
    expect(await reopened.list([repo])).toEqual([]);
    expect(legacy.values.get('alwaygit.session')).toEqual({ drafts: { repo: 'keep me' } });
  });

  it('retries migration failures without losing the source or overwriting an established global record', async () => {
    const key = 'alwaygit.treeExpansion.repo',
      original = { mode: 'collapsed', overrides: { src: true } };
    const global = storageFixture(),
      legacy = storageFixture([[key, original]]),
      memory = new TreeExpansionMemory(global, legacy);
    global.update.mockRejectedValueOnce(new Error('copy failed'));
    await expect(memory.list([])).rejects.toThrow('copy failed');
    expect(legacy.values.get(key)).toEqual(original);
    legacy.update.mockRejectedValueOnce(new Error('delete failed'));
    await expect(memory.list([])).rejects.toThrow('delete failed');
    expect(legacy.values.get(key)).toEqual(original);
    const newer = { mode: 'expanded', overrides: { docs: false } };
    global.values.set(key, { preferences: newer, name: 'Known', root: '/known' });
    expect(await memory.read('repo')).toEqual(newer);
    expect(legacy.values.has(key)).toBe(false);
    expect((await memory.list([]))[0]).toEqual({
      repoId: 'repo',
      name: 'Known',
      root: '/known',
      registered: false,
      directories: 1,
      mode: 'expanded',
    });
  });

  it('blocks selected legacy imports from other workspaces only after persisting clear metadata', async () => {
    const key = 'alwaygit.treeExpansion.repo',
      original = { mode: 'collapsed', overrides: { src: true } };
    const global = storageFixture(),
      legacyA = storageFixture([[key, original]]),
      legacyB = storageFixture([
        [key, original],
        ['alwaygit.treeExpansion.other', original],
      ]);
    const first = new TreeExpansionMemory(global, legacyA),
      second = new TreeExpansionMemory(global, legacyB);
    await first.list([]);
    global.update.mockRejectedValueOnce(new Error('metadata failed'));
    await expect(second.clear({ kind: 'repositories', repoIds: ['repo'] }, [])).rejects.toThrow(
      'metadata failed',
    );
    expect(global.values.has(key)).toBe(true);
    expect(legacyB.values.get(key)).toEqual(original);
    expect(await first.clear({ kind: 'repositories', repoIds: ['repo'] }, [])).toEqual([]);
    expect(await second.read('repo')).toEqual(defaultTreeExpansion());
    expect(legacyB.values.has(key)).toBe(false);
    expect(await second.list([])).toEqual([
      { repoId: 'other', registered: false, directories: 1, mode: 'collapsed' },
    ]);
    await second.patch('repo', { kind: 'directory', path: 'new', expanded: true });
    expect(await first.read('repo')).toEqual({ mode: 'auto', overrides: { new: true } });
  });

  it('blocks every old workspace import after clearing all while keeping new preferences writable', async () => {
    const original = { mode: 'expanded', overrides: { old: false } },
      global = storageFixture();
    const legacyA = storageFixture([['alwaygit.treeExpansion.repo', original]]);
    const legacyB = storageFixture([
      ['alwaygit.treeExpansion.repo', original],
      ['alwaygit.treeExpansion.unopened', original],
    ]);
    const first = new TreeExpansionMemory(global, legacyA),
      second = new TreeExpansionMemory(global, legacyB);
    await first.list([]);
    await first.clear({ kind: 'repositories', repoIds: ['repo'] }, []);
    expect(await first.clear({ kind: 'all' }, [])).toEqual([]);
    expect(await second.list([])).toEqual([]);
    expect(legacyB.values.size).toBe(0);
    await second.patch('unopened', { kind: 'mode', mode: 'collapsed' });
    expect(await first.read('unopened')).toEqual({ mode: 'collapsed', overrides: {} });
    expect((await first.list([])).map((entry) => entry.repoId)).toEqual(['unopened']);
  });

  it('lists and clears corrupt records, reports partial failures and rejects ambiguous clear payloads', async () => {
    const global = storageFixture([
      ['alwaygit.treeExpansion.broken%', { unexpected: true }],
      ['alwaygit.treeExpansion.good', { mode: 'expanded', overrides: {} }],
      ['unrelated', 'keep'],
    ]);
    const memory = new TreeExpansionMemory(global);
    expect((await memory.list([])).find((entry) => entry.repoId === 'broken%')).toMatchObject({
      invalid: true,
      registered: false,
      directories: 0,
    });
    await expect(memory.read('good')).resolves.toEqual({ mode: 'expanded', overrides: {} });
    const cleared = vi.fn(),
      update = global.update.getMockImplementation()!;
    global.update.mockImplementation(async (key, value) => {
      if (key.endsWith('.good')) throw new Error('clear failed');
      await update(key, value);
    });
    await expect(memory.clear({ kind: 'all' }, [], cleared)).rejects.toThrow('clear failed');
    expect(cleared).toHaveBeenCalledExactlyOnceWith('broken%');
    expect((await memory.list([])).map((entry) => entry.repoId)).toEqual(['good']);
    global.update.mockImplementation(update);
    expect(await memory.clear({ kind: 'all' }, [])).toEqual([]);
    expect(global.values.get('unrelated')).toBe('keep');
    for (const payload of [
      { kind: 'all', repoIds: ['good'] },
      { kind: 'repositories', repoIds: [] },
      { repoIds: ['good'] },
    ])
      expect(localCacheClearSchema.safeParse(payload).success).toBe(false);
  });
});
