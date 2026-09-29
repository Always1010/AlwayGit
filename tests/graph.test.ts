import { describe, expect, it } from 'vitest';
import type { Commit } from '../src/protocol/types';
import { layoutGraph } from '../webview/graph/layout';

function commit(oid: string, ...parents: string[]): Commit {
  return { oid, parents, author: 'A', email: 'a@example.com', timestamp: 0, subject: oid };
}

describe('Git history graph', () => {
  it('connects linear ancestry and terminates a root without phantom edges', () => {
    const graph = layoutGraph([commit('c', 'b'), commit('b', 'a'), commit('a')]);
    expect(graph.rows.map(row => row.lane)).toEqual([0, 0, 0]);
    expect(graph.rows.map(row => row.hasIncoming)).toEqual([false, true, true]);
    expect(graph.rows[1].segments).toEqual([
      { fromLane: 0, toLane: 0, from: 'top', to: 'middle', color: 0, kind: 'incoming', target: 'b' },
      { fromLane: 0, toLane: 0, from: 'middle', to: 'bottom', color: 0, kind: 'parent', target: 'a' },
    ]);
    expect(graph.rows[2].segments.map(segment => segment.kind)).toEqual(['incoming']);
    expect(graph.endState.lanes).toEqual([]);
  });

  it('branches merge parents into separate lanes and reconnects shared ancestry', () => {
    const graph = layoutGraph([
      commit('merge', 'left', 'right'), commit('left', 'base'),
      commit('right', 'base'), commit('base'),
    ]);
    expect(graph.rows.map(row => row.lane)).toEqual([0, 0, 1, 0]);
    expect(graph.rows[0].segments.map(segment => segment.toLane)).toEqual([0, 1]);
    const rightRow = graph.rows[2];
    expect(rightRow.segments.find(segment => segment.kind === 'parent')).toMatchObject({
      fromLane: 1, toLane: 0, target: 'base',
    });
    expect(rightRow.segments.find(segment => segment.kind === 'through')).toMatchObject({
      fromLane: 0, toLane: 0, target: 'base',
    });
    expect(graph.endState.lanes).toEqual([]);
  });

  it('draws all octopus parents and handles unrelated roots while paths pass through', () => {
    const graph = layoutGraph([
      commit('octopus', 'a', 'b', 'c', 'd'), commit('unrelated'),
      commit('a', 'base'), commit('b', 'base'), commit('c', 'base'),
      commit('d', 'base'), commit('base'), commit('other-root'),
    ]);
    expect(graph.rows[0].segments.map(segment => segment.target)).toEqual(['a', 'b', 'c', 'd']);
    expect(graph.rows[1].lane).toBe(4);
    expect(graph.rows[1].segments).toHaveLength(4);
    expect(graph.rows[1].segments.every(segment => segment.kind === 'through')).toBe(true);
    expect(graph.rows[7].lane).toBe(0);
    expect(graph.rows[7].segments).toEqual([]);
    expect(graph.endState.lanes).toEqual([]);
  });

  it('reuses an existing first parent without losing additional parent connectors', () => {
    const graph = layoutGraph([
      commit('m', 'a', 'b'), commit('a', 'b', 'c'), commit('b', 'c'), commit('c'),
    ]);
    expect(graph.rows[1].segments.filter(segment => segment.kind === 'parent')).toEqual([
      { fromLane: 0, toLane: 1, from: 'middle', to: 'bottom', color: 1, kind: 'parent', target: 'b' },
      { fromLane: 0, toLane: 0, from: 'middle', to: 'bottom', color: 2, kind: 'parent', target: 'c' },
    ]);
    expect(graph.endState.lanes).toEqual([]);
  });

  it('produces identical rows and colors across every page boundary', () => {
    const history = [
      commit('m', 'a', 'b', 'c'), commit('a', 'z'), commit('x'),
      commit('b', 'z'), commit('c', 'z'), commit('z'),
    ];
    const whole = layoutGraph(history);
    for (let boundary = 0; boundary <= history.length; boundary++) {
      const first = layoutGraph(history.slice(0, boundary));
      const second = layoutGraph(history.slice(boundary), first.endState);
      expect([...first.rows, ...second.rows]).toEqual(whole.rows);
      expect(second.endState).toEqual(whole.endState);
    }
  });

  it('preserves unresolved parents through empty and truncated pages without mutation', () => {
    const first = layoutGraph([commit('m', 'a', 'b')]);
    const before = JSON.stringify(first.endState);
    const empty = layoutGraph([], first.endState);
    const last = layoutGraph([commit('a', 'missing')], empty.endState);
    expect(empty.rows).toEqual([]);
    expect(empty.endState).toEqual(first.endState);
    expect(empty.laneCount).toBe(2);
    expect(last.endState.lanes.map(lane => lane?.oid)).toEqual(['missing', 'b']);
    expect(JSON.stringify(first.endState)).toBe(before);
    expect(last.rows[0].segments.some(segment => segment.target === 'b' && segment.kind === 'through')).toBe(true);
  });

  it('renders a parent only once even if malformed input repeats it', () => {
    const graph = layoutGraph([commit('m', 'a', 'a'), commit('a')]);
    expect(graph.rows[0].parents).toEqual(['a']);
    expect(graph.rows[0].segments).toHaveLength(1);
    expect(graph.endState.lanes).toEqual([]);
  });

  it('matches every outgoing endpoint to the next row in a complex interleaved DAG', () => {
    const history = Array.from({ length: 80 }, (_, index) => {
      const parents = [index + 1, index + 3, index + 9]
        .filter(parent => parent < 80 && (index + parent) % 5 !== 0)
        .map(parent => `c${parent}`);
      return commit(`c${index}`, ...parents);
    });
    const graph = layoutGraph(history);
    const endpoints = (rowIndex: number, edge: 'top' | 'bottom') => {
      const segments = graph.rows[rowIndex].segments.filter(segment =>
        edge === 'top' ? segment.from === 'top' : segment.to === 'bottom');
      return [...new Set(segments.map(segment =>
        `${edge === 'top' ? segment.fromLane : segment.toLane}:${segment.target}:${segment.color}`))].sort();
    };
    for (let row = 0; row < history.length - 1; row++) {
      expect(endpoints(row, 'bottom')).toEqual(endpoints(row + 1, 'top'));
      expect(graph.rows[row].segments.filter(segment => segment.kind === 'parent')
        .map(segment => segment.target)).toEqual(history[row].parents);
    }
    expect(graph.endState.lanes).toEqual([]);
  });

  it('keeps every parent in a wide octopus merge', () => {
    const parents = Array.from({ length: 100 }, (_, index) => `p${index}`);
    const graph = layoutGraph([commit('m', ...parents), ...parents.map(parent => commit(parent))]);
    expect(graph.laneCount).toBe(100);
    expect(new Set(graph.rows[0].segments.map(segment => segment.toLane)).size).toBe(100);
    expect(graph.rows.slice(1).map(row => row.lane)).toEqual(parents.map((_, index) => index));
    expect(graph.endState.lanes).toEqual([]);
  });
});
