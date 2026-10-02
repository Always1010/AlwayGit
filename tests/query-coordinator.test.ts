import { describe, expect, it, vi } from 'vitest';
import { QueryCoordinator } from '../src/application/query-coordinator';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe('read query coordination', () => {
  it('cancels replaced reads but keeps the concurrency slot until the running task finishes', async () => {
    const coordinator = new QueryCoordinator(1), owner = {}, running = deferred<string>();
    let signal!: AbortSignal;
    const first = coordinator.run(owner, 'history', 'old', incoming => { signal = incoming; return running.promise; });
    const rejected = expect(first).rejects.toMatchObject({ code: 'ABORTED' }); await settle();
    const task = vi.fn(async () => 'new'), second = coordinator.run(owner, 'history', 'new', task);
    await rejected; expect(signal.aborted).toBe(true); await settle(); expect(task).not.toHaveBeenCalled();
    running.resolve('obsolete'); await expect(second).resolves.toBe('new'); expect(task).toHaveBeenCalledOnce(); coordinator.dispose();
  });
  it('drops a cancelled queued read before any work starts', async () => {
    const coordinator = new QueryCoordinator(1), active = deferred<string>();
    const first = coordinator.run({}, 'history', 'active', () => active.promise); await settle();
    const owner = {}, task = vi.fn(async () => 'queued'), queued = coordinator.run(owner, 'diff', 'queued', task);
    const rejected = expect(queued).rejects.toMatchObject({ code: 'ABORTED' }); coordinator.cancelOwner(owner, 'queued'); await rejected;
    active.resolve('done'); await first; await settle(); expect(task).not.toHaveBeenCalled(); coordinator.dispose();
  });
  it('isolates panels and rejects cancellation aimed at another panel request', async () => {
    const coordinator = new QueryCoordinator(2), left = {}, right = {}, pending = deferred<string>();
    let signal!: AbortSignal;
    const read = coordinator.run(right, 'details', 'same-id', incoming => { signal = incoming; return pending.promise; }); await settle();
    coordinator.cancelOwner(left, 'same-id'); expect(signal.aborted).toBe(false);
    pending.resolve('right'); await expect(read).resolves.toBe('right'); coordinator.dispose();
  });
  it('retains a slot for unconfirmed read termination until its known handles close', async () => {
    const coordinator = new QueryCoordinator(1), completion = deferred<void>();
    const first = coordinator.run({}, 'history', 'failed', async () => { throw Object.assign(new Error('cancelled'), { code: 'ABORTED', completion: completion.promise }); });
    const rejected = expect(first).rejects.toMatchObject({ code: 'ABORTED' }); await rejected;
    const task = vi.fn(async () => 'next'), second = coordinator.run({}, 'details', 'next', task); await settle(); expect(task).not.toHaveBeenCalled();
    completion.resolve(); await expect(second).resolves.toBe('next'); coordinator.dispose();
  });
  it('aborts active and queued reads when disposed', async () => {
    const coordinator = new QueryCoordinator(1), pending = deferred<string>(); let signal!: AbortSignal;
    const active = coordinator.run({}, 'history', 'active', incoming => { signal = incoming; return pending.promise; }); await settle();
    const task = vi.fn(async () => 'queued'), queued = coordinator.run({}, 'diff', 'queued', task);
    const activeRejected = expect(active).rejects.toMatchObject({ code: 'ABORTED' }), queuedRejected = expect(queued).rejects.toMatchObject({ code: 'ABORTED' });
    coordinator.dispose(); await Promise.all([activeRejected, queuedRejected]); expect(signal.aborted).toBe(true);
    pending.resolve('obsolete'); await settle(); expect(task).not.toHaveBeenCalled();
  });
});
