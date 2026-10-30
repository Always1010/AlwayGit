import { describe, expect, it } from 'vitest';
import { commitTreePanelStateSchema } from '../src/protocol/tree';
import {
  treeCompareOrderSchema,
  openCommitTreeSchema,
  revisionTreeCompareSchema,
} from '../src/protocol/validation';
import { readQueryCategory } from '../src/protocol/queries';
import {
  actionSchema,
  historySchema,
  createRepositoryCollectionSchema,
  reorderRepositorySchema,
  diffSchema,
  diffPageSchema,
  openRepositorySchema,
  openWorkbenchSchema,
  operationSettingsSchema,
  requestSchema,
  sessionSchema,
} from '../src/protocol/validation';

describe('Workbench protocol validation', () => {
  it('persists ordered comparison targets while preserving legacy single-commit tree state', () => {
    const revision = 'a'.repeat(40),
      baseRevision = 'b'.repeat(40);
    for (const target of [{ revision }, { revision, baseRevision }]) {
      expect(openCommitTreeSchema.parse(target)).toEqual(target);
      const state = { commitTree: { repoId: 'repo', ...target } };
      expect(commitTreePanelStateSchema.parse(state)).toEqual(state);
    }
    expect(requestSchema.parse({ id: 'compare', method: 'revisionTreeCompare' }).method).toBe(
      'revisionTreeCompare',
    );
    expect(revisionTreeCompareSchema.parse({ revision, baseRevision })).toEqual({
      revision,
      baseRevision,
    });
    expect(readQueryCategory('revisionTreeCompare')).toBe('revisionTreeCompare');
    expect(treeCompareOrderSchema.parse({ left: revision, right: baseRevision })).toEqual({
      left: revision,
      right: baseRevision,
    });
    expect(treeCompareOrderSchema.safeParse({ left: 'HEAD', right: baseRevision }).success).toBe(
      false,
    );
    expect(readQueryCategory('treeCompareOrder')).toBe('treeCompareOrder');
    expect(readQueryCategory('treeCompareOrder')).not.toBe(readQueryCategory('compare'));
    expect(readQueryCategory('treeCompareOrder')).not.toBe(readQueryCategory('details'));
    expect(readQueryCategory('revisionTreeCompare')).not.toBe(
      readQueryCategory('revisionTreeChanges'),
    );
    for (const invalid of [
      { revision },
      { revision, baseRevision: 'HEAD' },
      { revision: 'main', baseRevision },
      { revision, baseRevision, parent: baseRevision },
    ])
      expect(revisionTreeCompareSchema.safeParse(invalid).success).toBe(false);
    expect(
      commitTreePanelStateSchema.safeParse({
        commitTree: { repoId: 'repo', revision, baseRevision: 'HEAD' },
      }).success,
    ).toBe(false);
  });

  it('preserves bounded file-history context in requests and legacy-compatible sessions', () => {
    const file = { path: 'new.txt', anchorPath: 'old.txt', revision: 'a'.repeat(40) };
    expect(historySchema.parse({ file })).toEqual({ file });
    expect(
      sessionSchema.parse({ views: { repo: { search: '', tab: 'history', fileHistory: file } } })
        .views?.repo.fileHistory,
    ).toEqual(file);
    for (const invalid of [{ path: '' }, { path: 'bad\0name' }, { ...file, other: true }])
      expect(historySchema.safeParse({ file: invalid }).success).toBe(false);
  });

  it('accepts bounded page requests and rejects arbitrary snapshot tokens and oversized ranges', () => {
    const page = { token: '27b25a96-9495-4619-94be-071fe44811d9', start: 100000, count: 128 };
    expect(requestSchema.parse({ id: 'page', method: 'diffPage', payload: page }).method).toBe(
      'diffPage',
    );
    expect(diffPageSchema.parse(page)).toEqual(page);
    for (const invalid of [
      { ...page, token: '../file' },
      { ...page, start: -1 },
      { ...page, start: 1.5 },
      { ...page, count: 513 },
    ])
      expect(diffPageSchema.safeParse(invalid).success).toBe(false);
  });
  it('requires a captured context and explicit file versions for selected commits', () => {
    const action = {
      type: 'commit',
      message: 'selected',
      files: [{ path: 'file.txt', area: 'unstaged' }],
      expectedHead: 'a'.repeat(40),
      expectedBranch: 'main',
    };
    expect(actionSchema.parse(action)).toEqual(action);
    expect(actionSchema.safeParse({ ...action, expectedHead: undefined }).success).toBe(false);
    expect(
      actionSchema.safeParse({ ...action, files: [{ path: 'file.txt', area: 'conflict' }] })
        .success,
    ).toBe(false);
    expect(actionSchema.safeParse({ ...action, files: [] }).success).toBe(false);
    expect(actionSchema.parse({ ...action, files: [], amend: true })).toMatchObject({
      files: [],
      amend: true,
    });
  });
  it('accepts file actions beyond 10,000 paths and token-only Discard, but rejects an empty unplanned Discard', () => {
    const paths = Array.from({ length: 10001 }, (_, index) => `file-${index}.txt`);
    for (const type of ['stage', 'unstage', 'discard'])
      expect(actionSchema.parse({ type, paths })).toMatchObject({ paths });
    expect(actionSchema.parse({ type: 'discard', planToken: 'checked' })).toEqual({
      type: 'discard',
      planToken: 'checked',
      paths: [],
    });
    expect(actionSchema.safeParse({ type: 'discard', paths: [] }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'discard', paths: ['a.txt'], mode: 'all' }).success).toBe(
      false,
    );
  });
  it('requires captured local or remote Tag identities before deletion', () => {
    for (const expectedOid of ['a'.repeat(40), 'b'.repeat(64)])
      expect(actionSchema.parse({ type: 'tag.delete', name: 'v1', expectedOid })).toEqual({
        type: 'tag.delete',
        name: 'v1',
        expectedOid,
      });
    const remote = {
      remote: 'origin',
      expectedRemoteOid: 'c'.repeat(40),
      expectedDestination: 'd'.repeat(64),
    };
    expect(actionSchema.parse({ type: 'tag.delete', name: 'v1', ...remote })).toEqual({
      type: 'tag.delete',
      name: 'v1',
      ...remote,
    });
    expect(
      actionSchema.parse({
        type: 'tag.delete',
        name: 'v1',
        expectedOid: 'a'.repeat(40),
        ...remote,
      }),
    ).toMatchObject(remote);
    for (const invalid of [
      { type: 'tag.delete', name: 'v1' },
      { type: 'tag.delete', name: 'v1', expectedOid: '0'.repeat(40) },
      { type: 'tag.delete', name: 'v1', remote: 'origin' },
      { type: 'tag.delete', name: 'v1', ...remote, expectedRemoteOid: undefined },
      { type: 'tag.delete', name: 'v1', ...remote, expectedDestination: undefined },
    ])
      expect(actionSchema.safeParse(invalid).success).toBe(false);
  });
  it('requires names and raw identities for Tag Push', () => {
    const action = {
      type: 'tag.push' as const,
      remote: 'origin',
      names: ['v1', 'v2'],
      expectedOids: { v1: 'a'.repeat(40), v2: 'b'.repeat(40) },
    };
    expect(actionSchema.parse(action)).toEqual(action);
    expect(actionSchema.safeParse({ ...action, names: [] }).success).toBe(false);
    expect(actionSchema.safeParse({ ...action, expectedOids: { v1: 'HEAD' } }).success).toBe(false);
  });
  it('accepts an explicit remote for create-and-push Tag', () => {
    const action = {
      type: 'tag.create' as const,
      name: 'v1',
      target: 'HEAD',
      message: 'release',
      pushRemote: 'origin',
    };
    expect(actionSchema.parse(action)).toEqual(action);
  });
  it('requires an exact nonempty single or batch Worktree removal target', () => {
    expect(actionSchema.parse({ type: 'worktree.remove', path: '/linked' })).toEqual({
      type: 'worktree.remove',
      path: '/linked',
    });
    expect(
      actionSchema.parse({ type: 'worktree.remove', paths: ['/one', '/two'], force: true }),
    ).toMatchObject({ paths: ['/one', '/two'], force: true });
    for (const payload of [{}, { paths: [] }, { path: '/one', paths: ['/two'] }])
      expect(actionSchema.safeParse({ type: 'worktree.remove', ...payload }).success).toBe(false);
  });
  it('requires a valid persisted Reset default', () => {
    const settings = {
      allowDetachedHead: false,
      pushFollowTags: false,
      pushTagAfterCreate: false,
      forceDeleteUnmergedBranches: false,
      forceRemoveDirtyWorktrees: false,
      defaultResetMode: 'hard' as const,
    };
    expect(operationSettingsSchema.parse(settings)).toEqual(settings);
    expect(
      operationSettingsSchema.safeParse({ ...settings, defaultResetMode: 'keep' }).success,
    ).toBe(false);
  });
  it.each(['merge', 'rebase', 'reset'])('requires a captured branch and HEAD for %s', (type) => {
    const action = { type, target: 'HEAD', ...(type === 'reset' ? { mode: 'hard' } : {}) };
    expect(actionSchema.safeParse(action).success).toBe(false);
    expect(
      actionSchema.parse({ ...action, expectedHead: 'a'.repeat(40), expectedBranch: 'main' }),
    ).toMatchObject({ expectedBranch: 'main' });
    expect(
      actionSchema.safeParse({ ...action, expectedHead: '', expectedBranch: '' }).success,
    ).toBe(true);
  });
  it('accepts selected Stash paths and rejects an empty selection', () => {
    const action = {
      type: 'stash.create',
      paths: ['selected [1].txt', 'notes.txt'],
      includeUntracked: true,
      message: 'selected files',
    };
    expect(actionSchema.parse(action)).toEqual(action);
    expect(() => actionSchema.parse({ type: 'stash.create', paths: [] })).toThrow();
  });
  it('preserves operation review tokens and the explicit conflict staging action', () => {
    expect(actionSchema.parse({ type: 'resolve-and-stage', paths: ['same.txt'] })).toEqual({
      type: 'resolve-and-stage',
      paths: ['same.txt'],
    });
    expect(
      actionSchema.parse({ type: 'operation.continue', kind: 'merge', reviewToken: 'reviewed' }),
    ).toEqual({ type: 'operation.continue', kind: 'merge', reviewToken: 'reviewed' });
    expect(
      actionSchema.parse({ type: 'commit', message: 'Reviewed', reviewToken: 'reviewed' }),
    ).toMatchObject({ reviewToken: 'reviewed' });
    expect(
      requestSchema.parse({ id: 'review', method: 'operationReview', repoId: 'fixture' }).method,
    ).toBe('operationReview');
  });
  it('requires a group form name and explicit relative ordering targets', () => {
    expect(createRepositoryCollectionSchema.parse({ name: ' Other ' })).toEqual({ name: 'Other' });
    expect(() => createRepositoryCollectionSchema.parse({ name: ' ' })).toThrow();
    expect(() => createRepositoryCollectionSchema.parse({ name: 'x'.repeat(81) })).toThrow();
    expect(
      reorderRepositorySchema.parse({
        key: 'collection:a',
        targetKey: 'collection:b',
        position: 'before',
      }),
    ).toMatchObject({ position: 'before' });
    expect(() =>
      reorderRepositorySchema.parse({ key: 'a', targetKey: 'b', position: 'sideways' }),
    ).toThrow();
  });
  it('retains v2 layout, multi-reference views and drafts while accepting legacy sessions', () => {
    const state = {
      version: 2,
      language: 'zh-CN',
      layout: {
        preset: 'workbench',
        sidebar: 230,
        details: 360,
        diff: 720,
        diffCollapsed: true,
        graph: 72,
        author: 120,
        date: 150,
        font: 13,
        row: 26,
      },
      repoId: 'fixture',
      drafts: { fixture: 'Commit draft' },
      views: {
        fixture: {
          checkedRefs: [],
          expandedRefGroups: ['local:feature'],
          collapsedSidebarGroups: ['tag'],
          search: '',
          selectedOid: 'abc',
          selectedParent: 'parent-2',
          selectedStashOid: 'def',
          selectedFile: 'a.txt',
          tab: 'history',
        },
      },
    };
    expect(sessionSchema.parse(state)).toEqual(state);
    expect(
      sessionSchema.parse({
        views: { fixture: { ref: 'refs/heads/main', search: '', tab: 'changes' } },
      }),
    ).toEqual({ views: { fixture: { ref: 'refs/heads/main', search: '', tab: 'changes' } } });
    expect(() =>
      sessionSchema.parse({ ...state, layout: { ...state.layout, sidebar: -100 } }),
    ).toThrow();
    expect(() => sessionSchema.parse({ ...state, language: 'invalid' })).toThrow();
    for (const diffNavigationScope of ['commit', 'file'])
      expect(sessionSchema.parse({ ...state, diffNavigationScope })).toMatchObject({
        diffNavigationScope,
        drafts: state.drafts,
        views: state.views,
      });
    expect(sessionSchema.safeParse({ ...state, diffNavigationScope: 'invalid' }).success).toBe(
      false,
    );
    for (const singleKeyShortcuts of [true, false])
      expect(sessionSchema.parse({ ...state, singleKeyShortcuts })).toMatchObject({
        singleKeyShortcuts,
        drafts: state.drafts,
        views: state.views,
      });
    expect(sessionSchema.safeParse({ ...state, singleKeyShortcuts: 'false' }).success).toBe(false);
  });

  it('accepts captured Stash IDs and requires validated Checkout targets', () => {
    expect(
      actionSchema.parse({
        type: 'stash.apply',
        selector: 'stash@{0}',
        expectedOid: 'a'.repeat(40),
        pop: true,
      }),
    ).toEqual({
      type: 'stash.apply',
      selector: 'stash@{0}',
      expectedOid: 'a'.repeat(40),
      pop: true,
    });
    expect(() => actionSchema.parse({ type: 'commit.checkout', target: '' })).toThrow();
    expect(
      actionSchema.parse({ type: 'checkout.stash', target: 'topic', includeUntracked: true }),
    ).toEqual({ type: 'checkout.stash', target: 'topic', includeUntracked: true });
    expect(
      requestSchema.parse({
        id: 'stash-details',
        method: 'stashDetails',
        repoId: 'fixture',
        payload: { oid: 'a'.repeat(40) },
      }).method,
    ).toBe('stashDetails');
    expect(
      requestSchema.parse({
        id: 'preview',
        method: 'diffPreview',
        repoId: 'fixture',
        payload: { kind: 'change', path: 'a.txt', area: 'staged' },
      }).method,
    ).toBe('diffPreview');
    expect(
      diffSchema.parse({ kind: 'stash-working', stashOid: 'a'.repeat(40), path: 'notes.txt' }),
    ).toEqual({ kind: 'stash-working', stashOid: 'a'.repeat(40), path: 'notes.txt' });
    expect(
      requestSchema.parse({
        id: 'compare',
        method: 'compare',
        repoId: 'fixture',
        payload: { left: 'abc', right: 'def' },
      }).method,
    ).toBe('compare');
    expect(requestSchema.parse({ id: 'statuses', method: 'repositoryStatuses' }).method).toBe(
      'repositoryStatuses',
    );
    expect(openRepositorySchema.parse({ newTab: true })).toEqual({ newTab: true });
    expect(openWorkbenchSchema.parse({ newTab: true })).toEqual({ newTab: true });
    expect(() => openWorkbenchSchema.parse({})).toThrow();
    expect(() => openRepositorySchema.parse({ newTab: true, newWindow: true })).toThrow();
    expect(
      actionSchema.parse({
        type: 'push',
        remote: 'origin',
        branch: 'main',
        remoteBranch: 'release/main',
        setUpstream: true,
        followTags: true,
      }),
    ).toMatchObject({ remoteBranch: 'release/main', setUpstream: true, followTags: true });
    expect(
      actionSchema.parse({
        type: 'pull',
        strategy: 'ff-only',
        remote: 'origin',
        remoteBranch: 'feature/source',
        expectedHead: 'a'.repeat(40),
        expectedBranch: 'main',
      }),
    ).toMatchObject({ remoteBranch: 'feature/source', expectedBranch: 'main' });
    expect(actionSchema.parse({ type: 'pull', strategy: 'rebase' })).toEqual({
      type: 'pull',
      strategy: 'rebase',
    });
    expect(() =>
      actionSchema.parse({ type: 'pull', strategy: 'merge', remoteBranch: 'main' }),
    ).toThrow();
    expect(
      actionSchema.parse({
        type: 'remote.add',
        name: 'origin',
        url: 'https://example.com/acme/repo.git',
      }),
    ).toEqual({ type: 'remote.add', name: 'origin', url: 'https://example.com/acme/repo.git' });
    expect(
      actionSchema.parse({
        type: 'cherry-pick',
        commits: ['abc'],
        expectedHead: 'def',
        expectedBranch: 'main',
      }),
    ).toMatchObject({ expectedBranch: 'main' });
    expect(
      actionSchema.parse({
        type: 'branch.delete',
        names: ['topic', 'fix/a'],
        expectedOids: { topic: 'a'.repeat(40) },
      }),
    ).toMatchObject({ names: ['topic', 'fix/a'] });
    expect(() => actionSchema.parse({ type: 'branch.delete', names: [] })).toThrow();
    expect(
      actionSchema.parse({
        type: 'remote.delete',
        remote: 'origin',
        branches: ['feature/a'],
        expectedOids: { 'feature/a': 'b'.repeat(40) },
      }),
    ).toMatchObject({ remote: 'origin', branches: ['feature/a'] });
    const branches = [
      { source: 'refs/remotes/origin/feature/a', name: 'feature/a', expectedOid: 'c'.repeat(40) },
    ];
    expect(
      actionSchema.parse({
        type: 'branch.track',
        branches,
        checkout: true,
        stashFirst: true,
        includeUntracked: true,
      }),
    ).toEqual({
      type: 'branch.track',
      branches,
      checkout: true,
      stashFirst: true,
      includeUntracked: true,
    });
    expect(() => actionSchema.parse({ type: 'branch.track', branches: [] })).toThrow();
    expect(() =>
      actionSchema.parse({
        type: 'branch.track',
        branches: [...branches, { source: 'refs/remotes/origin/feature/b', name: 'feature/b' }],
        checkout: true,
      }),
    ).toThrow();
    expect(() =>
      actionSchema.parse({ type: 'branch.track', branches, stashFirst: true }),
    ).toThrow();
  });
});

it('round-trips custom shortcuts with an old session and rejects conflicting bindings', () => {
  const legacy = { drafts: { a: 'keep draft' }, singleKeyShortcuts: false };
  expect(sessionSchema.parse(legacy)).toEqual(legacy);
  const shortcutOverrides = { refresh: [], fetch: [{ key: 'f', modifiers: ['primary', 'shift'] }] };
  expect(sessionSchema.parse({ ...legacy, shortcutOverrides })).toEqual({
    ...legacy,
    shortcutOverrides,
  });
  expect(
    sessionSchema.safeParse({
      ...legacy,
      shortcutOverrides: { fetch: [{ key: 'p', modifiers: [] }] },
    }).success,
  ).toBe(false);
});
