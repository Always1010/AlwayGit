import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Commit, HostMessage, Repository, Snapshot } from '../src/protocol/types';
const bridge = vi.hoisted(() => ({ rpc: vi.fn(), save: vi.fn(), event: undefined as ((message: HostMessage) => void) | undefined }));
vi.mock('../webview/rpc', () => ({ demoMode: false, readSession: () => ({}), saveSession: bridge.save, rpc: bridge.rpc, subscribe: (listener: (message: HostMessage) => void) => { bridge.event = listener; return () => {}; } }));
const a: Repository = { id: 'a', root: '/a', commonDir: '/a/.git', name: 'A' };
const b: Repository = { id: 'b', root: '/b', commonDir: '/b/.git', name: 'B' };
const commit: Commit = { oid: 'abc', parents: [], author: 'Test', email: 'test@example.com', timestamp: 0, subject: 'Example' };
function snapshot(repository: Repository, version = 1): Snapshot { return { repository, branch: 'main', head: commit.oid, ahead: 0, behind: 0, changes: [], refs: [], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
let store: (typeof import('../webview/store'))['useWorkbench'];
beforeEach(async () => {
  vi.resetModules(); bridge.rpc.mockReset(); bridge.save.mockReset();
  bridge.rpc.mockImplementation(async (method: string, repoId?: string) => {
    if (method === 'snapshot') return snapshot(repoId === 'b' ? b : a);
    if (method === 'history') return { commits: [commit], nextOffset: 1, hasMore: false, tips: ['fixed-tip'] };
    if (method === 'details') return { commit, body: commit.subject, files: [] };
    if (method === 'repositories') return [a, b];
    return undefined;
  });
  store = (await import('../webview/store')).useWorkbench;
});
describe('repository UI consistency', () => {
  it('ignores delayed status responses after switching repositories', async () => {
    const delayed = deferred<Snapshot>();
    const fallback = bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method, repoId, payload) => method === 'snapshot' && repoId === 'a' ? delayed.promise : fallback(method, repoId, payload));
    const old = store.getState().selectRepository('a');
    await store.getState().selectRepository('b');
    delayed.resolve(snapshot(a)); await old;
    expect(store.getState().repoId).toBe('b'); expect(store.getState().snapshot?.repository.id).toBe('b');
  });
  it('pins appended history to the first page tips even when branches move', async () => {
    await store.getState().selectRepository('a');
    await store.getState().loadHistory(true);
    const calls = bridge.rpc.mock.calls.filter(([method]) => method === 'history');
    expect(calls.at(-1)?.[2]).toMatchObject({ offset: 1, tips: ['fixed-tip'] });
  });
  it('preserves independent drafts and view state across repository switches', async () => {
    await store.getState().selectRepository('a'); store.getState().setDraft('Draft A'); store.setState({ tab: 'changes' });
    await store.getState().selectRepository('b'); store.getState().setDraft('Draft B');
    await store.getState().selectRepository('a');
    expect(store.getState().drafts).toEqual({ a: 'Draft A', b: 'Draft B' }); expect(store.getState().tab).toBe('changes');
    expect(bridge.save.mock.calls.at(-1)?.[0]).toMatchObject({ repoId: 'a', drafts: { a: 'Draft A', b: 'Draft B' } });
  });
  it('keeps controls busy when host activity ends before the action response arrives', async () => {
    await store.getState().selectRepository('a'); const pending = deferred<void>();
    const fallback = bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method, repoId, payload) => method === 'action' ? pending.promise : fallback(method, repoId, payload));
    const operation = store.getState().execute({ type: 'fetch' });
    bridge.event?.({ type: 'activity', repoId: 'a', busy: false, label: 'fetch' });
    expect(store.getState().busy).toBe(true);
    pending.resolve(); await operation;
    expect(store.getState().busy).toBe(false);
  });
});
