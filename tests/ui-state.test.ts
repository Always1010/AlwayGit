import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Commit, HistoryPage, HostMessage, Repository, Snapshot } from '../src/protocol/types';
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
  it('refreshes working Diff without stealing a terminal tab, but explicit file selection activates Diff', async () => {
    const { useDock } = await import('../webview/dock-store');
    await store.getState().selectRepository('a');
    const changes = [{ path: 'a.txt', indexStatus: ' ', worktreeStatus: 'M', conflict: false, untracked: false }];
    store.setState({ snapshot: { ...snapshot(a), changes } }); store.getState().selectWorking();
    const target = { kind: 'change' as const, path: 'a.txt', area: 'unstaged' as const };
    useDock.getState().select('terminal-a');
    const fallback = bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method, ...args) => method === 'snapshot' ? { ...snapshot(a, 2), changes } : fallback(method, ...args));
    await store.getState().refresh({ background: true });
    expect(useDock.getState().activeId).toBe('terminal-a');
    store.getState().selectFile(target); expect(useDock.getState().activeId).toBe('diff');
  });
  it('does not validate old displayed rows using a newer snapshot when saving the back view', async () => {
    await store.getState().selectRepository('a');
    store.setState({ snapshot: { ...snapshot(a), head: 'moved-head' } });
    store.getState().setCheckedRefs(['refs/tags/v1']);
    await vi.waitFor(() => expect(store.getState().historyLoading).toBe(false));
    const reads = bridge.rpc.mock.calls.filter(([method]) => method === 'history').length;
    store.getState().backHistory();
    await vi.waitFor(() => expect(store.getState().historyLoading).toBe(false));
    expect(bridge.rpc.mock.calls.filter(([method]) => method === 'history')).toHaveLength(reads + 1);
  });
  it('reloads very deep history when going back instead of retaining an unbounded page cache', async () => {
    await store.getState().selectRepository('a');
    store.setState({ commits: Array.from({ length: 10_001 }, (_, index) => ({ ...commit, oid: `deep-${index}` })) });
    store.getState().setCheckedRefs(['refs/tags/v1']);
    await vi.waitFor(() => expect(store.getState().historyLoading).toBe(false));
    const reads = bridge.rpc.mock.calls.filter(([method]) => method === 'history').length;
    store.getState().backHistory();
    await vi.waitFor(() => expect(store.getState().historyLoading).toBe(false));
    expect(store.getState().commits).toEqual([commit]);
    expect(bridge.rpc.mock.calls.filter(([method]) => method === 'history')).toHaveLength(reads + 1);
  });
  it('does not append old pages into a failed new scope and locates a tag using its own history', async () => {
    await store.getState().selectRepository('a');
    store.setState({ historyError: 'offline', checkedRefs: ['refs/tags/missing'], hasMore: true });
    const count = bridge.rpc.mock.calls.length;
    await store.getState().loadHistory(true);
    expect(bridge.rpc.mock.calls).toHaveLength(count);
    const fallback = bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method, repo, query) => method === 'history' ? { commits: [{ ...commit, oid: 'tag-tip' }], head: commit, tips: ['tag-tip'], nextOffset: 1, hasMore: true } : fallback(method, repo, query));
    store.getState().locateRef('refs/tags/v1', 'tag-tip');
    await vi.waitFor(() => expect(store.getState().locatingOid).toBeUndefined());
    expect(store.getState()).toMatchObject({ checkedRefs: ['refs/tags/v1'], search: '', selectedOid: 'tag-tip', displayedHistory: { refs: ['refs/tags/v1'], search: '' } });
    expect(bridge.rpc.mock.calls.filter(([method]) => method === 'history')).toHaveLength(2);
    const loadedCount = bridge.rpc.mock.calls.length;
    store.getState().locateRef('refs/tags/v1', 'tag-tip');
    expect(bridge.rpc.mock.calls.filter(([method]) => method === 'history')).toHaveLength(2);
    expect(bridge.rpc.mock.calls.slice(loadedCount).some(([method]) => method === 'action')).toBe(false);
  });
  it('returns from pending navigation to the successful view and cancels the stale read', async () => {
    await store.getState().selectRepository('a');
    store.getState().setHistoryScroll(640);
    const pending = deferred<HistoryPage>(), fallback = bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method, ...args) => method === 'history' ? pending.promise : fallback(method, ...args));
    store.getState().setCheckedRefs(['refs/tags/v1']);
    const signal = bridge.rpc.mock.calls.filter(([method]) => method === 'history').at(-1)![3].signal as AbortSignal;
    expect(store.getState().historyBackDepth).toBe(1);
    store.getState().backHistory();
    expect(signal.aborted).toBe(true);
    expect(store.getState()).toMatchObject({ historyLoading: false, historyBackDepth: 0, historyScrollTop: 640, historyRestoreTop: 640, commits: [commit], displayedHistory: { refs: ['HEAD'], search: '' } });
    pending.resolve({ commits: [{ ...commit, oid: 'stale' }], tips: ['stale'], nextOffset: 1, hasMore: false });
    await pending.promise;
    expect(store.getState().commits).toEqual([commit]);
    await store.getState().selectRepository('b');
    expect(store.getState().historyBackDepth).toBe(0);
  });

  it('resets tag and search navigation to the actual branch without executing Git actions', async () => {
    await store.getState().selectRepository('a');
    const main = { name: 'main', fullName: 'refs/heads/main', kind: 'local' as const, oid: commit.oid };
    store.setState({ snapshot: { ...snapshot(a), refs: [main] }, checkedRefs: ['refs/tags/v1'], search: 'needle', displayedHistory: { refs: ['refs/tags/v1'], search: 'needle' } });
    store.getState().resetHistory();
    await vi.waitFor(() => expect(store.getState().historyLoading).toBe(false));
    expect(store.getState()).toMatchObject({ checkedRefs: ['refs/heads/main'], search: '', selectedOid: commit.oid, historyBackDepth: 1 });
    expect(bridge.rpc.mock.calls.some(([method]) => method === 'action')).toBe(false);
    const count = store.getState().historyBackDepth;
    store.getState().resetHistory();
    expect(store.getState().historyBackDepth).toBe(count);
  });
  it('keeps the displayed scope paired with its rows while a new scope loads or fails', async () => {
    await store.getState().selectRepository('a');
    const displayed = store.getState().displayedHistory;
    const request = deferred<HistoryPage>(), fallback = bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method, ...args) => method === 'history' ? request.promise : fallback(method, ...args));
    store.getState().setCheckedRefs(['refs/tags/v1']);
    expect(store.getState()).toMatchObject({ historyLoading: true, checkedRefs: ['refs/tags/v1'], displayedHistory: displayed, commits: [commit] });
    request.resolve({ commits: [{ ...commit, oid: 'tag' }], tips: ['tag'], nextOffset: 1, hasMore: false });
    await vi.waitFor(() => expect(store.getState().historyLoading).toBe(false));
    expect(store.getState().displayedHistory).toEqual({ refs: ['refs/tags/v1'], search: '' });
    bridge.rpc.mockImplementation((method, ...args) => method === 'history' ? Promise.reject(new Error('offline')) : fallback(method, ...args));
    store.getState().setCheckedRefs(['refs/tags/v2']);
    await vi.waitFor(() => expect(store.getState().historyError).toBe('offline'));
    expect(store.getState().displayedHistory?.refs).toEqual(['refs/tags/v1']);
    expect(store.getState().commits[0].oid).toBe('tag');
  });

  it('ignores stale history responses and avoids reloading an unchanged reference set', async () => {
    await store.getState().selectRepository('a');
    const old = deferred<HistoryPage>(), next = deferred<HistoryPage>(), fallback = bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method, repo, payload) => method === 'history' ? payload.tips.includes('refs/tags/old') ? old.promise : next.promise : fallback(method, repo, payload));
    store.getState().setCheckedRefs(['refs/tags/old']);
    store.getState().setCheckedRefs(['refs/tags/new']);
    const count = bridge.rpc.mock.calls.length;
    store.getState().setCheckedRefs(['refs/tags/new', 'refs/tags/new']);
    expect(bridge.rpc.mock.calls).toHaveLength(count);
    next.resolve({ commits: [{ ...commit, oid: 'new' }], tips: ['new'], nextOffset: 1, hasMore: false });
    await vi.waitFor(() => expect(store.getState().historyLoading).toBe(false));
    old.resolve({ commits: [commit], tips: ['old'], nextOffset: 1, hasMore: false });
    await old.promise;
    expect(store.getState().commits[0].oid).toBe('new');
    expect(store.getState().displayedHistory?.refs).toEqual(['refs/tags/new']);
  });
  it('keeps multi-Tag and mixed reference menus out of branch-only actions', async () => {
    const { menuFor } = await import('../webview/menus');
    const noop=vi.fn(),api={startCommit:noop,open:noop,checkout:noop,openDiff:noop,editFile:noop,host:vi.fn().mockResolvedValue(undefined),addRepository:vi.fn().mockResolvedValue(undefined),removeRepositories:noop,fetchRepositories:noop};
    const tags=[1,2].map(index=>({name:`v${index}`,fullName:`refs/tags/v${index}`,kind:'tag' as const,oid:String(index).repeat(40),refOid:String(index).repeat(40)}));
    const local={name:'main',fullName:'refs/heads/main',kind:'local' as const,oid:'a'.repeat(40)};
    store.setState({snapshot:{...snapshot(a),refs:[...tags,local]},language:'en'});
    const tagMenu=menuFor({kind:'ref',ref:tags[0],refs:tags},api).items;
    expect(tagMenu.some(item=>item.label.includes('Remote Branch'))).toBe(false);
    expect(tagMenu.some(item=>item.label.includes('Delete'))).toBe(false);
    expect(tagMenu.at(-1)?.label).toBe('Copy Tag Names');
    const pushTags=tagMenu.find(item=>item.label==='Push 2 Tags…')!;expect(pushTags.disabled).toBe(false);pushTags.run();
    expect(api.open).toHaveBeenCalledWith({type:'tag.push',names:['v1','v2'],expectedOids:{v1:'1'.repeat(40),v2:'2'.repeat(40)}});
    const mixed=menuFor({kind:'ref',ref:tags[0],refs:[tags[0],local]},api).items;
    expect(mixed.some(item=>item.label.includes('Delete'))).toBe(false);
    expect(mixed.at(-1)?.label).toBe('Copy Reference Names');
  });

  it('disables direct Detached Checkout in commit menus while preserving branch creation and local branch switching', async () => {
    await store.getState().selectRepository('a');
    const { menuFor } = await import('../webview/menus');
    const open=vi.fn(),checkout=vi.fn(),noop=vi.fn(),api={startCommit:noop,open,checkout,openDiff:noop,editFile:noop,host:vi.fn().mockResolvedValue(undefined),addRepository:vi.fn().mockResolvedValue(undefined),removeRepositories:noop,fetchRepositories:noop};
    const tag={name:'v1',fullName:'refs/tags/v1',kind:'tag' as const,oid:'old'};
    const target={kind:'commit' as const,oid:'old'};
    for (const language of ['en','zh-CN'] as const) {
      store.setState({language});
      const menu=menuFor(target,api).items;
      expect(menu[0]).toMatchObject({disabled:true});
      expect(menu[0].label).toContain('Detached HEAD');
      expect(menu[0].reason).toMatch(/disabled|禁止/);
      expect(menu[1].disabled).toBe(false);menu[1].run();
      expect(open).toHaveBeenLastCalledWith({type:'branch.create',target:'old',checkout:true,requireCheckout:true});
      const tagMenu=menuFor({kind:'ref',ref:tag},api).items;
      expect(tagMenu).toHaveLength(6);
      expect(tagMenu.some(item=>item.label.includes('Detached HEAD'))).toBe(false);
      expect(tagMenu.some(item=>item.label.includes('Create Branch'))).toBe(false);
      expect(tagMenu.some(item=>item.label.includes('Graph Scope'))).toBe(false);
    }
    store.setState({language:'en'});
    expect(menuFor({kind:'ref',ref:tag},api).items.map(item=>item.label)).toEqual(['Show Only This Tag History','Locate Tag Commit in Graph','Push Tag…','Delete Tag…','Copy Tag Name','Copy Commit ID']);
    store.setState({language:'en',operationSettings:{allowDetachedHead:true,pushFollowTags:false,pushTagAfterCreate:false,defaultResetMode:'mixed',scope:'workspace'}});
    const enabled=menuFor(target,api).items;
    expect(enabled.filter(item=>item.label.includes('Detached HEAD'))).toHaveLength(1);
    expect(enabled[0].disabled).toBe(false);enabled[0].run();
    expect(open).toHaveBeenLastCalledWith({type:'commit.checkout',target:'old'});
    expect(checkout).not.toHaveBeenCalled();
    store.setState({operationSettings:{allowDetachedHead:false,pushFollowTags:false,pushTagAfterCreate:false,defaultResetMode:'mixed',scope:'workspace'},snapshot:{...snapshot(a),refs:[{name:'topic',fullName:'refs/heads/topic',kind:'local',oid:'old'}]}});
    const branch=menuFor(target,api).items[0];expect(branch).toMatchObject({label:'Switch to Branch "topic"…',disabled:false});branch.run();expect(checkout).toHaveBeenCalledWith('old');
    store.setState({snapshot:{...store.getState().snapshot!,branch:'topic'}});
    expect(menuFor(target,api).items[0]).toMatchObject({disabled:true,reason:'This is the current branch.'});
    store.setState({snapshot:{...snapshot(a),refs:[{name:'topic',fullName:'refs/heads/topic',kind:'local',oid:'old'},{name:'other',fullName:'refs/heads/other',kind:'local',oid:'old'}]}});
    expect(menuFor(target,api).items[0]).toMatchObject({label:'Choose Branch to Checkout…',disabled:false});
  });

  it('disables already-included cherry-picks, waits for ancestry and keeps deliberate historical reapplication separate', async () => {
    await store.getState().selectRepository('a');
    store.setState({commits:[commit,...['topic','old'].map(oid=>({...commit,oid}))]});
    const { menuFor } = await import('../webview/menus');
    const open=vi.fn(),noop=vi.fn(),api={startCommit:noop,open,checkout:noop,openDiff:noop,editFile:noop,host:vi.fn().mockResolvedValue(undefined),addRepository:vi.fn().mockResolvedValue(undefined),removeRepositories:noop,fetchRepositories:noop};
    const cherry=(oid:string,check?:{included:string[];failed?:boolean},oids?:string[])=>menuFor({kind:'commit',oid,oids},api,check).items.find(item=>item.label.startsWith('Cherry-pick'))!;
    expect(cherry('abc',{included:[]})).toMatchObject({disabled:true,reason:'This commit is the current branch HEAD.'});
    expect(menuFor({kind:'commit',oid:'abc'},api,{included:['abc']}).items.some(item=>item.label==='Reapply Historical Commits…')).toBe(false);
    expect(cherry('old')).toMatchObject({disabled:true,reason:'Checking whether this branch already includes the selected commits…'});
    expect(cherry('old',{included:[],failed:true}).disabled).toBe(true);
    expect(cherry('old',{included:['old']}).disabled).toBe(true);
    const reapply=menuFor({kind:'commit',oid:'old'},api,{included:['old']}).items.find(item=>item.label==='Reapply Historical Commits…')!;
    expect(reapply.disabled).toBe(false);reapply.run();
    expect(open).toHaveBeenCalledWith({type:'cherry-pick',target:'old',reapply:true});
    expect(cherry('topic',{included:[]}).disabled).toBe(false);
    expect(cherry('topic',{included:['old']},['topic','old']).disabled).toBe(true);
    expect(cherry('topic',{included:[]},['topic','abc']).disabled).toBe(true);
    store.setState({commits:[...store.getState().commits,{...commit,oid:'merged',parents:['abc','other']}]});
    expect(cherry('merged',{included:['merged']}).disabled).toBe(true);
    expect(cherry('merged',{included:[]}).disabled).toBe(false);
    expect(cherry('topic',{included:[]},['topic','merged']).disabled).toBe(true);
    expect(cherry('missing',{included:[]}).disabled).toBe(true);
  });
  it('keeps the newest catalog and active repository when an older initialization finishes late', async () => {
    await store.getState().selectRepository('b');
    const old = deferred<Repository[]>(), latest = deferred<Repository[]>(), fallback = bridge.rpc.getMockImplementation()!;
    let calls = 0;
    bridge.rpc.mockImplementation((method, ...args) => method === 'repositories' ? (++calls === 1 ? old.promise : latest.promise) : fallback(method, ...args));
    const first = store.getState().initialize(), second = store.getState().initialize();
    latest.resolve([a, b]); await second;
    old.resolve([a]); await first;
    expect(store.getState().repositories).toEqual([a, b]);
    expect(store.getState().repoId).toBe('b');
    expect(store.getState().snapshot?.repository.id).toBe('b');
    expect(store.getState().notice).toBeUndefined();
  });
  it('does not clear catalog loading while a newer initialization is pending', async () => {
    const old = deferred<Repository[]>(), latest = deferred<Repository[]>(), fallback = bridge.rpc.getMockImplementation()!;
    let calls = 0;
    bridge.rpc.mockImplementation((method, ...args) => method === 'repositories' ? (++calls === 1 ? old.promise : latest.promise) : fallback(method, ...args));
    const first = store.getState().initialize(), second = store.getState().initialize();
    old.resolve([a]); await first;
    expect(store.getState().loading).toBe(true);
    latest.resolve([a, b]); await second;
    expect(store.getState().loading).toBe(false);
  });

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
  it('keeps only one non-empty sidebar action-selection scope', () => {
    store.getState().setRepositorySelection(['repository-a'],'repository-a');
    expect(store.getState()).toMatchObject({selectedRepositoryKeys:['repository-a'],repositorySelectionAnchor:'repository-a',selectedRefs:[],selectedWorktreePaths:[]});
    store.getState().setRefSelection(['refs/heads/main'],'refs/heads/main');
    expect(store.getState()).toMatchObject({selectedRepositoryKeys:[],selectedRefs:['refs/heads/main'],refSelectionAnchor:'refs/heads/main',selectedWorktreePaths:[]});
    store.getState().setWorktreeSelection(['/a-worktree'],'/a-worktree');
    expect(store.getState()).toMatchObject({selectedRepositoryKeys:[],selectedRefs:[],selectedWorktreePaths:['/a-worktree'],worktreeSelectionAnchor:'/a-worktree'});
    store.getState().setRepositorySelection(['repository-b'],'repository-b');
    store.getState().setRefSelection([]);
    store.getState().setWorktreeSelection([]);
    expect(store.getState()).toMatchObject({selectedRepositoryKeys:['repository-b'],selectedRefs:[],selectedWorktreePaths:[]});
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
      if (method === 'operationSettings') return { allowDetachedHead: true, pushFollowTags: true, pushTagAfterCreate: true, defaultResetMode: 'soft', scope: 'workspace' };
      throw new Error('Settings write failed');
    });
    await store.getState().loadOperationSettings();
    expect(store.getState().operationSettings.allowDetachedHead).toBe(true);
    expect(store.getState().operationSettings.defaultResetMode).toBe('soft');
    bridge.event?.({ type: 'operationSettingsChanged', settings: { allowDetachedHead: false, pushFollowTags: false, pushTagAfterCreate: false, defaultResetMode: 'mixed', scope: 'workspace' } });
    await expect(store.getState().saveOperationSettings({allowDetachedHead:true,pushFollowTags:true,pushTagAfterCreate:true,defaultResetMode:'hard'})).rejects.toThrow('Settings write failed');
    expect(store.getState().operationSettings.allowDetachedHead).toBe(false);
    bridge.rpc.mockResolvedValue({ allowDetachedHead: true, pushFollowTags: true, pushTagAfterCreate: true, defaultResetMode: 'hard', scope: 'workspace' });
    await store.getState().saveOperationSettings({allowDetachedHead:true,pushFollowTags:true,pushTagAfterCreate:true,defaultResetMode:'hard'});
    expect(store.getState().operationSettings.allowDetachedHead).toBe(true);
    expect(store.getState().operationSettings.defaultResetMode).toBe('hard');
    expect(bridge.save.mock.calls.at(-1)?.[0]).not.toHaveProperty('allowDetachedHead');
  });
  it('previews settings without persisting them and rolls back while preserving live data', async () => {
    await store.getState().selectRepository('a'); store.getState().setDraft('keep my draft');
    const original = store.getState(), target = original.diffTarget;
    original.beginSettings();
    expect(original.diffNavigationScope).toBe('commit');
    expect(original.singleKeyShortcuts).toBe(true);
    store.getState().previewSettings({ changeListMode:'unified', singleKeyShortcuts: false, diffNavigationScope: 'file', language: 'zh-CN', font: 16, row: 28, appearance: { theme: 'light', palette: 'extended', codeFont: 18, codeRowHeight: 24, fileSpacing: 5, currentBranchColor: '#00ff99', currentRepositoryColor: '#ff4ad4' } });
    expect(store.getState().changeListMode).toBe('unified');
    expect(bridge.save.mock.calls.at(-1)?.[0].changeListMode).toBe('split');
    expect(store.getState().diffNavigationScope).toBe('file');
    expect(store.getState().singleKeyShortcuts).toBe(false);
    expect(store.getState().appearance.palette).toBe('extended');
    expect(store.getState().appearance).toMatchObject({currentBranchColor:'#00FF99',currentRepositoryColor:'#FF4AD4'});
    expect(bridge.save.mock.calls.at(-1)?.[0]).toMatchObject({ singleKeyShortcuts: true, diffNavigationScope: 'commit', language: original.language, layout: original.layout, appearance: original.appearance });
    // A background refresh/save during preview must still persist committed settings.
    await store.getState().refresh();
    expect(bridge.save.mock.calls.at(-1)?.[0].appearance).toEqual(original.appearance);
    store.getState().finishSettings(false);
    expect(store.getState().changeListMode).toBe('split');
    expect(store.getState()).toMatchObject({ singleKeyShortcuts: true, diffNavigationScope: 'commit', language: original.language, layout: original.layout, appearance: original.appearance, drafts: { a: 'keep my draft' }, diffTarget: target });
  });
  it('applies settings through host session validation and restores only panel geometry', async () => {
    const { sessionSchema } = await import('../src/protocol/validation');
    store.getState().beginSettings();
    store.getState().previewSettings({ changeListMode:'unified', singleKeyShortcuts: false, diffNavigationScope: 'file', language: 'zh-CN', font: 15, row: 28, appearance: { theme: 'contrast', palette: 'distinct', codeFont: 17, codeRowHeight: 23, fileSpacing: 6, badgeColor: '#006BFF', currentBranchColor:'#00FF99', currentRepositoryColor:'#FF4AD4' } });
    store.getState().finishSettings(true);
    const saved = bridge.save.mock.calls.at(-1)?.[0];
    expect(sessionSchema.parse(saved).changeListMode).toBe('unified');
    expect(sessionSchema.parse(saved).diffNavigationScope).toBe('file');
    expect(sessionSchema.parse(saved).singleKeyShortcuts).toBe(false);
    expect(sessionSchema.parse(saved).appearance).toMatchObject({ theme: 'contrast', palette: 'distinct', codeFont: 17, codeRowHeight: 23, fileSpacing: 6, badgeColor: '#006BFF', currentBranchColor:'#00FF99', currentRepositoryColor:'#FF4AD4' });
    expect(saved.appearance.colors.light).toHaveLength(8);
    expect(saved.appearance.colors.dark).toHaveLength(8);
    store.getState().setLayout({ sidebar: 260, details: 350, diff: 900, diffCollapsed: true }); store.getState().restoreLayout();
    expect(store.getState()).toMatchObject({ singleKeyShortcuts: false, diffNavigationScope: 'file', language: 'zh-CN', layout: { sidebar: 210, details: 300, diff: 220, diffCollapsed: false, font: 15, row: 28 }, appearance: saved.appearance });
    expect(store.getState().settingsBaseline).toBeUndefined();
  });
  it('restores legacy Diff settings without losing the font and validates custom line heights', async () => {
    const { normalizeAppearance } = await import('../webview/appearance');
    const { sessionSchema } = await import('../src/protocol/validation');
    const legacy = { theme: 'light' as const, palette: 'vivid' as const, codeFont: 15 };
    expect(sessionSchema.safeParse({ appearance: legacy }).success).toBe(true);
    expect(normalizeAppearance(legacy)).toMatchObject({ theme: 'light', codeFont: 15, codeRowHeight: 18, fileSpacing: 1, currentBranchColor:'#2463C5',currentRepositoryColor:'#2463C5' });
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
  it('blocks duplicate checkout through the action and refresh phases', async () => {
    await store.getState().selectRepository('a');
    const pending = deferred<void>(), refreshed = deferred<Snapshot>(), started = deferred<void>();
    const fallback = bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method, repoId, payload) => {
      if (method === 'action') return pending.promise;
      if (method === 'snapshot') { started.resolve(); return refreshed.promise; }
      return fallback(method, repoId, payload);
    });
    const operation = store.getState().execute({ type: 'branch.checkout', name: 'topic' });
    const { blocksWorkbench } = await import('../webview/actionFeedback');
    expect(blocksWorkbench(store.getState().actionFeedback!.action)).toBe(true);
    expect(await store.getState().execute({ type: 'branch.checkout', name: 'other' })).toBe(false);
    bridge.event?.({ type: 'activity', repoId: 'a', busy: false, label: 'branch.checkout' });
    expect(store.getState().busy).toBe(true);
    pending.resolve(); await started.promise;
    expect(store.getState().actionFeedback?.phase).toBe('refreshing');
    expect(store.getState().busy).toBe(true);
    refreshed.resolve({ ...snapshot(a), branch: 'topic' }); await operation;
    expect(store.getState().busy).toBe(false);
    expect(store.getState().actionFeedback?.status).toBe('success');
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
  it.each(['', 'Example'])('locates a loaded HEAD without reloading history or changing filters (search: %s)', async search => {
    await store.getState().selectRepository('a');
    const other={...commit,oid:'other'},commits=[other,commit],checkedRefs=['refs/heads/topic'],tips=['pinned-topic'];
    store.setState({commits,historyHead:commit,checkedRefs,tips,search,nextOffset:200,hasMore:true,selectedOid:other.oid,selectedOids:[other.oid],details:undefined});
    const token=store.getState().locateToken;
    bridge.rpc.mockClear();store.getState().locateHead();
    expect(store.getState()).toMatchObject({selectedOid:commit.oid,selectedOids:[commit.oid],search,nextOffset:200,hasMore:true,historyLoading:false,locateToken:token+1});
    expect(store.getState().commits).toBe(commits);expect(store.getState().historyHead).toBe(commit);
    expect(store.getState().checkedRefs).toBe(checkedRefs);expect(store.getState().tips).toBe(tips);
    await vi.waitFor(()=>expect(store.getState().detailsLoading).toBe(false));
    store.getState().locateHead();
    expect(store.getState().locateToken).toBe(token+2);
    expect(store.getState().commits).toBe(commits);
    expect(bridge.rpc.mock.calls.map(([method])=>method)).toEqual(['details']);
  });
  it('appends missing HEAD pages without clearing or restarting loaded history', async () => {
    await store.getState().selectRepository('a');
    const other={...commit,oid:'other'},commits=[other],next=deferred<HistoryPage>(),fallback=bridge.rpc.getMockImplementation()!;
    store.setState({commits,historyHead:commit,checkedRefs:['HEAD'],tips:['pinned-head'],nextOffset:100,hasMore:true});
    bridge.rpc.mockImplementation((method,repoId,payload)=>method==='history'?next.promise:fallback(method,repoId,payload));
    bridge.rpc.mockClear();store.getState().locateHead();
    expect(store.getState().commits).toBe(commits);
    expect(store.getState()).toMatchObject({nextOffset:100,hasMore:true,locatingOid:commit.oid,selectedOid:commit.oid});
    expect(bridge.rpc).toHaveBeenCalledWith('history','a',expect.objectContaining({offset:100,tips:['pinned-head']}),expect.objectContaining({signal:expect.any(AbortSignal)}));
    next.resolve({commits:[commit],head:commit,tips:['pinned-head'],nextOffset:101,hasMore:false});
    await vi.waitFor(()=>expect(store.getState().locatingOid).toBeUndefined());
    expect(store.getState().commits).toEqual([other,commit]);
    expect(bridge.rpc.mock.calls.filter(([method])=>method==='history')).toHaveLength(1);
  });
  it.each(['main', ''])('restores an excluded HEAD and locates it beyond the first page (branch: %s)', async branch => {
    await store.getState().selectRepository('a');
    const other={...commit,oid:'other'},fallback=bridge.rpc.getMockImplementation()!;
    store.setState({snapshot:{...snapshot(a),branch,refs:[{name:'main',fullName:'refs/heads/main',kind:'local',oid:commit.oid}]},checkedRefs:[],commits:[]});
    bridge.rpc.mockImplementation((method,repoId,payload)=>method==='history'?{
      commits:payload.offset?[commit]:[other],head:commit,tips:['fixed-head'],nextOffset:payload.offset?2:1,hasMore:!payload.offset,
    }:fallback(method,repoId,payload));
    // Locate must cancel a pending search as well as discard its filtered query.
    store.getState().setSearch('no-match');bridge.rpc.mockClear();store.getState().locateHead();
    expect(store.getState()).toMatchObject({search:'',locatingOid:commit.oid,selectedOid:commit.oid});
    await vi.waitFor(()=>expect(store.getState().locatingOid).toBeUndefined());
    expect(store.getState().commits).toEqual([other,commit]);
    const calls=bridge.rpc.mock.calls.filter(([method])=>method==='history');
    expect(calls).toHaveLength(2);
    expect(calls[0][2]).toMatchObject({offset:0,tips:[branch?'refs/heads/main':'HEAD']});
    expect(calls[0][2]).not.toHaveProperty('search');
    expect(calls[1][2]).toMatchObject({offset:1,tips:['fixed-head']});
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
  it('debounces search and ignores a response already running before the input changed', async () => {
    await store.getState().selectRepository('a'); vi.useFakeTimers();
    const old=deferred<{commits:Commit[];tips:string[];nextOffset:number;hasMore:boolean}>(),fallback=bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method,repoId,payload)=>method==='history'&&!payload.search?old.promise:fallback(method,repoId,payload));
    const pending=store.getState().loadHistory(); bridge.rpc.mockClear();
    store.getState().setSearch('a'); store.getState().setSearch('ab'); store.getState().setSearch('abc');
    old.resolve({commits:[{...commit,oid:'stale'}],tips:[],nextOffset:1,hasMore:false}); await pending;
    expect(store.getState().commits).toEqual([]); expect(store.getState().historyLoading).toBe(true);
    await vi.advanceTimersByTimeAsync(199); expect(bridge.rpc).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(bridge.rpc.mock.calls.filter(([method])=>method==='history')).toHaveLength(1);
    expect(bridge.rpc).toHaveBeenCalledWith('history','a',expect.objectContaining({search:'abc'}),expect.objectContaining({signal:expect.any(AbortSignal)}));
    store.getState().setSearch('cancelled'); await store.getState().selectRepository('b'); bridge.rpc.mockClear();
    await vi.advanceTimersByTimeAsync(200); expect(bridge.rpc).not.toHaveBeenCalled();
  });
  it('bounds automatic deep locating while retaining loaded history and continuation', async () => {
    await store.getState().selectRepository('a'); const fallback=bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method,repoId,payload)=>method==='history'?{commits:[{...commit,oid:`page-${payload.offset}`}],tips:['fixed'],nextOffset:payload.offset+1,hasMore:true}:fallback(method,repoId,payload));
    bridge.rpc.mockClear(); await store.getState().locateCommit('very-old');
    expect(bridge.rpc.mock.calls.filter(([method])=>method==='history')).toHaveLength(20);
    expect(store.getState()).toMatchObject({hasMore:true,nextOffset:20,locatingOid:undefined,selectedOid:'very-old'});
    expect(store.getState().commits).toHaveLength(20); expect(store.getState().notice).toContain('Load More');
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
    await store.getState().selectRepository('a'); store.getState().setDraft('Draft A'); store.getState().setWorkingFilter('src/'); store.setState({ tab: 'changes' });
    await store.getState().selectRepository('b'); store.getState().setDraft('Draft B'); store.getState().setWorkingFilter('docs/');
    await store.getState().selectRepository('a');
    expect(store.getState().drafts).toEqual({ a: 'Draft A', b: 'Draft B' }); expect(store.getState().tab).toBe('changes');
    expect(store.getState().workingFilters).toEqual({ a: 'src/', b: 'docs/' });
    expect(bridge.save.mock.calls.at(-1)?.[0]).toMatchObject({ repoId: 'a', drafts: { a: 'Draft A', b: 'Draft B' } });
  });
  it.each([false, true])('clears only the submitted repository draft after Commit, preserving newer text (newer=%s)', async newer => {
    await store.getState().selectRepository('a'); store.getState().setDraft('  submitted\n');
    const result = deferred<Snapshot>(), fallback = bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method, ...args) => method === 'action' ? result.promise : fallback(method, ...args));
    const action = store.getState().execute({ type: 'commit', message: 'submitted' });
    await store.getState().selectRepository('b'); store.getState().setDraft('Draft B');
    if (newer) store.setState({ drafts: { ...store.getState().drafts, a: 'new draft A' } });
    result.resolve({ ...snapshot(a), head: 'created' });
    expect(await action).toBe(true);
    expect(store.getState().drafts).toEqual({ a: newer ? 'new draft A' : '', b: 'Draft B' });
    expect(bridge.save.mock.calls.at(-1)?.[0].drafts).toEqual(store.getState().drafts);
  });

  it('preserves the Commit draft when Git rejects the action', async () => {
    await store.getState().selectRepository('a'); store.getState().setDraft('keep this draft');
    const fallback = bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method, ...args) => method === 'action' ? Promise.reject(new Error('hook rejected')) : fallback(method, ...args));
    expect(await store.getState().execute({ type: 'commit', message: 'keep this draft' })).toBe(false);
    expect(store.getState().drafts.a).toBe('keep this draft');
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
  it('keeps the frozen Push destination and successful result after a refresh failure', async () => {
    await store.getState().selectRepository('a');
    const pushed = {kind:'push' as const,outcome:'success' as const,remote:'publish',localBranch:'topic',output:'done',destinations:[{label:'github.com/acme/repo',repository:{url:'https://github.com/acme/repo',label:'github.com/acme/repo',provider:'github' as const},refs:[{kind:'branch' as const,name:'release/x',status:'published' as const,url:'https://github.com/acme/repo/tree/release%2Fx'}]}]};
    const fallback=bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method,...args)=>method==='action'?Promise.resolve({result:pushed,refreshWarning:'Snapshot unavailable'}):method==='snapshot'?Promise.reject(new Error('Snapshot unavailable')):fallback(method,...args));
    expect(await store.getState().execute({type:'push',remote:'publish',branch:'topic',remoteBranch:'release/x'})).toBe(true);
    expect(store.getState().actionFeedback).toMatchObject({status:'success',result:pushed,refreshWarning:'Snapshot unavailable'});
    expect(store.getState().busy).toBe(false);
  });
  it('retains partial Push results while reporting failure', async () => {
    await store.getState().selectRepository('a');
    const pushed={kind:'push' as const,outcome:'partial' as const,destinations:[{label:'mirror',refs:[{kind:'branch' as const,name:'topic',status:'published' as const}]}],error:'other remote rejected',output:'partial'};
    const fallback=bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method,...args)=>method==='action'?Promise.reject(Object.assign(new Error('other remote rejected'),{pushResult:pushed})):fallback(method,...args));
    expect(await store.getState().execute({type:'push',branch:'topic'})).toBe(false);
    expect(store.getState().actionFeedback).toMatchObject({status:'error',result:pushed});
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
    expect(store.getState().notice).toBe('push ✓');
    await store.getState().refresh({ background: true }); expect(store.getState().actionFeedback?.status).toBe('success');
    store.getState().dismissFeedback(); expect(store.getState()).toMatchObject({actionFeedback:undefined,notice:undefined});
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
    const {menuFor}=await import('../webview/menus'),open=vi.fn(),noop=vi.fn(),api={startCommit:noop,open,checkout:noop,openDiff:noop,editFile:noop,host:vi.fn().mockResolvedValue(undefined),addRepository:vi.fn().mockResolvedValue(undefined),removeRepositories:noop,fetchRepositories:noop};
    store.setState({snapshot:snapshot(a)});
    const staged={path:'both.txt',target:{kind:'change' as const,path:'both.txt',area:'staged' as const}},unstaged={...staged,target:{...staged.target,area:'unstaged' as const}},untracked={path:'notes.txt',target:{kind:'change' as const,path:'notes.txt',area:'unstaged' as const}};
    const item=menuFor({kind:'files',primary:staged,files:[staged,unstaged,untracked]},api).items.find(item=>item.label==='Stash Selected Files…')!;
    expect(item.disabled).toBe(false);await item.run();expect(open).toHaveBeenCalledWith({type:'stash.create',paths:['both.txt','notes.txt']});
    store.setState({snapshot:{...snapshot(a),operation:{...snapshot(a).operation,conflicts:1}}});
    expect(menuFor({kind:'files',primary:staged,files:[staged]},api).items.find(item=>item.label==='Stash Selected Files…')?.disabled).toBe(true);
    const historical={path:'old.txt',target:{kind:'commit' as const,path:'old.txt',oid:commit.oid}};
    expect(menuFor({kind:'files',primary:historical,files:[historical]},api).items.some(item=>item.label==='Stash Selected Files…')).toBe(false);
  });

  it('captures the raw Tag identity in its deletion menu before a snapshot refresh', async () => {
    const {menuFor}=await import('../webview/menus'),open=vi.fn(),noop=vi.fn(),api={startCommit:noop,open,checkout:noop,openDiff:noop,editFile:noop,host:vi.fn().mockResolvedValue(undefined),addRepository:vi.fn().mockResolvedValue(undefined),removeRepositories:noop,fetchRepositories:noop};
    const tag={kind:'tag' as const,name:'v1',fullName:'refs/tags/v1',oid:'a'.repeat(40),refOid:'b'.repeat(40)};
    store.setState({snapshot:{...snapshot(a),refs:[tag]},language:'en'});
    const menu=menuFor({kind:'ref',ref:tag},api).items.find(item=>item.label==='Delete Tag…')!;
    const push=menuFor({kind:'ref',ref:tag},api).items.find(item=>item.label==='Push Tag…')!;push.run();
    expect(open).toHaveBeenCalledWith({type:'tag.push',names:['v1'],expectedOids:{v1:'b'.repeat(40)}});
    store.setState({snapshot:{...snapshot(a,2),refs:[{...tag,refOid:'c'.repeat(40)}]}});
    await menu.run();
    expect(open).toHaveBeenCalledWith({type:'tag.delete',target:'v1',expectedOid:'b'.repeat(40)});
    expect(menuFor({kind:'ref',ref:{...tag,refOid:undefined}},api).items.find(item=>item.label==='Delete Tag…')?.disabled).toBe(true);
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

  it('uses the action snapshot without reading the same worktree again', async () => {
    const current = await workingFixture(), fallback = bridge.rpc.getMockImplementation()!;
    current.changes[0].indexStatus = 'A';
    bridge.rpc.mockImplementation((method, ...args) => method === 'action' ? Promise.resolve(structuredClone(current)) : fallback(method, ...args));
    expect(await store.getState().execute({ type: 'stage', paths: ['a.txt'] })).toBe(true);
    expect(bridge.rpc.mock.calls.map(([method]) => method)).toEqual(['action']);
    expect(store.getState().snapshot?.changes[0].indexStatus).toBe('A');
  });

  it.each([false, true])('binds Commit feedback and its detail target to the action result across overlapping refreshes (amend=%s)', async amend => {
    await store.getState().selectRepository('a');
    const file = { path: 'notes.txt', indexStatus: 'M', worktreeStatus: 'M', conflict: false, untracked: false };
    store.setState({ snapshot: { ...snapshot(a), changes: [file] } });
    const returned = { ...snapshot(a, 2), head: 'committed', changes: [{ ...file, indexStatus: ' ' }] };
    const later = { ...snapshot(a, 3), head: 'later-head', changes: [file, { ...file, path: 'later.txt' }] };
    const history = deferred<HistoryPage>(), fallback = bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method, ...args) => method === 'action' ? Promise.resolve(returned) : method === 'history' ? history.promise : method === 'snapshot' ? Promise.resolve(later) : fallback(method, ...args));
    const operation = store.getState().execute({ type: 'commit', message: 'review', amend });
    await vi.waitFor(() => expect(store.getState().snapshot?.head).toBe('committed'));
    const background = store.getState().refresh({ background: true });
    await vi.waitFor(() => expect(store.getState().snapshot?.head).toBe('later-head'));
    history.resolve({ commits: [], tips: [], nextOffset: 0, hasMore: false });
    await Promise.all([operation, background]);
    const result = store.getState().actionFeedback?.result;
    expect(result).toEqual({ kind: 'commit', oid: 'committed', files: amend ? undefined : 1, remaining: 1, amended: amend });
    if (result?.kind !== 'commit') throw new Error('Missing Commit result');
    await store.getState().selectCommit(result.oid);
    expect(bridge.rpc.mock.calls.at(-1)).toMatchObject(['details', 'a', { oid: 'committed' }]);
  });

  it('preserves a successful Commit result when history refresh fails or the user switches repositories', async () => {
    await store.getState().selectRepository('a');
    const pending = deferred<Snapshot>(), fallback = bridge.rpc.getMockImplementation()!;
    bridge.rpc.mockImplementation((method, ...args) => method === 'action' ? pending.promise : fallback(method, ...args));
    const operation = store.getState().execute({ type: 'commit', message: 'review' });
    await store.getState().selectRepository('b');
    pending.resolve({ ...snapshot(a, 2), head: 'committed' });
    expect(await operation).toBe(true);
    expect(store.getState().actionFeedback).toBeUndefined();
    await store.getState().selectRepository('a');
    expect(store.getState().actionFeedback?.result).toMatchObject({ oid: 'committed', remaining: 0 });
    bridge.rpc.mockImplementation((method, ...args) => method === 'action' ? Promise.resolve({ ...snapshot(a, 3), head: 'next-commit' }) : method === 'history' ? Promise.reject(new Error('History unavailable')) : fallback(method, ...args));
    expect(await store.getState().execute({ type: 'commit', message: 'next' })).toBe(true);
    expect(store.getState()).toMatchObject({ actionFeedback: { status: 'success', result: { oid: 'next-commit', remaining: 0 } }, error: 'History unavailable' });
  });

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


it('keeps shortcut previews out of recovery saves, rolls back on Cancel and persists Apply', () => {
  const overrides = { fetch: [{ key: 'f', modifiers: ['primary' as const, 'shift' as const] }], push: [] };
  store.setState({ drafts: { a: 'keep draft' } });
  store.getState().beginSettings();
  store.getState().previewSettings({ shortcutOverrides: overrides });
  expect(store.getState().shortcutOverrides).toEqual(overrides);
  expect(bridge.save.mock.calls.at(-1)?.[0].shortcutOverrides).toEqual({});
  store.getState().finishSettings(false);
  expect(store.getState().shortcutOverrides).toEqual({});
  store.getState().beginSettings();
  store.getState().previewSettings({ shortcutOverrides: overrides });
  store.getState().finishSettings(true);
  expect(bridge.save.mock.calls.at(-1)?.[0]).toMatchObject({ shortcutOverrides: overrides, drafts: { a: 'keep draft' } });
});
