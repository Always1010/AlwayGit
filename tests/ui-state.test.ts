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
  it('starts without choosing the first repository and clears a removed active repository', async()=>{
    await store.getState().initialize();
    expect(store.getState().repoId).toBeUndefined();
    expect(bridge.rpc.mock.calls.some(([method])=>method==='snapshot')).toBe(false);
    await store.getState().selectRepository('a');
    const fallback=bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method,...args)=>method==='repositories'?Promise.resolve([b]):fallback(method,...args));
    await store.getState().initialize();
    expect(store.getState().repoId).toBeUndefined();
    expect(store.getState().snapshot).toBeUndefined();
    expect(store.getState().notice).toContain('removed');
  });
  it('inspects before Continue or an operation Commit and sends only the confirmed action',async()=>{
    await store.getState().selectRepository('a');
    store.setState({snapshot:{...snapshot(a),operation:{kind:'merge',conflicts:0,canContinue:true,canAbort:true,canSkip:false}}});
    const fallback=bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method,...args)=>method==='operationReview'?Promise.resolve({kind:'merge',token:'review',files:[{path:'a.txt',lines:[1,3,5]}]}):fallback(method,...args));
    expect(await store.getState().execute({type:'operation.continue',kind:'merge'})).toBe(false);
    expect(bridge.rpc.mock.calls.filter(([method])=>method==='action')).toHaveLength(0);
    expect(store.getState().operationReview?.review.files[0].lines).toEqual([1,3,5]);
    const pending=store.getState().operationReview!;
    expect(await store.getState().execute({...pending.action,reviewToken:pending.review.token})).toBe(true);
    expect(bridge.rpc.mock.calls.find(([method])=>method==='action')?.[2]).toMatchObject({reviewToken:'review'});
    store.setState({snapshot:{...snapshot(a),operation:{kind:'merge',conflicts:0,canContinue:true,canAbort:true,canSkip:false}}});
    await store.getState().execute({type:'commit',message:'bypass'});
    expect(store.getState().operationReview?.action.type).toBe('commit');
    await store.getState().selectRepository('b');expect(store.getState().operationReview).toBeUndefined();
  });
  it('ignores a review response after switching repositories',async()=>{
    await store.getState().selectRepository('a');const response=deferred<unknown>(),fallback=bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method,...args)=>method==='operationReview'?response.promise:fallback(method,...args));
    const action=store.getState().execute({type:'operation.continue',kind:'merge'});await store.getState().selectRepository('b');
    response.resolve({kind:'merge',token:'late',files:[]});await action;
    expect(store.getState().operationReview).toBeUndefined();expect(store.getState().busy).toBe(false);
  });
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
  it('uses host operation settings and keeps failed saves from enabling Detached Checkout', async () => {
    expect(store.getState().operationSettings.allowDetachedHead).toBe(false);
    bridge.rpc.mockImplementation(async (method: string) => {
      if (method === 'operationSettings') return { allowDetachedHead: true, scope: 'workspace' };
      throw new Error('Settings write failed');
    });
    await store.getState().loadOperationSettings();
    expect(store.getState().operationSettings.allowDetachedHead).toBe(true);
    bridge.event?.({ type: 'operationSettingsChanged', settings: { allowDetachedHead: false, scope: 'workspace' } });
    await expect(store.getState().saveOperationSettings(true)).rejects.toThrow('Settings write failed');
    expect(store.getState().operationSettings.allowDetachedHead).toBe(false);
    bridge.rpc.mockResolvedValue({ allowDetachedHead: true, scope: 'workspace' });
    await store.getState().saveOperationSettings(true);
    expect(store.getState().operationSettings.allowDetachedHead).toBe(true);
    expect(bridge.save.mock.calls.at(-1)?.[0]).not.toHaveProperty('allowDetachedHead');
  });
  it('previews settings without persisting them and rolls back while preserving live data', async () => {
    await store.getState().selectRepository('a'); store.getState().setDraft('keep my draft');
    const original = store.getState(), target = original.diffTarget;
    original.beginSettings();
    store.getState().previewSettings({ language: 'zh-CN', font: 16, row: 28, appearance: { theme: 'light', palette: 'extended', codeFont: 18, codeRowHeight: 24, fileSpacing: 5 } });
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
    store.getState().previewSettings({ language: 'zh-CN', font: 15, row: 28, appearance: { theme: 'contrast', palette: 'distinct', codeFont: 17, codeRowHeight: 23, fileSpacing: 6, badgeColor: '#006BFF' } });
    store.getState().finishSettings(true);
    const saved = bridge.save.mock.calls.at(-1)?.[0];
    expect(sessionSchema.parse(saved).appearance).toMatchObject({ theme: 'contrast', palette: 'distinct', codeFont: 17, codeRowHeight: 23, fileSpacing: 6, badgeColor: '#006BFF' });
    expect(saved.appearance.colors.light).toHaveLength(8);
    expect(saved.appearance.colors.dark).toHaveLength(8);
    store.getState().setLayout({ sidebar: 260, details: 350, diff: 900, diffCollapsed: true }); store.getState().restoreLayout();
    expect(store.getState()).toMatchObject({ language: 'zh-CN', layout: { sidebar: 210, details: 300, diff: 220, diffCollapsed: false, font: 15, row: 28 }, appearance: saved.appearance });
    expect(store.getState().settingsBaseline).toBeUndefined();
  });
  it('restores legacy Diff settings without losing the font and validates custom line heights', async () => {
    const { normalizeAppearance } = await import('../webview/appearance');
    const { sessionSchema } = await import('../src/protocol/validation');
    const legacy = { theme: 'light' as const, palette: 'vivid' as const, codeFont: 15 };
    expect(sessionSchema.safeParse({ appearance: legacy }).success).toBe(true);
    expect(normalizeAppearance(legacy)).toMatchObject({ theme: 'light', codeFont: 15, codeRowHeight: 18, fileSpacing: 1 });
    for (const codeRowHeight of [15, 37, 19.5]) {
      expect(sessionSchema.safeParse({ appearance: { ...legacy, codeRowHeight } }).success).toBe(false);
    }
    expect(normalizeAppearance({ ...legacy, codeRowHeight: NaN }).codeRowHeight).toBe(18);
    expect(normalizeAppearance({ ...legacy, codeRowHeight: 100 }).codeRowHeight).toBe(36);
    for (const fileSpacing of [-1, 9, 1.5]) {
      expect(sessionSchema.safeParse({ appearance: { ...legacy, fileSpacing } }).success).toBe(false);
    }
    expect(normalizeAppearance({ ...legacy, fileSpacing: NaN }).fileSpacing).toBe(1);
    expect(normalizeAppearance({ ...legacy, fileSpacing: 100 }).fileSpacing).toBe(8);
  });
  it('opens and preserves a comparison when exactly two commits are selected',async()=>{
    await store.getState().selectRepository('a');const left={...commit,oid:'left',subject:'Left'},right={...commit,oid:'right',subject:'Right'},fallback=bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method,repoId,payload)=>method==='compare'?Promise.resolve({left,right,files:[{path:'changed.txt',status:'M'}]}):method==='details'&&(payload as {oid?:string})?.oid===left.oid?Promise.resolve({commit:left,body:left.subject,files:[]}):fallback(method,repoId,payload));
    store.getState().setCommitSelection([left.oid,right.oid],left.oid,right.oid);
    await vi.waitFor(()=>expect(store.getState().comparison).toMatchObject({left:{oid:'left'},right:{oid:'right'}}));
    expect(store.getState().comparison).toMatchObject({left:{oid:'left'},right:{oid:'right'}});expect(store.getState().diffTarget).toEqual({kind:'comparison',left:'left',right:'right',path:'changed.txt'});
    await store.getState().loadHistory();expect(store.getState().comparison).toMatchObject({left:{oid:'left'},right:{oid:'right'}});
    store.getState().setCommitSelection([left.oid],left.oid,left.oid);await vi.waitFor(()=>expect(store.getState().details?.commit.oid).toBe(left.oid));expect(store.getState().comparison).toBeUndefined();
    store.getState().setCommitSelection([]);expect(store.getState()).toMatchObject({selectedOids:[],selectedOid:undefined,details:undefined,comparison:undefined,diffTarget:undefined});
  });
  it('collapses cached multi-selection when the active commit is clicked without modifiers',async()=>{
    await store.getState().selectRepository('a');await vi.waitFor(()=>expect(store.getState().details?.commit.oid).toBe(commit.oid));
    const details=store.getState().details;
    store.setState({selectedOids:['older','middle',commit.oid],selectionAnchor:'older',selectedOid:commit.oid});bridge.rpc.mockClear();
    await store.getState().selectCommit(commit.oid);
    expect(store.getState()).toMatchObject({selectedOids:[commit.oid],selectionAnchor:commit.oid,selectedOid:commit.oid,details});
    expect(bridge.rpc.mock.calls.filter(([method])=>method==='details')).toHaveLength(0);
    store.setState({selectedOids:['older','middle',commit.oid],selectionAnchor:'older'});
    await store.getState().selectCommit(commit.oid,undefined,undefined,true);
    expect(store.getState().selectedOids).toEqual(['older','middle',commit.oid]);
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
  it('opens the first non-empty Stash section and keeps category counts together',async()=>{
    const stash={...commit,oid:'stash',parents:['base','index','untracked'],subject:'pause notes'},index={...commit,oid:'index',parents:['base'],subject:'index'},untracked={...commit,oid:'untracked',subject:'untracked'},fallback=bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method,repoId,payload)=>{
      if(method==='snapshot')return Promise.resolve({...snapshot(a),stashes:[{selector:'stash@{0}',oid:stash.oid,subject:stash.subject}]});
      if(method==='stashDetails')return Promise.resolve({commit:stash,body:stash.subject,totalFiles:1,sections:{working:{commit:stash,body:stash.subject,parent:index.oid,files:[]},index:{commit:index,body:index.subject,parent:'base',files:[]},untracked:{commit:untracked,body:untracked.subject,files:[{path:'notes.txt',status:'A'}]}}});
      return fallback(method,repoId,payload);
    });
    await store.getState().selectRepository('a');await store.getState().selectCommit(stash.oid,undefined,stash.oid);
    expect(store.getState()).toMatchObject({selectedStashOid:'stash',selectedStashSection:'untracked',selectedOid:'untracked',selectedFile:'notes.txt',stashDetails:{totalFiles:1}});
    store.getState().selectStashSection('working');expect(store.getState()).toMatchObject({selectedStashSection:'working',selectedOid:'stash',details:{files:[]},selectedFile:undefined});
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
  it('clears filtered rows immediately and locates an older result across full history pages', async () => {
    await store.getState().selectRepository('a');
    const old={...commit,oid:'old'}, fallback=bridge.rpc.getMockImplementation()!;
    const first=deferred<{commits:Commit[];tips:string[];nextOffset:number;hasMore:boolean}>();
    bridge.rpc.mockImplementation((method,repoId,payload)=>{
      if(method!=='history')return fallback(method,repoId,payload);
      if(payload.search)return {commits:[old],tips:['filtered-tip'],nextOffset:1,hasMore:false};
      if(!payload.offset)return first.promise;
      return {commits:[old],tips:['full-tip'],nextOffset:2,hasMore:false};
    });
    store.getState().setSearch('older');
    expect(store.getState().commits).toEqual([]);
    await vi.waitFor(()=>expect(store.getState().commits).toEqual([old]));
    await store.getState().selectCommit(old.oid);
    const locating=store.getState().locateCommit(old.oid);
    expect(store.getState()).toMatchObject({search:'',commits:[],locatingOid:old.oid,selectedOid:old.oid});
    first.resolve({commits:[commit],tips:['full-tip'],nextOffset:1,hasMore:true});
    await locating;
    expect(store.getState()).toMatchObject({search:'',selectedOids:[old.oid],locatingOid:undefined,commits:[commit,old]});
    expect(bridge.rpc.mock.calls.filter(([method])=>method==='history').at(-1)?.[2]).toMatchObject({offset:1,tips:['full-tip']});
  });
  it('stops locating when a new search replaces the pending history request', async () => {
    await store.getState().selectRepository('a');
    const delayed=deferred<{commits:Commit[];tips:string[];nextOffset:number;hasMore:boolean}>(),fallback=bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method,repoId,payload)=>method==='history'&&!payload.search?delayed.promise:fallback(method,repoId,payload));
    const locating=store.getState().locateCommit('old');
    store.getState().setSearch('new');
    await vi.waitFor(()=>expect(store.getState().historyLoading).toBe(false));
    delayed.resolve({commits:[{...commit,oid:'stale'}],tips:['old-tip'],nextOffset:1,hasMore:true});
    await locating;
    expect(store.getState()).toMatchObject({search:'new',commits:[commit],locatingOid:undefined});
    expect(bridge.rpc.mock.calls.filter(([method,,payload])=>method==='history'&&payload.offset>0)).toHaveLength(0);
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
  it('summarizes saved and untracked files after creating a Stash',async()=>{
    await store.getState().selectRepository('a');const before={...snapshot(a),changes:[{path:'notes.txt',indexStatus:'?',worktreeStatus:'?',conflict:false,untracked:true}]},after={...snapshot(a,2),stashes:[{selector:'stash@{0}',oid:'saved',subject:'pause notes'}]},fallback=bridge.rpc.getMockImplementation()!;
    store.setState({snapshot:before});bridge.rpc.mockImplementation((method,...args)=>method==='snapshot'?Promise.resolve(after):fallback(method,...args));
    expect(await store.getState().execute({type:'stash.create',message:'pause notes',includeUntracked:true})).toBe(true);
    expect(store.getState().actionFeedback).toMatchObject({status:'success',result:{kind:'stash',files:1,untracked:1,clean:true}});
  });
  it('counts only the unique selected files and included untracked files in Stash feedback',async()=>{
    await store.getState().selectRepository('a');
    const tracked={path:'both.txt',indexStatus:'M',worktreeStatus:'M',conflict:false,untracked:false},untracked={path:'notes.txt',indexStatus:'?',worktreeStatus:'?',conflict:false,untracked:true},other={...tracked,path:'other.txt'},fallback=bridge.rpc.getMockImplementation()!;
    for(const includeUntracked of [false,true]){
      store.setState({snapshot:{...snapshot(a),changes:[tracked,untracked,other]}});
      bridge.rpc.mockImplementation((method,...args)=>method==='snapshot'?Promise.resolve({...snapshot(a,2),changes:[other],stashes:[{selector:'stash@{0}',oid:'saved',subject:'selected'}]}):fallback(method,...args));
      expect(await store.getState().execute({type:'stash.create',paths:['both.txt','both.txt','notes.txt'],includeUntracked})).toBe(true);
      expect(store.getState().actionFeedback?.result).toEqual({kind:'stash',files:2,untracked:1,clean:false});
    }
  });
  it('opens a whole-file Stash dialog for unique staged and unstaged selections only',async()=>{
    const {menuFor}=await import('../webview/menus'),open=vi.fn(),noop=vi.fn(),api={open,checkout:noop,openDiff:noop,editFile:noop,host:vi.fn().mockResolvedValue(undefined),addRepository:vi.fn().mockResolvedValue(undefined),removeRepositories:noop,fetchRepositories:noop};
    store.setState({snapshot:snapshot(a)});
    const staged={path:'both.txt',target:{kind:'change' as const,path:'both.txt',area:'staged' as const}},unstaged={...staged,target:{...staged.target,area:'unstaged' as const}},untracked={path:'notes.txt',target:{kind:'change' as const,path:'notes.txt',area:'unstaged' as const}};
    const item=menuFor({kind:'files',primary:staged,files:[staged,unstaged,untracked]},api).items.find(item=>item.label==='Stash Selected Files…')!;
    expect(item.disabled).toBe(false);await item.run();expect(open).toHaveBeenCalledWith({type:'stash.create',paths:['both.txt','notes.txt']});
    store.setState({snapshot:{...snapshot(a),operation:{...snapshot(a).operation,conflicts:1}}});
    expect(menuFor({kind:'files',primary:staged,files:[staged]},api).items.find(item=>item.label==='Stash Selected Files…')?.disabled).toBe(true);
    const historical={path:'old.txt',target:{kind:'commit' as const,path:'old.txt',oid:commit.oid}};
    expect(menuFor({kind:'files',primary:historical,files:[historical]},api).items.some(item=>item.label==='Stash Selected Files…')).toBe(false);
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

  it.each(['untracked-path-exists','restore-conflict','restore-blocked','state-changed'] as const)('retains structured Stash restore safety details after refresh: %s',async(reason)=>{
    await store.getState().selectRepository('a');const fallback=bridge.rpc.getMockImplementation()!,details={kind:'stash-apply' as const,reason,paths:['notes.txt'],selector:'stash@{0}',stashOid:'saved',stashRetained:true as const,workingTreeUnchanged:true as const};
    bridge.rpc.mockImplementation((method,...args)=>method==='action'?Promise.reject(Object.assign(new Error('Cannot restore because notes.txt already exists.'),{code:'STASH_UNTRACKED_CONFLICT',details})):fallback(method,...args));
    expect(await store.getState().execute({type:'stash.apply',selector:'stash@{0}',expectedOid:'saved'})).toBe(false);
    expect(store.getState()).toMatchObject({stashApplyFailure:details,error:'Cannot restore because notes.txt already exists.',checkoutFailure:undefined});
    store.getState().dismissFeedback();expect(store.getState()).toMatchObject({stashApplyFailure:undefined,error:undefined});
    store.setState({stashApplyFailure:details});await store.getState().selectRepository('b');expect(store.getState().stashApplyFailure).toBeUndefined();
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

  it('keeps stable region data and skips history after a working-tree action', async () => {
    const current = await workingFixture(), before = store.getState();
    current.changes[0].indexStatus = 'A';
    expect(await store.getState().execute({ type: 'stage', paths: ['a.txt'] })).toBe(true);
    expect(bridge.rpc.mock.calls.map(([method]) => method)).toEqual(['action', 'snapshot']);
    const after = store.getState();
    expect(after.snapshot?.changes).not.toBe(before.snapshot?.changes);
    expect(after.snapshot?.refs).toBe(before.snapshot?.refs);
    expect(after.snapshot?.stashes).toBe(before.snapshot?.stashes);
    expect(after.repositoryStatuses).toBe(before.repositoryStatuses);
    expect(after.checkedRefs).toBe(before.checkedRefs);
    expect(after.selectedOids).toBe(before.selectedOids);
    expect(after.commits).toBe(before.commits);
  });

  it('refreshes pushed markers when an unchecked remote moves and the HEAD node when HEAD changes', async () => {
    const current = await workingFixture();
    current.refs.push({ kind: 'remote', name: 'origin/main', fullName: 'refs/remotes/origin/main', oid: 'remote-tip' });
    await store.getState().refresh({ background: true, changes: { paths: [] } });
    bridge.rpc.mockClear();
    current.refs[0].oid = 'pushed-tip';
    await store.getState().refresh({ background: true, changes: { paths: [] } });
    expect(bridge.rpc.mock.calls.map(([method]) => method)).toEqual(['snapshot', 'history']);
    bridge.rpc.mockClear(); current.head = 'detached-tip';
    await store.getState().refresh({ background: true, changes: { paths: [] } });
    expect(bridge.rpc.mock.calls.map(([method]) => method)).toEqual(['snapshot', 'history']);
  });

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
    store.setState({ selectedFile: 'removed-session-file.txt' });
    await store.getState().refresh({ background: true, changes: { paths: [] } });
    expect(store.getState().selectedFile).toBeUndefined();
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
