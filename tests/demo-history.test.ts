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
