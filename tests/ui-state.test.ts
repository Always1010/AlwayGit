import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
afterEach(() => { vi.useRealTimers(); });
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
    expect(bridge.save.mock.calls.at(-1)?.[0]).toMatchObject({version:2,language:'zh-CN',layout:{preset:'workbench',sidebar:240,details:320}});
    expect(bridge.rpc.mock.calls.some(([method])=>method==='action')).toBe(false);
  });
  it('previews settings without persisting them and rolls back while preserving live data', async () => {
    await store.getState().selectRepository('a'); store.getState().setDraft('keep my draft');
    const original = store.getState(), target = original.diffTarget;
    original.beginSettings();
    store.getState().previewSettings({ language: 'zh-CN', font: 16, row: 28, appearance: { theme: 'light', palette: 'extended', codeFont: 18 } });
    expect(store.getState().appearance.palette).toBe('extended');
    expect(bridge.save.mock.calls.at(-1)?.[0]).toMatchObject({ language: original.language, layout: original.layout, appearance: original.appearance });
    // A background refresh/save during preview must still persist committed settings.
    await store.getState().refresh();
    expect(bridge.save.mock.calls.at(-1)?.[0].appearance).toEqual(original.appearance);
    store.getState().finishSettings(false);
    expect(store.getState()).toMatchObject({ language: original.language, layout: original.layout, appearance: original.appearance, drafts: { a: 'keep my draft' }, diffTarget: target });
  });
  it('applies settings through host session validation and restores only panel geometry', async () => {
    const { sessionSchema } = await import('../src/protocol/validation');
    store.getState().beginSettings();
    store.getState().previewSettings({ language: 'zh-CN', font: 15, row: 28, appearance: { theme: 'contrast', palette: 'distinct', codeFont: 17 } });
    store.getState().finishSettings(true);
    const saved = bridge.save.mock.calls.at(-1)?.[0];
    expect(sessionSchema.parse(saved).appearance).toMatchObject({ theme: 'contrast', palette: 'distinct', codeFont: 17 });
    expect(saved.appearance.colors.light).toHaveLength(8);
    expect(saved.appearance.colors.dark).toHaveLength(8);
    store.getState().setLayout({ sidebar: 260, details: 350 }); store.getState().restoreLayout();
    expect(store.getState()).toMatchObject({ language: 'zh-CN', layout: { sidebar: 210, details: 300, font: 15, row: 28 }, appearance: saved.appearance });
    expect(store.getState().settingsBaseline).toBeUndefined();
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

  it('shows Push running with its target, then retains success until dismissed', async () => {
    await store.getState().selectRepository('a'); const pending = deferred<void>(), fallback = bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method, repoId, payload) => method === 'action' ? pending.promise : fallback(method, repoId, payload));
    const pushing = store.getState().execute({ type: 'push', branch: 'main', remote: 'origin', remoteBranch: 'release' });
    expect(store.getState().actionFeedback).toMatchObject({ status: 'running', target: 'main → origin/release' });
    bridge.event?.({ type: 'activity', repoId: 'a', busy: false, label: '' });
    expect(store.getState().actionFeedback?.status).toBe('running');
    store.getState().dismissFeedback(); expect(store.getState().actionFeedback?.status).toBe('running');
    pending.resolve(); await pushing;
    expect(store.getState().actionFeedback?.status).toBe('success');
    await store.getState().refresh({ background: true }); expect(store.getState().actionFeedback?.status).toBe('success');
    store.getState().dismissFeedback(); expect(store.getState().actionFeedback).toBeUndefined();
  });

  it('retains failed action details and refreshes conflicts after failure', async () => {
    await store.getState().selectRepository('a'); const fallback = bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method, repoId, payload) => {
      if (method === 'action') return Promise.reject(new Error('CONFLICT: resolve a.txt'));
      if (method === 'snapshot') return Promise.resolve({ ...snapshot(a, 2), operation: { kind: 'cherry-pick', conflicts: 1, canContinue: false, canAbort: true, canSkip: true } });
      return fallback(method, repoId, payload);
    });
    expect(await store.getState().execute({ type: 'cherry-pick', commits: ['abc'] })).toBe(false);
    expect(store.getState().actionFeedback).toMatchObject({ status: 'error', error: 'CONFLICT: resolve a.txt' });
    expect(store.getState().snapshot?.operation.conflicts).toBe(1);
    store.getState().dismissFeedback(); expect(store.getState().error).toBeUndefined();
  });

  it('isolates operation feedback by repository and completes it after returning', async () => {
    await store.getState().selectRepository('a'); const pending = deferred<void>(), fallback = bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method, repoId, payload) => method === 'action' ? pending.promise : fallback(method, repoId, payload));
    const operation = store.getState().execute({ type: 'push', remote: 'origin' });
    await store.getState().selectRepository('b'); expect(store.getState().actionFeedback).toBeUndefined();
    await store.getState().selectRepository('a'); expect(store.getState().actionFeedback?.status).toBe('running');
    pending.resolve(); await operation;
    expect(store.getState().actionFeedback?.status).toBe('success'); expect(store.getState().busy).toBe(false);
  });

  it('keeps historical details, file and Merge Parent when working files or refs change', async () => {
    const merge = { ...commit, parents: ['first', 'second'] }, fallback = bridge.rpc.getMockImplementation()!;
    let head = commit.oid;
    bridge.rpc.mockImplementation((method, repoId, payload) => {
      if (method === 'snapshot') return Promise.resolve({ ...snapshot(a, 2), head, refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: head }] });
      if (method === 'details') return Promise.resolve({ commit: merge, body: 'Merge', parent: payload.parent ?? 'first', files: [{ path: 'a.txt', status: 'M' }, { path: 'b.txt', status: 'M' }] });
      return fallback(method, repoId, payload);
    });
    await store.getState().selectRepository('a');
    await store.getState().selectCommit(commit.oid, 'second');
    store.getState().selectFile({ kind: 'commit', oid: commit.oid, parent: 'second', path: 'b.txt' });
    const details = store.getState().details, target = store.getState().diffTarget;
    bridge.rpc.mockClear();
    await store.getState().refresh({ background: true, changes: { paths: ['unrelated.txt'] } });
    expect(bridge.rpc.mock.calls.map(([method]) => method)).toEqual(['snapshot']);
    head = 'new-head';
    await store.getState().refresh({ background: true, changes: { paths: [] } });
    expect(bridge.rpc.mock.calls.map(([method]) => method)).toEqual(['snapshot', 'snapshot', 'history']);
    expect(store.getState().details).toBe(details); expect(store.getState().diffTarget).toBe(target);
    expect(store.getState().detailsLoading).toBe(false); expect(store.getState().selectedParent).toBe('second');
    await store.getState().refresh();
    expect(bridge.rpc.mock.calls.filter(([method]) => method === 'details')).toHaveLength(0);
    expect(bridge.save.mock.calls.at(-1)?.[0].views.a.selectedParent).toBe('second');
  });

  it('restores the selected Merge Parent after switching repositories', async () => {
    const fallback = bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method, repoId, payload) => method === 'details'
      ? Promise.resolve({ commit: { ...commit, parents: ['first', 'second'] }, body: 'Merge', files: [], parent: payload.parent ?? 'first' }) : fallback(method, repoId, payload));
    await store.getState().selectRepository('a'); await store.getState().selectCommit(commit.oid, 'second');
    await store.getState().selectRepository('b'); bridge.rpc.mockClear(); await store.getState().selectRepository('a');
    expect(bridge.rpc.mock.calls.find(([method]) => method === 'details')?.[2]).toMatchObject({ parent: 'second' });
  });

  it('does not restart details that are still loading during an automatic refresh', async () => {
    const pending = deferred<unknown>(), fallback = bridge.rpc.getMockImplementation()!;
    await store.getState().selectRepository('a');
    bridge.rpc.mockImplementation((method, repoId, payload) => method === 'details' ? pending.promise : fallback(method, repoId, payload));
    const selecting = store.getState().selectCommit('different'); bridge.rpc.mockClear();
    await store.getState().refresh();
    expect(bridge.rpc.mock.calls.filter(([method]) => method === 'details')).toHaveLength(0);
    pending.resolve({ commit: { ...commit, oid: 'different' }, body: 'body', files: [] }); await selecting;
    expect(store.getState().selectedOid).toBe('different'); expect(store.getState().details?.commit.oid).toBe('different');
  });

  async function workingFixture() {
    const fallback = bridge.rpc.getMockImplementation()!;
    const current: Snapshot = { ...snapshot(a), changes: [{ path: 'a.txt', indexStatus: 'M', worktreeStatus: 'M', conflict: false, untracked: false }, { path: 'b.txt', indexStatus: ' ', worktreeStatus: 'M', conflict: false, untracked: false }] };
    bridge.rpc.mockImplementation((method, repoId, payload) => method === 'snapshot' ? Promise.resolve(structuredClone(current)) : fallback(method, repoId, payload));
    await store.getState().selectRepository('a'); store.getState().selectWorking(); bridge.rpc.mockClear();
    return current;
  }

  it('updates the selected working file even when its dirty status stays unchanged', async () => {
    await workingFixture(); const revision = store.getState().diffRevision, target = store.getState().diffTarget;
    await store.getState().refresh({ background: true, changes: { paths: ['b.txt'] } });
    expect(store.getState().diffRevision).toBe(revision); expect(store.getState().diffTarget).toBe(target);
    await store.getState().refresh({ background: true, changes: { paths: ['a.txt'] } });
    expect(store.getState().diffRevision).toBe(revision + 1); expect(store.getState().diffTarget).toBe(target);
    expect(bridge.rpc.mock.calls.map(([method]) => method)).toEqual(['snapshot', 'snapshot']);
  });

  it('preserves Staged selection and ignores working-file edits until Index or HEAD changes', async () => {
    const current = await workingFixture(); store.getState().selectFile({ kind: 'change', path: 'a.txt', area: 'staged' });
    const revision = store.getState().diffRevision;
    await store.getState().refresh({ background: true, changes: { paths: ['a.txt'] } });
    expect(store.getState().diffTarget).toMatchObject({ area: 'staged' }); expect(store.getState().diffRevision).toBe(revision);
    await store.getState().refresh({ background: true, changes: { paths: [], index: true } });
    expect(store.getState().diffRevision).toBe(revision + 1);
    current.head = 'different'; await store.getState().refresh({ background: true, changes: { paths: [] } });
    expect(store.getState().diffRevision).toBe(revision + 2); expect(store.getState().diffTarget).toMatchObject({ area: 'staged' });
  });

  it('updates poll-detected changes and falls back when the selected comparison disappears', async () => {
    const current = await workingFixture();
    store.getState().selectFile({ kind: 'change', path: 'a.txt', area: 'staged' });
    current.changes[0].indexStatus = ' ';
    await store.getState().refresh({ background: true, changes: { paths: [] } });
    expect(store.getState().diffTarget).toMatchObject({ path: 'a.txt', area: 'unstaged' });
    current.changes.splice(0, 1); await store.getState().refresh({ background: true, changes: { paths: [] } });
    expect(store.getState().diffTarget).toMatchObject({ path: 'b.txt' });
    current.changes = []; await store.getState().refresh({ background: true, changes: { paths: [] } });
    expect(store.getState().diffTarget).toBeUndefined(); expect(store.getState().selectedFile).toBeUndefined();
  });

  it('merges file invalidation across overlapping snapshot requests', async () => {
    await workingFixture(); const pending = deferred<Snapshot>(), fallback = bridge.rpc.getMockImplementation()!;
    let first = true;
    bridge.rpc.mockImplementation((method, repoId, payload) => { if (method === 'snapshot' && first) { first = false; return pending.promise; } return fallback(method, repoId, payload); });
    const revision = store.getState().diffRevision;
    const old = store.getState().refresh({ background: true, changes: { paths: ['a.txt'] } });
    await store.getState().refresh({ background: true, changes: { paths: ['b.txt'] } });
    pending.resolve(snapshot(a)); await old;
    expect(store.getState().diffRevision).toBe(revision + 1);
  });

  it('merges debounced file events without losing the selected file or unknown changes', async () => {
    await workingFixture(); vi.useFakeTimers(); const revision = store.getState().diffRevision;
    bridge.event?.({ type: 'changed', repoId: 'a', changes: { paths: ['a.txt'] } });
    bridge.event?.({ type: 'changed', repoId: 'a', changes: { paths: ['b.txt'] } });
    await vi.advanceTimersByTimeAsync(160);
    expect(bridge.rpc.mock.calls.map(([method]) => method)).toEqual(['snapshot']); expect(store.getState().diffRevision).toBe(revision + 1);
    bridge.event?.({ type: 'changed', repoId: 'a' }); bridge.event?.({ type: 'changed', repoId: 'a', changes: { paths: ['b.txt'] } });
    await vi.advanceTimersByTimeAsync(160); expect(store.getState().diffRevision).toBe(revision + 2);
  });

  it('does not apply a debounced repository event to a newly selected repository', async () => {
    await store.getState().selectRepository('a'); vi.useFakeTimers();
    bridge.event?.({ type: 'changed', repoId: 'a', changes: { paths: ['a.txt'] } });
    await store.getState().selectRepository('b'); bridge.rpc.mockClear(); await vi.advanceTimersByTimeAsync(160);
    expect(bridge.rpc).not.toHaveBeenCalled();
  });
});
