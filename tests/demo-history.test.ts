import { afterEach, expect, it, vi } from 'vitest';
import type { HistoryPage, Snapshot } from '../src/protocol/types';
import { createDemoRequest } from '../webview/demo';
import { layoutGraph } from '../webview/graph/layout';

afterEach(() => vi.unstubAllGlobals());

it('shows two topic commits on a side lane before each demo merge', async () => {
  vi.stubGlobal('location', { search: '?demo=1' });
  vi.stubGlobal('localStorage', { getItem: () => null });
  const request = createDemoRequest(() => {});
  const snapshot = (await request('snapshot', undefined)) as Snapshot;
  const history = (await request('history', { ref: 'main', limit: 200 })) as HistoryPage;
  const graph = layoutGraph(history.commits);
  const byOid = new Map(
    history.commits.map((commit, index) => [commit.oid, { commit, row: graph.rows[index] }]),
  );
  const merges = history.commits.filter((commit) => commit.parents.length > 1);
  expect(merges).toHaveLength(15);
  for (const merge of merges) {
    const [base, tip] = merge.parents;
    const first = byOid.get(tip)!;
    const second = byOid.get(first.commit.parents[0])!;
    expect(second.commit.parents).toEqual([base]);
    expect(byOid.get(merge.oid)!.row.lane).toBe(0);
    expect([first.row.lane, second.row.lane]).toEqual([1, 1]);
    expect(byOid.get(base)!.row.lane).toBe(0);
  }
  const featureTip = snapshot.refs.find((ref) => ref.name === 'feature/history-graph')!.oid;
  expect(featureTip).toBe(merges[0].parents[1]);
  expect(
    snapshot.worktrees.find((tree) => tree.branch === 'refs/heads/feature/history-graph')!.head,
  ).toBe(featureTip);
  expect(graph.endState.lanes).toEqual([]);
});

it('keeps demo group management and source-scoped movement consistent with repository rows', async () => {
  vi.stubGlobal('location', { search: '?demo=1' });
  vi.stubGlobal('localStorage', { getItem: () => null });
  const request = createDemoRequest(() => {}),
    repositories = (await request(
      'repositories',
      undefined,
    )) as import('../src/protocol/types').Repository[],
    a = (await request('createRepositoryCollection', { name: 'A' })) as { id: string },
    b = (await request('createRepositoryCollection', { name: 'B' })) as { id: string },
    c = (await request('createRepositoryCollection', { name: 'C' })) as { id: string },
    key = repositories[0].commonDir.replaceAll('\\', '/').toLowerCase();
  await request('updateRepositoryMemberships', {
    keys: [key],
    changes: [a, b].map((group) => ({ collectionId: group.id, included: true })),
  });
  await request('moveRepositoryRows', {
    rows: [{ key, collectionId: a.id }],
    targetCollectionId: c.id,
  });
  expect(
    ((await request('repositories', undefined)) as typeof repositories)[0].collectionIds,
  ).toEqual([b.id, c.id]);
  const order = (await request(
    'repositoryOrder',
    undefined,
  )) as import('../src/protocol/types').RepositoryOrder;
  expect(order.collections[b.id]).toEqual(['repository:' + key]);
  expect(order.collections[c.id]).toEqual(['repository:' + key]);
  expect(order.collections[a.id]).toEqual([]);
});
