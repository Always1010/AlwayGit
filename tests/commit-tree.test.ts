import { describe, expect, it } from 'vitest';
import { commitTreePanelStateSchema } from '../src/protocol/tree';
import type { RevisionTreeChange, RevisionTreeEntry } from '../src/protocol/tree';
import { allSnapshotNodes, changeCounts, snapshotCounts, snapshotNodes, snapshotRows } from '../webview/commitTreeModel';
import { parseRevisionTreeChanges } from '../src/git/tree';

function entry(path: string, type: RevisionTreeEntry['type'] = 'blob'): RevisionTreeEntry {
  return { path, name: path.split('/').at(-1)!, oid: 'b'.repeat(40), mode: type === 'tree' ? '040000' : '100644', type };
}
describe('independent Commit snapshots', () => {
  it('retains only a fixed repository and full Commit ID when restoring a tree tab', () => {
    const state = { commitTree: { repoId: 'repository', revision: 'a'.repeat(40) } };
    expect(commitTreePanelStateSchema.parse(state)).toEqual(state);
    expect(commitTreePanelStateSchema.safeParse({ commitTree: { ...state.commitTree, revision: 'HEAD' } }).success).toBe(false);
    expect(commitTreePanelStateSchema.safeParse({ ...state, drafts: { repository: 'do not replace' } }).success).toBe(false);
  });
  it('searches unexpanded paths and distinguishes submodules from snapshot files', () => {
    const entries = [entry('readme'), entry('src', 'tree'), entry('src/deep', 'tree'), entry('src/deep/文件.txt'), entry('vendor', 'gitlink'), entry('link', 'symlink')];
    const nodes = snapshotNodes(entries);
    expect(snapshotRows(nodes, new Set()).map(row => row.node.entry.path)).toEqual(['src', 'link', 'readme', 'vendor']);
    expect(snapshotRows(nodes, new Set(), '文件').map(row => row.node.entry.path)).toEqual(['src/deep/文件.txt']);
    expect(snapshotRows(nodes, new Set(['src', 'src/deep'])).find(row => row.node.entry.path.endsWith('文件.txt'))?.depth).toBe(2);
    expect(snapshotCounts(entries)).toEqual({ files: 3, submodules: 1 });
  });
  it('overlays deletions and renames without changing the snapshot or losing file/directory replacements', () => {
    const entries = [entry('replaced', 'tree'), entry('replaced/new.txt'), entry('old-directory'), entry('new-name'), entry('same.txt')];
    const change = (path: string, status: string, previousPath?: string, beforeMode = '100644'): RevisionTreeChange => ({ path, status, previousPath, beforeMode, afterMode: status === 'D' ? '000000' : '100644', beforeOid: 'c'.repeat(40), afterOid: 'd'.repeat(40) });
    const files = [change('replaced', 'D'), change('replaced/new.txt', 'A'), change('old-directory/nested/deleted.txt', 'D'), change('new-name', 'R100', 'old-name'), change('vendor', 'D', undefined, '160000')];
    const before = JSON.stringify(entries), nodes = snapshotNodes(entries, files), flat = allSnapshotNodes(nodes);
    expect(JSON.stringify(entries)).toBe(before);
    expect(flat.filter(node => !node.deleted).map(node => node.entry.path).sort()).toEqual(entries.map(item => item.path).sort());
    expect(new Set(flat.map(node => node.id)).size).toBe(flat.length);
    expect(flat.filter(node => node.entry.path === 'replaced')).toHaveLength(2);
    expect(flat.find(node => node.deleted && node.entry.path === 'old-directory')?.children[0].entry.path).toBe('old-directory/nested');
    expect(flat.find(node => node.entry.path === 'vendor')).toMatchObject({ deleted: true, entry: { type: 'gitlink', oid: 'c'.repeat(40) } });
    expect(flat.some(node => node.entry.path === 'old-name')).toBe(false);
    expect(snapshotRows(nodes, new Set(), 'deleted.txt')[0].node.deleted).toBe(true);
    expect(snapshotCounts(entries)).toEqual({ files: 4, submodules: 0 });
    expect(changeCounts(files)).toMatchObject({ added: 1, deleted: 3, renamed: 1 });
    expect(allSnapshotNodes(snapshotNodes(entries)).some(node => node.deleted || node.change)).toBe(false);
  });
  it('keeps raw Git entry modes and NUL-delimited rename paths', () => {
    const before = 'a'.repeat(40), after = 'b'.repeat(40);
    const files = parseRevisionTreeChanges(Buffer.from(`:100644 100644 ${before} ${after} R100\0old\tname\0new\nname\0:160000 000000 ${before} ${'0'.repeat(40)} D\0vendor\0`));
    expect(files[0]).toMatchObject({ previousPath: 'old\tname', path: 'new\nname', status: 'R100' });
    expect(files[1]).toMatchObject({ path: 'vendor', beforeMode: '160000', afterMode: '000000' });
    expect(() => parseRevisionTreeChanges(Buffer.from('malformed\0'))).toThrow();
  });
});
