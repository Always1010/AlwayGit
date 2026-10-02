import { expect, it, vi } from 'vitest';
import { SnapshotCoordinator } from '../src/application/snapshot-coordinator';
import type { Snapshot } from '../src/protocol/types';

it('shares overlapping reads only until invalidation and keeps worktrees separate', async () => {
  const coordinator = new SnapshotCoordinator();
  let finish!: (snapshot: Snapshot) => void;
  const query = vi.fn(() => new Promise<Snapshot>(resolve => { finish = resolve; }));
  const first = coordinator.read('a', query), duplicate = coordinator.read('a', query);
  expect(first).toBe(duplicate);
  await Promise.resolve(); const oldFinish = finish;
  coordinator.invalidate('a');
  const afterWrite = coordinator.read('a', query), worktree = coordinator.read('b', query);
  await Promise.resolve();
  expect(query).toHaveBeenCalledTimes(3);
  expect(afterWrite).not.toBe(first); expect(worktree).not.toBe(afterWrite);
  oldFinish({ version: 1 } as Snapshot); await first; await Promise.resolve();
  expect(coordinator.read('a', query)).toBe(afterWrite);
});
