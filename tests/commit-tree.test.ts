import { describe, expect, it } from 'vitest';
import { commitTreePanelStateSchema } from '../src/protocol/tree';
import type { RevisionTreeEntry } from '../src/protocol/tree';
import { snapshotCounts, snapshotNodes, snapshotRows } from '../webview/commitTreeModel';

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
});
