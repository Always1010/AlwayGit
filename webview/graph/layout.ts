import type { Commit } from '../../src/protocol/types';

/** A lane reserves a path to a parent that has not been rendered yet. */
export interface GraphLane {
  oid: string;
  color: number;
}

export interface GraphState {
  lanes: readonly (GraphLane | null)[];
  nextColor: number;
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
}

export interface GraphLayoutRow {
  oid: string;
  lane: number;
  color: number;
  laneCount: number;
  parents: readonly string[];
  hasIncoming: boolean;
  segments: readonly GraphSegment[];
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
export function layoutGraph(commits: readonly Commit[], previousState?: GraphState): GraphLayout {
  const lanes: (GraphLane | null)[] = previousState
    ? previousState.lanes.map(lane => lane ? { ...lane } : null)
    : [];
  let nextColor = previousState?.nextColor ?? 0;
  let laneCount = lanes.length;
  const rows: GraphLayoutRow[] = [];

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
      lanes[nodeLane] = { oid: commit.oid, color: nextColor++ };
    }
    const nodeColor = lanes[nodeLane]!.color;
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
          color: parentIndex === 0 ? nodeColor : nextColor++,
        };
        targetLanes.set(parent, parentLane);
      }
      parentSegments.push({
        fromLane: nodeLane, toLane: parentLane, from: 'middle', to: 'bottom',
        color: lanes[parentLane]!.color, kind: 'parent', target: parent,
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
      });
    }
    segments.push(...parentSegments);

    const rowLaneCount = Math.max(top.length, lanes.length, nodeLane + 1);
    laneCount = Math.max(laneCount, rowLaneCount);
    rows.push({
      oid: commit.oid, lane: nodeLane, color: nodeColor,
      laneCount: rowLaneCount, parents, hasIncoming, segments,
    });
    // Only remove trailing vacant slots: retained lane positions must agree
    // exactly across row and page boundaries.
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
  }

  return { rows, endState: { lanes, nextColor }, laneCount };
}
