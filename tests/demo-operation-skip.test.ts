import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Snapshot } from '../src/protocol/types';
import { actionSchema } from '../src/protocol/validation';
import { createDemoRequest } from '../webview/demo';
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { search: '?demo=1' });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
// Seed only the existing Demo model during construction; production needs no test scenario.
function pausedDemo() {
  const clone = structuredClone;
  const seed = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value) => {
    const result = clone(value);
    if (result && typeof result === 'object' && 'operation' in result) {
      const snapshot = result as Snapshot;
      snapshot.operation = {
        kind: 'rebase',
        conflicts: 1,
        canContinue: false,
        canAbort: true,
        canSkip: true,
        managedRebase: {
          backupRef: 'refs/alwaygit/rebase-backups/demo-test',
          step: 1,
          total: 2,
          pause: 'conflict',
        },
      };
    }
    return result;
  });
  try {
    return createDemoRequest(() => {});
  } finally {
    seed.mockRestore();
  }
}
it('keeps Demo Skip enabled across refreshes and advances its identity with each paused step', async () => {
  const request = pausedDemo();
  const call = async (method: 'snapshot' | 'action', payload?: unknown, repo = 'demo-alwaygit') => {
    const result = request(method, payload, repo);
    await vi.advanceTimersByTimeAsync(110);
    return (await result) as Snapshot;
  };
  const first = await call('snapshot'),
    repeated = await call('snapshot');
  expect(first.operation.skipToken).toMatch(/^[a-f0-9]{64}$/);
  expect(repeated.operation.skipToken).toBe(first.operation.skipToken);
  const action = actionSchema.parse({
    type: 'operation.skip',
    kind: 'rebase',
    skipToken: first.operation.skipToken,
  });
  const next = await call('action', action);
  expect(next.operation.managedRebase?.step).toBe(2);
  expect(next.head).toBe(first.head);
  expect(next.operation.skipToken).not.toBe(first.operation.skipToken);
  const pending = request('action', action, 'demo-alwaygit');
  const rejection = expect(pending).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
  await vi.advanceTimersByTimeAsync(110);
  await rejection;
  expect(await call('snapshot')).toEqual({
    ...next,
    remoteDestinations: { origin: 'd'.repeat(64) },
    remoteReadDestinations: { origin: 'demo:origin' },
  });
  const completed = await call('action', { ...action, skipToken: next.operation.skipToken });
  expect(completed.operation.kind).toBeUndefined();
  expect(completed.operation.skipToken).toBeUndefined();
});
it('rejects a Demo token captured in a different repository', async () => {
  const request = pausedDemo();
  const initial = request('snapshot', undefined, 'demo-alwaygit');
  await vi.advanceTimersByTimeAsync(110);
  const token = ((await initial) as Snapshot).operation.skipToken;
  const pending = request(
    'action',
    { type: 'operation.skip', kind: 'rebase', skipToken: token },
    'demo-website',
  );
  const rejection = expect(pending).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
  await vi.advanceTimersByTimeAsync(110);
  await rejection;
  const remaining = request('snapshot', undefined, 'demo-website');
  await vi.advanceTimersByTimeAsync(110);
  expect(((await remaining) as Snapshot).operation.managedRebase?.step).toBe(1);
});
