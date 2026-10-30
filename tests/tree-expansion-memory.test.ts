import { describe, expect, it, vi } from 'vitest';
import { TreeExpansionMemory } from '../src/application/tree-expansion-persistence';
import { defaultTreeExpansion, patchTreeExpansion, treeDirectoryExpanded, treeExpansionPatchSchema } from '../src/protocol/tree-expansion';

describe('repository directory expansion memory', () => {
  it('serializes panel path patches against latest storage and keeps repositories isolated', async () => {
    const values = new Map<string, unknown>();
    let active = 0, peak = 0;
    const memory = new TreeExpansionMemory({
      get: <T>(key: string, fallback: T) => (values.get(key) ?? fallback) as T,
      update: async (key, value) => { peak = Math.max(peak, ++active); await Promise.resolve(); values.set(key, value); active--; },
    });
    await Promise.all([
      memory.patch('repo', { kind: 'directory', path: 'src', expanded: false }),
      memory.patch('repo', { kind: 'directory', path: 'src/deep', expanded: true }),
      memory.patch('other', { kind: 'mode', mode: 'collapsed' }),
    ]);
    expect(peak).toBe(1);
    expect(await memory.read('repo')).toEqual({ mode: 'auto', overrides: { src: false, 'src/deep': true } });
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
    const saved = { mode: 'collapsed', overrides: { legacy: true } }, update = vi.fn(async (_key: string, _value: unknown) => {});
    let unreadable = true;
    const memory = new TreeExpansionMemory({ get: <T>(_key: string, _fallback: T) => { if (unreadable) throw new Error('read failed'); return saved as T; }, update });
    await expect(memory.read('repo')).rejects.toThrow('read failed');
    await expect(memory.patch('repo', { kind: 'directory', path: 'new', expanded: true })).rejects.toThrow('read failed');
    expect(update).not.toHaveBeenCalled();
    unreadable = false;
    update.mockRejectedValueOnce(new Error('write failed'));
    await expect(memory.patch('repo', { kind: 'directory', path: 'new', expanded: true })).rejects.toThrow('write failed');
    await expect(memory.patch('repo', { kind: 'directory', path: 'next', expanded: false })).resolves.toEqual({ mode: 'collapsed', overrides: { legacy: true, next: false } });
  });

  it('retains path choices independently of snapshot identity and hidden parents', () => {
    const preferences = patchTreeExpansion(patchTreeExpansion(defaultTreeExpansion(), { kind: 'directory', path: 'src/deep', expanded: true }), { kind: 'directory', path: 'src', expanded: false });
    expect(treeDirectoryExpanded(preferences, 'src', 30)).toBe(false);
    expect(treeDirectoryExpanded(preferences, 'src/deep', 30)).toBe(true);
    expect(treeDirectoryExpanded(defaultTreeExpansion(), 'top', 5001)).toBe(true);
    expect(treeDirectoryExpanded(defaultTreeExpansion(), 'top/deep', 5001)).toBe(false);
    expect(treeDirectoryExpanded(defaultTreeExpansion(), 'top/deep', 5000)).toBe(true);
    for (const path of ['../repo', '/absolute', 'folder/../other', 'folder\0ghost', 'folder//child']) expect(treeExpansionPatchSchema.safeParse({ kind: 'directory', path, expanded: true }).success).toBe(false);
  });
});
