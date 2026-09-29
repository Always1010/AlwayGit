import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import type { Commit } from '../src/protocol/types';
import { layoutGraph, type GraphState } from '../webview/graph/layout';

it('bounds graph page work over 100,000 seeded interleaved commits', () => {
  const count = 100_000;
  const pageSize = 500;
  const commits: Commit[] = [];
  let seed = 0x12345678;
  for (let index = 0; index < count; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const parents = index + 1 < count ? [`c${index + 1}`] : [];
    const side = index + 2 + seed % 30;
    if (seed % 11 === 0 && side < count) parents.push(`c${side}`);
    commits.push({ oid: `c${index}`, parents, author: 'Seeded', email: 'bench@example.com', timestamp: count - index, subject: `Commit ${index}` });
  }
  let state: GraphState | undefined;
  let maxLanes = 0;
  let totalRows = 0;
  let totalSegments = 0;
  const durations: number[] = [];
  const start = performance.now();
  for (let offset = 0; offset < count; offset += pageSize) {
    const pageStart = performance.now();
    const page = layoutGraph(commits.slice(offset, offset + pageSize), state);
    durations.push(performance.now() - pageStart);
    expect(page.rows.length).toBeLessThanOrEqual(pageSize);
    maxLanes = Math.max(maxLanes, page.laneCount);
    totalRows += page.rows.length;
    totalSegments += page.rows.reduce((total, row) => total + row.segments.length, 0);
    state = page.endState;
  }
  durations.sort((a, b) => a - b);
  expect(totalRows).toBe(count);
  expect(maxLanes).toBeLessThanOrEqual(32);
  expect(state?.lanes).toEqual([]);
  console.info(JSON.stringify({ benchmark: 'graph-100k-paged', commits: count, pageSize, maxLanes, totalSegments, totalMs: +(performance.now() - start).toFixed(2), medianPageMs: +durations[Math.floor(durations.length / 2)].toFixed(2), p95PageMs: +durations[Math.floor(durations.length * .95)].toFixed(2), maxPageMs: +durations[durations.length - 1].toFixed(2) }));
}, 15_000);
