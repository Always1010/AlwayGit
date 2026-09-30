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
  it('passes a selected ref union and preserves an explicitly empty selection', async () => {
    await store.getState().selectRepository('a');
    store.getState().setCheckedRefs(['refs/heads/main','refs/heads/topic','refs/heads/main']);
    await store.getState().loadHistory();
    expect(bridge.rpc.mock.calls.filter(([method])=>method==='history').at(-1)?.[2]).toMatchObject({tips:['refs/heads/main','refs/heads/topic']});
    store.getState().setCheckedRefs([]);await store.getState().refresh();
    expect(store.getState().checkedRefs).toEqual([]);
    expect(bridge.rpc.mock.calls.filter(([method])=>method==='history').at(-1)?.[2]).toMatchObject({tips:[]});
  });
  it('changes language and layout without mutating repository selection or drafts', async () => {
    await store.getState().selectRepository('a');store.getState().setDraft('用户原文');
    const id=store.getState().selectedOid;
    store.getState().setLanguage('zh-CN');store.getState().setLayout({sidebar:240,details:320,preset:'editor'});
    expect(store.getState().selectedOid).toBe(id);expect(store.getState().drafts.a).toBe('用户原文');
    expect(bridge.save.mock.calls.at(-1)?.[0]).toMatchObject({version:2,language:'zh-CN',layout:{preset:'editor',sidebar:240,details:320}});
    expect(bridge.rpc.mock.calls.some(([method])=>method==='action')).toBe(false);
  });
  it('opens a two-commit comparison and selects its first changed file',async()=>{
    await store.getState().selectRepository('a');const left={...commit,oid:'left',subject:'Left'},right={...commit,oid:'right',subject:'Right'},fallback=bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method,repoId,payload)=>method==='compare'?Promise.resolve({left,right,files:[{path:'changed.txt',status:'M'}]}):fallback(method,repoId,payload));
    await store.getState().compareCommits(left.oid,right.oid);
    expect(store.getState().comparison).toMatchObject({left:{oid:'left'},right:{oid:'right'}});expect(store.getState().diffTarget).toEqual({kind:'comparison',left:'left',right:'right',path:'changed.txt'});
  });
  it('ignores operation success after switching during its refresh', async () => {
    await store.getState().selectRepository('a');const delayed=deferred<Snapshot>(),started=deferred<void>(),fallback=bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method,repoId,payload)=>{if(method==='snapshot'&&repoId==='a'){started.resolve();return delayed.promise;}return fallback(method,repoId,payload);});
    const operation=store.getState().execute({type:'branch.checkout',name:'topic'});await started.promise;
    await store.getState().selectRepository('b');delayed.resolve(snapshot(a));await operation;
    expect(store.getState().repoId).toBe('b');expect(store.getState().notice).toBeUndefined();expect(store.getState().busy).toBe(false);
  });
  it('clears busy when returning to a repository while its old operation completes', async () => {
    await store.getState().selectRepository('a');const pending=deferred<void>(),fallback=bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method,repoId,payload)=>method==='action'?pending.promise:fallback(method,repoId,payload));
    const operation=store.getState().execute({type:'fetch'});await store.getState().selectRepository('b');await store.getState().selectRepository('a');expect(store.getState().busy).toBe(true);
    pending.resolve();await operation;expect(store.getState().busy).toBe(false);
  });
  it('clears disappeared Stash selection instead of resurrecting its old details', async () => {
    const fallback=bridge.rpc.getMockImplementation()!;let exists=true;
    bridge.rpc.mockImplementation((method,repoId,payload)=>method==='snapshot'?Promise.resolve({...snapshot(a),stashes:exists?[{selector:'stash@{0}',oid:commit.oid,subject:'WIP'}]:[]}):fallback(method,repoId,payload));
    await store.getState().selectRepository('a');await store.getState().selectCommit(commit.oid,undefined,commit.oid);expect(store.getState().selectedStashOid).toBe(commit.oid);
    exists=false;await store.getState().refresh();expect(store.getState().selectedStashOid).toBeUndefined();expect(store.getState().stashDetails).toBeUndefined();
  });
  it('ignores details arriving after Working Tree was selected', async () => {
    await store.getState().selectRepository('a');const pending=deferred<{commit:Commit;body:string;files:[]}>(),fallback=bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method,repoId,payload)=>method==='details'?pending.promise:fallback(method,repoId,payload));
    const selecting=store.getState().selectCommit(commit.oid);store.getState().selectWorking();pending.resolve({commit,body:'old',files:[]});await selecting;
    expect(store.getState().tab).toBe('changes');expect(store.getState().detailsLoading).toBe(false);
  });
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
