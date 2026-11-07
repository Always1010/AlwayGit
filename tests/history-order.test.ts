import { expect, it } from 'vitest';
import { orderHistory } from '../src/git/history-order';

const commit = (oid: string, ...parents: string[]) => ({ oid, parents });

it('finishes the current path before other tips, defers shared ancestors and respects merges', () => {
  const commits = [
    commit('main', 'main-older'),
    commit('main-older', 'base'),
    commit('merge', 'current', 'side'),
    commit('side', 'base'),
    commit('current', 'base'),
    commit('base', 'root'),
    commit('root'),
    commit('unrelated'),
  ];
  const ordered = orderHistory(commits, ['merge', 'main', 'unrelated']);
  expect(ordered.map((node) => node.oid)).toEqual([
    'merge',
    'current',
    'side',
    'main',
    'main-older',
    'base',
    'root',
    'unrelated',
  ]);
  const positions = new Map(ordered.map((node, index) => [node.oid, index]));
  for (const node of ordered)
    for (const parent of node.parents)
      expect(positions.get(node.oid)).toBeLessThan(positions.get(parent)!);
  expect(commits[0].oid).toBe('main');
});

it('never lifts an ancestor HEAD above descendants or introduces a filtered-out HEAD', () => {
  const commits = [commit('descendant', 'head'), commit('head', 'base'), commit('base')];
  expect(orderHistory(commits, ['head', 'descendant'])).toEqual(commits);
  const visible = [commit('other', 'base'), commit('base')];
  expect(orderHistory(visible, ['hidden-head', 'other'])).toEqual(visible);
  expect(orderHistory([commit('merge', 'base', 'base'), commit('base')], ['merge'])).toHaveLength(
    2,
  );
});

it('handles long histories iteratively and leaves truncated parents unresolved', () => {
  const commits = Array.from({ length: 20000 }, (_, index) => commit(`c${index}`, `c${index + 1}`));
  expect(orderHistory([...commits].reverse(), ['c0'])).toEqual(commits);
});
