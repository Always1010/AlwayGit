import { describe, expect, it } from 'vitest';
import { commitTreePanelStateSchema } from '../src/protocol/tree';
import type { RevisionTreeChange, RevisionTreeEntry } from '../src/protocol/tree';
import {
  allSnapshotNodes,
  changeCounts,
  snapshotCounts,
  snapshotNodes,
  snapshotRows,
} from '../webview/commitTreeModel';
import { parseRevisionTreeChanges } from '../src/git/tree';

function entry(path: string, type: RevisionTreeEntry['type'] = 'blob'): RevisionTreeEntry {
  return {
    path,
    name: path.split('/').at(-1)!,
    oid: 'b'.repeat(40),
    mode: type === 'tree' ? '040000' : '100644',
    type,
  };
}
describe('independent Commit snapshots', () => {
  it('focuses changed leaves and their ancestors with correct guides even after manual expansion', () => {
    const entries = [
      entry('.github', 'tree'),
      entry('.github/workflows', 'tree'),
      entry('.github/workflows/ci.yml'),
      entry('media', 'tree'),
      entry('media/icon.png'),
      entry('README.md'),
      entry('src', 'tree'),
      entry('src/components', 'tree'),
      entry('src/components/Editor.vue'),
      entry('src/components/Toolbar.vue'),
      entry('src/components/dialogs', 'tree'),
      entry('src/components/dialogs/Dialog.vue'),
      entry('src/utils', 'tree'),
      entry('src/utils/helper.ts'),
      entry('docs', 'tree'),
      entry('docs/guide.md'),
      entry('docs/images', 'tree'),
      entry('docs/images/workbench.png'),
    ];
    const nodes = snapshotNodes(entries, [
        { path: 'src/components/Editor.vue', status: 'M' } as RevisionTreeChange,
      ]),
      flat = allSnapshotNodes(nodes),
      expanded = new Set(flat.filter((node) => node.summary).map((node) => node.id)),
      before = JSON.stringify(nodes),
      focused = snapshotRows(nodes, expanded, '', { changesOnly: true });
    expect(focused.map((row) => row.node.entry.path)).toEqual([
      'src',
      'src/components',
      'src/components/Editor.vue',
    ]);
    expect(focused.find((row) => row.node.change)).toMatchObject({
      depth: 2,
      guides: [false, false],
      last: true,
      changeHighlight: 'M',
    });
    expect(
      snapshotRows(nodes, expanded, 'Toolbar', { changesOnly: true }).map(
        (row) => row.node.entry.path,
      ),
    ).toEqual(['src/components/Toolbar.vue']);
    expect(
      snapshotRows(nodes, expanded, 'guide.md', { changesOnly: true }).map(
        (row) => row.node.entry.path,
      ),
    ).toEqual(['docs/guide.md']);
    expect(
      snapshotRows(nodes, new Set(flat.map((node) => node.id)), '', { changesOnly: true }),
    ).toEqual(focused);
    expect(snapshotRows(nodes, new Set(), '', { changesOnly: true })).toMatchObject([
      { node: { id: 'src' }, depth: 0, guides: [], last: true, changeHighlight: 'summary' },
    ]);
    expect(snapshotRows(nodes, expanded, '', { changesOnly: true })).toEqual(focused);
    expect(JSON.stringify(nodes)).toBe(before);
    expect(
      snapshotRows(nodes, new Set(flat.map((node) => node.id))).map((row) => row.node.entry.path),
    ).toHaveLength(entries.length);
  });
  it('keeps every change kind and deleted ancestor identity when focusing a replacement tree', () => {
    const entries = [
      entry('replaced'),
      entry('src', 'tree'),
      ...['added', 'modified', 'renamed', 'copied', 'typed', 'unchanged'].map((name) =>
        entry(`src/${name}`),
      ),
    ];
    const changes = [
      ['src/added', 'A'],
      ['src/modified', 'M'],
      ['src/renamed', 'R100'],
      ['src/copied', 'C100'],
      ['src/typed', 'T'],
      ['replaced/deep/deleted', 'D'],
    ].map(([path, status]) => ({
      path,
      status,
      beforeMode: '100644',
      afterMode: status === 'D' ? '000000' : '100644',
      beforeOid: 'c'.repeat(40),
      afterOid: 'd'.repeat(40),
      ...(status === 'R100' ? { previousPath: 'old/name' } : {}),
    }));
    const nodes = snapshotNodes(entries, changes),
      expanded = new Set(
        allSnapshotNodes(nodes)
          .filter((node) => node.summary)
          .map((node) => node.id),
      ),
      rows = snapshotRows(nodes, expanded, '', { changesOnly: true });
    expect(
      rows
        .filter((row) => row.node.change)
        .map((row) => row.node.change?.status)
        .sort(),
    ).toEqual(['A', 'C100', 'D', 'M', 'R100', 'T']);
    expect(rows.find((row) => row.node.entry.path === 'replaced')).toMatchObject({
      node: { deleted: true, entry: { type: 'tree' } },
    });
    expect(rows.find((row) => row.node.entry.path === 'replaced/deep/deleted')).toMatchObject({
      node: { deleted: true },
      depth: 2,
    });
    expect(snapshotRows(snapshotNodes(entries), new Set(), '', { changesOnly: true })).toEqual([]);
  });
  it('retains only a fixed repository and full Commit ID when restoring a tree tab', () => {
    const state = { commitTree: { repoId: 'repository', revision: 'a'.repeat(40) } };
    expect(commitTreePanelStateSchema.parse(state)).toEqual(state);
    expect(
      commitTreePanelStateSchema.safeParse({
        commitTree: { ...state.commitTree, revision: 'HEAD' },
      }).success,
    ).toBe(false);
    expect(
      commitTreePanelStateSchema.safeParse({ ...state, drafts: { repository: 'do not replace' } })
        .success,
    ).toBe(false);
  });
  it('searches unexpanded paths and distinguishes submodules from snapshot files', () => {
    const entries = [
      entry('readme'),
      entry('src', 'tree'),
      entry('src/deep', 'tree'),
      entry('src/deep/文件.txt'),
      entry('vendor', 'gitlink'),
      entry('link', 'symlink'),
    ];
    const nodes = snapshotNodes(entries);
    expect(snapshotRows(nodes, new Set()).map((row) => row.node.entry.path)).toEqual([
      'src',
      'link',
      'readme',
      'vendor',
    ]);
    expect(snapshotRows(nodes, new Set(), '文件').map((row) => row.node.entry.path)).toEqual([
      'src/deep/文件.txt',
    ]);
    expect(
      snapshotRows(nodes, new Set(['src', 'src/deep'])).find((row) =>
        row.node.entry.path.endsWith('文件.txt'),
      )?.depth,
    ).toBe(2);
    expect(snapshotCounts(entries)).toEqual({ files: 3, submodules: 1 });
  });
  it('overlays deletions and renames without changing the snapshot or losing file/directory replacements', () => {
    const entries = [
      entry('replaced', 'tree'),
      entry('replaced/new.txt'),
      entry('old-directory'),
      entry('new-name'),
      entry('same.txt'),
    ];
    const change = (
      path: string,
      status: string,
      previousPath?: string,
      beforeMode = '100644',
    ): RevisionTreeChange => ({
      path,
      status,
      previousPath,
      beforeMode,
      afterMode: status === 'D' ? '000000' : '100644',
      beforeOid: 'c'.repeat(40),
      afterOid: 'd'.repeat(40),
    });
    const files = [
      change('replaced', 'D'),
      change('replaced/new.txt', 'A'),
      change('old-directory/nested/deleted.txt', 'D'),
      change('new-name', 'R100', 'old-name'),
      change('vendor', 'D', undefined, '160000'),
    ];
    const before = JSON.stringify(entries),
      nodes = snapshotNodes(entries, files),
      flat = allSnapshotNodes(nodes);
    expect(JSON.stringify(entries)).toBe(before);
    expect(
      flat
        .filter((node) => !node.deleted)
        .map((node) => node.entry.path)
        .sort(),
    ).toEqual(entries.map((item) => item.path).sort());
    expect(new Set(flat.map((node) => node.id)).size).toBe(flat.length);
    expect(flat.filter((node) => node.entry.path === 'replaced')).toHaveLength(2);
    expect(
      flat.find((node) => node.deleted && node.entry.path === 'old-directory')?.children[0].entry
        .path,
    ).toBe('old-directory/nested');
    expect(flat.find((node) => node.entry.path === 'vendor')).toMatchObject({
      deleted: true,
      entry: { type: 'gitlink', oid: 'c'.repeat(40) },
    });
    expect(flat.some((node) => node.entry.path === 'old-name')).toBe(false);
    expect(snapshotRows(nodes, new Set(), 'deleted.txt')[0].node.deleted).toBe(true);
    expect(snapshotCounts(entries)).toEqual({ files: 4, submodules: 0 });
    expect(changeCounts(files)).toMatchObject({ added: 1, deleted: 3, renamed: 1 });
    expect(
      allSnapshotNodes(snapshotNodes(entries)).some((node) => node.deleted || node.change),
    ).toBe(false);
  });
  it('keeps raw Git entry modes and NUL-delimited rename paths', () => {
    const before = 'a'.repeat(40),
      after = 'b'.repeat(40);
    const files = parseRevisionTreeChanges(
      Buffer.from(
        `:100644 100644 ${before} ${after} R100\0old\tname\0new\nname\0:160000 000000 ${before} ${'0'.repeat(40)} D\0vendor\0`,
      ),
    );
    expect(files[0]).toMatchObject({
      previousPath: 'old\tname',
      path: 'new\nname',
      status: 'R100',
    });
    expect(files[1]).toMatchObject({ path: 'vendor', beforeMode: '160000', afterMode: '000000' });
    expect(() => parseRevisionTreeChanges(Buffer.from('malformed\0'))).toThrow();
  });
  it('moves mixed change highlights to the nearest visible collapsed directory without mutating tree summaries', () => {
    const entries = [
      entry('src', 'tree'),
      entry('src/deep', 'tree'),
      entry('src/deep/added.txt'),
      entry('src/deep/modified.txt'),
      entry('src/renamed.txt'),
      entry('copied.txt'),
      entry('type.txt'),
      entry('unchanged.txt'),
    ];
    const change = (path: string, status: string): RevisionTreeChange => ({
      path,
      status,
      beforeMode: '100644',
      afterMode: status === 'D' ? '000000' : '100644',
      beforeOid: 'c'.repeat(40),
      afterOid: 'd'.repeat(40),
    });
    const nodes = snapshotNodes(entries, [
      change('src/deep/added.txt', 'A'),
      change('src/deep/modified.txt', 'M'),
      change('src/deep/deleted.txt', 'D'),
      change('src/renamed.txt', 'R100'),
      change('copied.txt', 'C100'),
      change('type.txt', 'T'),
      change('gone/deep/old.txt', 'D'),
    ]);
    const before = JSON.stringify(nodes);
    const highlights = (expanded: string[]) =>
      snapshotRows(nodes, new Set(expanded))
        .filter((row) => row.changeHighlight)
        .map((row) => [row.node.entry.path, row.changeHighlight]);
    // A remembered descendant expansion never bypasses its collapsed visible ancestor.
    expect(highlights(['src/deep'])).toEqual([
      ['gone', 'summary'],
      ['src', 'summary'],
      ['copied.txt', 'C'],
      ['type.txt', 'T'],
    ]);
    expect(highlights(['src'])).toEqual([
      ['gone', 'summary'],
      ['src/deep', 'summary'],
      ['src/renamed.txt', 'R'],
      ['copied.txt', 'C'],
      ['type.txt', 'T'],
    ]);
    const allExpanded = allSnapshotNodes(nodes)
      .filter((node) => node.entry.type === 'tree')
      .map((node) => node.id);
    expect(highlights(allExpanded)).toEqual([
      ['gone/deep/old.txt', 'D'],
      ['src/deep/added.txt', 'A'],
      ['src/deep/deleted.txt', 'D'],
      ['src/deep/modified.txt', 'M'],
      ['src/renamed.txt', 'R'],
      ['copied.txt', 'C'],
      ['type.txt', 'T'],
    ]);
    expect(JSON.stringify(nodes)).toBe(before);
    expect(nodes.find((node) => node.entry.path === 'src')?.summary).toMatchObject({
      added: 1,
      modified: 1,
      deleted: 1,
      renamed: 1,
    });
    expect(
      snapshotRows(snapshotNodes(entries), new Set()).every(
        (row) => row.changeHighlight === undefined,
      ),
    ).toBe(true);
  });
  it('highlights only actual flat search matches and retains an explicit matching directory summary', () => {
    const entries = [
      entry('src', 'tree'),
      entry('src/deep', 'tree'),
      entry('src/deep/changed.txt'),
      entry('src/unrelated.txt'),
    ];
    const files: RevisionTreeChange[] = [
      {
        path: 'src/deep/changed.txt',
        status: 'M',
        beforeMode: '100644',
        afterMode: '100644',
        beforeOid: 'c'.repeat(40),
        afterOid: 'd'.repeat(40),
      },
    ];
    const nodes = snapshotNodes(entries, files),
      expanded = new Set(['src', 'src/deep']);
    expect(
      snapshotRows(nodes, new Set(), 'changed.txt').map((row) => [
        row.node.entry.path,
        row.depth,
        row.changeHighlight,
      ]),
    ).toEqual([['src/deep/changed.txt', 0, 'M']]);
    expect(
      snapshotRows(nodes, expanded, 'src').map((row) => [row.node.entry.path, row.changeHighlight]),
    ).toEqual([
      ['src', 'summary'],
      ['src/deep', 'summary'],
      ['src/deep/changed.txt', 'M'],
      ['src/unrelated.txt', undefined],
    ]);
    expect(
      snapshotRows(nodes, new Set(), 'unrelated.txt').map((row) => row.changeHighlight),
    ).toEqual([undefined]);
    expect(
      snapshotRows(nodes, expanded)
        .filter((row) => row.node.entry.type === 'tree')
        .every((row) => !row.changeHighlight && row.node.summary),
    ).toBe(true);
  });
});
