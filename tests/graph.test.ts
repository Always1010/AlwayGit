import { describe, expect, it } from 'vitest';
import type { Commit } from '../src/protocol/types';
import { layoutGraph } from '../webview/graph/layout';
import { graphPalettes } from '../webview/graph/palettes';

function commit(oid: string, ...parents: string[]): Commit {
  return { oid, parents, author: 'A', email: 'a@example.com', timestamp: 0, subject: oid };
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const first = luminance(foreground), second = luminance(background);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

describe('Git history graph', () => {
  it('connects linear ancestry and terminates a root without phantom edges', () => {
    const graph = layoutGraph([commit('c', 'b'), commit('b', 'a'), commit('a')]);
    expect(graph.rows.map(row => row.lane)).toEqual([0, 0, 0]);
    expect(graph.rows.map(row => row.hasIncoming)).toEqual([false, true, true]);
    expect(graph.rows[1].segments).toEqual([
      { fromLane: 0, toLane: 0, from: 'top', to: 'middle', color: 0, kind: 'incoming', target: 'b', pathId: 'c' },
      { fromLane: 0, toLane: 0, from: 'middle', to: 'bottom', color: 0, kind: 'parent', target: 'a', pathId: 'c' },
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
    const bColor = graph.rows[0].segments.find(segment => segment.target === 'b')!.color;
    const parents = graph.rows[1].segments.filter(segment => segment.kind === 'parent');
    expect(parents).toMatchObject([
      { fromLane: 0, toLane: 1, from: 'middle', to: 'bottom', color: bColor, kind: 'parent', target: 'b', pathId: 'b' },
      { fromLane: 0, toLane: 0, from: 'middle', to: 'bottom', kind: 'parent', target: 'c', pathId: 'c' },
    ]);
    expect(parents[1].color).not.toBe(bColor);
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

  it('joins independent selected branch tips at one common ancestor across pages', () => {
    // git log --topo-order over several tips emits their reachable union once.
    const history = [commit('left-tip', 'left'), commit('right-tip', 'right'),
      commit('left', 'base'), commit('right', 'base'), commit('base', 'root'), commit('root')];
    const whole = layoutGraph(history);
    expect(whole.rows.filter(row => row.oid === 'base')).toHaveLength(1);
    expect(whole.rows[3].segments.find(segment => segment.kind === 'parent')).toMatchObject({
      target: 'base', toLane: whole.rows[4].lane,
    });
    let state = undefined as Parameters<typeof layoutGraph>[1];
    const pagedRows = [] as typeof whole.rows;
    for (const commitRow of history) {
      const page = layoutGraph([commitRow], state);
      pagedRows.push(...page.rows);
      state = page.endState;
    }
    expect(pagedRows).toEqual(whole.rows);
    expect(state).toEqual(whole.endState);
  });

  it('closes vacant lane gaps after merged paths end', () => {
    const graph = layoutGraph([
      commit('merge', 'first', 'second', 'third'),
      commit('first'), commit('second'), commit('third'),
    ]);
    expect(graph.rows.map(row => row.lane)).toEqual([0, 0, 0, 0]);
    expect(graph.rows[1].segments.filter(segment => segment.kind === 'through').map(segment => [segment.fromLane, segment.toLane])).toEqual([[1, 0], [2, 1]]);
    expect(graph.endState.lanes).toEqual([]);
  });

  it('never retargets an omitted search-result parent to an unrelated visible commit', () => {
    const first = layoutGraph([commit('match-one', 'omitted-parent')]);
    const second = layoutGraph([commit('match-two')], first.endState);
    expect(second.rows[0].hasIncoming).toBe(false);
    expect(second.rows[0].lane).toBe(1);
    expect(second.rows[0].segments).toEqual([
      { fromLane: 0, toLane: 0, from: 'top', to: 'bottom', color: 0,
        kind: 'through', target: 'omitted-parent', pathId: 'match-one' },
    ]);
    expect(second.endState.lanes).toEqual([{ oid: 'omitted-parent', color: 0, pathId: 'match-one' }]);
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
    expect(graph.rows.slice(1).map(row => row.lane)).toEqual(parents.map(() => 0));
    expect(graph.endState.lanes).toEqual([]);
  });

  it('gives every simultaneous path a unique color until each palette fills', () => {
    for (const palette of graphPalettes) {
      const parents = palette.light.map((_, index) => `p${index}`);
      const graph = layoutGraph([commit('merge', ...parents)], undefined, palette.id);
      expect(new Set(graph.rows[0].segments.map(segment => segment.color)).size).toBe(parents.length);
      expect(graph.endState.paletteId).toBe(palette.id);
      expect(graph.endState.paletteSize).toBe(parents.length);
      expect(palette.dark).toHaveLength(parents.length);
      expect(palette.light.every(color => contrastRatio(color, '#FFFFFF') >= 3)).toBe(true);
      expect(palette.dark.every(color => contrastRatio(color, '#1B222D') >= 3)).toBe(true);
    }
  });

  it('reuses retired colors and avoids equal neighboring lanes after capacity', () => {
    const parents = Array.from({ length: 8 }, (_, index) => `p${index}`);
    const first = layoutGraph([commit('merge', ...parents)], undefined, 'distinct');
    const retired = first.endState.lanes.slice(1).map(lane => lane!.color);
    const next = layoutGraph([...parents.slice(1).map(parent => commit(parent)), commit('new-tip', 'new-parent')], first.endState);
    const newColor = next.rows.at(-1)!.color;
    expect(retired).toContain(newColor);
    expect(newColor).not.toBe(first.endState.lanes[0]!.color);
    const wide = layoutGraph([commit('wide', ...Array.from({ length: 24 }, (_, index) => `w${index}`))], undefined, 'distinct');
    const colors = wide.endState.lanes.map(lane => lane!.color);
    expect(colors.every(color => color >= 0 && color < 8)).toBe(true);
    for (let index = 1; index < colors.length; index++) expect(colors[index]).not.toBe(colors[index - 1]);
  });

  it('preserves lineage, cursor and colors across pages and resets for a new palette', () => {
    const history = [commit('merge', 'left', 'right'), commit('left', 'base'), commit('right', 'base'), commit('base')];
    const whole = layoutGraph(history, undefined, 'extended');
    const first = layoutGraph(history.slice(0, 2), undefined, 'extended');
    const second = layoutGraph(history.slice(2), first.endState);
    expect([...first.rows, ...second.rows]).toEqual(whole.rows);
    expect(second.endState).toEqual(whole.endState);
    expect(whole.rows[1].pathId).toBe(whole.rows[0].pathId);
    expect(whole.rows[2].segments.find(segment => segment.kind === 'parent')!.pathId).toBe(whole.rows[3].pathId);
    const switched = layoutGraph(history, first.endState, 'distinct');
    expect(switched).toEqual(layoutGraph(history, undefined, 'distinct'));
  });
});
