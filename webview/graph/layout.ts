import type { Commit } from '../../src/protocol/types';
import { getGraphPalette, paletteColorDistance, type GraphPaletteColors, type GraphPaletteId } from './palettes';

/** A lane reserves a path to a parent that has not been rendered yet. */
export interface GraphLane {
  oid: string;
  color: number;
  /** Stable across first-parent ancestry, independently of reusable colors. */
  pathId?: string;
}

export interface GraphState {
  lanes: readonly (GraphLane | null)[];
  nextColor: number;
  paletteId?: GraphPaletteId;
  paletteSize?: number;
  paletteKey?: string;
}

export interface GraphSegment {
  fromLane: number;
  toLane: number;
  from: 'top' | 'middle';
  to: 'middle' | 'bottom';
  color: number;
  kind: 'incoming' | 'parent' | 'through';
  /** The eventual commit at the end of this path. */
  target: string;
  pathId?: string;
}

export interface GraphLayoutRow {
  oid: string;
  lane: number;
  color: number;
  laneCount: number;
  parents: readonly string[];
  hasIncoming: boolean;
  segments: readonly GraphSegment[];
  pathId?: string;
}

export interface GraphLayout {
  rows: GraphLayoutRow[];
  endState: GraphState;
  laneCount: number;
}

/**
 * Lay out newest-first, topologically ordered Git history. Lanes remain in
 * fixed slots, so a virtualized row can render without inspecting its neighbors.
 * Pass endState into the next page; an empty page keeps pending parents intact.
 * Neither commits nor a caller's state is mutated.
 */
export function layoutGraph(commits: readonly Commit[], previousState?: GraphState, paletteId: GraphPaletteId = previousState?.paletteId ?? 'vivid', colors?: GraphPaletteColors): GraphLayout {
  const paletteSize = colors?.light.length ?? getGraphPalette(paletteId).light.length;
  const paletteKey = colors ? `${colors.light.join(',')}|${colors.dark.join(',')}` : paletteId;
  const prior = previousState && (!previousState.paletteId || previousState.paletteId === paletteId)
    && (!previousState.paletteSize || previousState.paletteSize === paletteSize)
    && (!previousState.paletteKey || previousState.paletteKey === paletteKey) ? previousState : undefined;
  const lanes: (GraphLane | null)[] = prior
    ? prior.lanes.map(lane => lane ? { ...lane, color: lane.color % paletteSize, pathId: lane.pathId ?? lane.oid } : null)
    : [];
  let nextColor = (prior?.nextColor ?? 0) % paletteSize;
  let laneCount = lanes.length;
  const rows: GraphLayoutRow[] = [];

  const allocateColor = (slot: number, source?: { lane: number; color: number }): number => {
    const active = lanes.flatMap((lane, index) => lane ? [{ lane: index, color: lane.color }] : []);
    if (source) active.push(source);
    const used = new Set(active.map(lane => lane.color));
    const left = active.filter(lane => lane.lane < slot).sort((a, b) => b.lane - a.lane)[0];
    const right = active.filter(lane => lane.lane > slot).sort((a, b) => a.lane - b.lane)[0];
    const neighbors = [left, right, source].filter((lane): lane is { lane: number; color: number } => !!lane);
    const crossing = source ? active.filter(lane => lane.lane >= Math.min(slot, source.lane) && lane.lane <= Math.max(slot, source.lane)) : [];
    const relevant = [...neighbors, ...crossing];
    let best = nextColor, bestScore = -Infinity;
    for (let offset = 0; offset < paletteSize; offset++) {
      const candidate = (nextColor + offset) % paletteSize;
      const separation = relevant.length ? Math.min(...relevant.map(lane => paletteColorDistance(paletteId, candidate, lane.color, colors))) : 0;
      const average = active.length ? active.reduce((sum, lane) => sum + paletteColorDistance(paletteId, candidate, lane.color, colors), 0) / active.length : 0;
      // Unused colors win first. Once exhausted, avoid equal neighbors and
      // crossing paths before maximizing perceptual separation in both themes.
      const equalNeighbors = neighbors.filter(lane => lane.color === candidate).length;
      const score = (used.has(candidate) ? 0 : 1000) - equalNeighbors * 100 + separation * 10 + average;
      if (score > bestScore) { bestScore = score; best = candidate; }
    }
    nextColor = (best + 1) % paletteSize;
    return best;
  };

  for (const commit of commits) {
    const top = lanes.slice();
    const targetLanes = new Map<string, number>();
    lanes.forEach((lane, index) => { if (lane) targetLanes.set(lane.oid, index); });
    const expectedLane = targetLanes.get(commit.oid) ?? -1;
    const hasIncoming = expectedLane !== -1;
    let nodeLane = expectedLane;
    if (nodeLane === -1) {
      nodeLane = lanes.indexOf(null);
      if (nodeLane === -1) nodeLane = lanes.length;
      lanes[nodeLane] = { oid: commit.oid, color: allocateColor(nodeLane), pathId: commit.oid };
    }
    const nodeColor = lanes[nodeLane]!.color;
    const nodePathId = lanes[nodeLane]!.pathId ?? commit.oid;
    lanes[nodeLane] = null;
    targetLanes.delete(commit.oid);
    const freeSlots: number[] = [];
    lanes.forEach((lane, index) => { if (!lane) freeSlots.push(index); });
    let nextFreeSlot = 0;
    const parents = [...new Set(commit.parents)];
    const parentSegments: GraphSegment[] = [];

    for (let parentIndex = 0; parentIndex < parents.length; parentIndex++) {
      const parent = parents[parentIndex];
      let parentLane = targetLanes.get(parent) ?? -1;
      if (parentLane === -1) {
        // The first-parent path stays in the node's lane when possible.
        if (parentIndex === 0) {
          parentLane = nodeLane;
        } else {
          while (nextFreeSlot < freeSlots.length && lanes[freeSlots[nextFreeSlot]]) nextFreeSlot++;
          parentLane = freeSlots[nextFreeSlot++] ?? lanes.length;
        }
        lanes[parentLane] = {
          oid: parent,
          color: parentIndex === 0 ? nodeColor : allocateColor(parentLane, { lane: nodeLane, color: nodeColor }),
          pathId: parentIndex === 0 ? nodePathId : parent,
        };
        targetLanes.set(parent, parentLane);
      }
      parentSegments.push({
        fromLane: nodeLane, toLane: parentLane, from: 'middle', to: 'bottom',
        color: lanes[parentLane]!.color, kind: 'parent', target: parent,
        pathId: lanes[parentLane]!.pathId,
      });
    }

    const segments: GraphSegment[] = [];
    for (let lane = 0; lane < top.length; lane++) {
      const pending = top[lane];
      if (!pending) continue;
      segments.push({
        fromLane: lane, toLane: lane, from: 'top',
        to: lane === nodeLane ? 'middle' : 'bottom',
        color: pending.color, kind: lane === nodeLane ? 'incoming' : 'through',
        target: pending.oid,
        pathId: pending.pathId,
      });
    }
    segments.push(...parentSegments);

    const rowLaneCount = Math.max(top.length, lanes.length, nodeLane + 1);
    laneCount = Math.max(laneCount, rowLaneCount);
    rows.push({
      oid: commit.oid, lane: nodeLane, color: nodeColor,
      laneCount: rowLaneCount, parents, hasIncoming, segments,
      pathId: nodePathId,
    });
    // Only remove trailing vacant slots: retained lane positions must agree
    // exactly across row and page boundaries.
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
  }

  return { rows, endState: { lanes, nextColor, paletteId, paletteSize, paletteKey }, laneCount };
}
