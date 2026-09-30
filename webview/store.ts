import { create } from 'zustand';
import type { Commit, CommitDetails, DiffTarget, GitAction, HistoryQuery, Repository, Snapshot } from '../src/protocol/types';
import { demoMode, readSession, rpc, saveSession, subscribe } from './rpc';
import type { LayoutState } from './rpc';
import type { Language } from './i18n';

let repositoryEpoch = 0, snapshotEpoch = 0, historyEpoch = 0, detailEpoch = 0;
const session = readSession(), views = session.views ?? {}, executingRepositories = new Set<string>(), hostBusyRepositories = new Set<string>();
export const defaultLayout: LayoutState = { preset: 'workbench', sidebar: 210, details: 300, diff: 220, author: 100, date: 120, font: 13, row: 26 };
export interface CheckoutFailure { reason?: string; paths: string[]; target: string; worktreePath?: string; stashCreated?: boolean; stashOid?: string; detached?: boolean }
interface WorkbenchState {
  repositories: Repository[]; repoId?: string; snapshot?: Snapshot; commits: Commit[]; details?: CommitDetails; selectedOid?: string; selectedStashOid?: string; stashDetails?: CommitDetails; selectedFile?: string; diffTarget?: DiffTarget;
  ref?: string; checkedRefs?: string[]; search: string; language: Language; layout: LayoutState; checkoutFailure?: CheckoutFailure; locateToken:number;
  nextOffset: number; hasMore: boolean; tips: string[]; loading: boolean; historyLoading: boolean; detailsLoading: boolean; busy: boolean; activity: string; error?: string; notice?: string; tab: 'history' | 'changes'; drafts: Record<string, string>;
  initialize(): Promise<void>; selectRepository(id: string): Promise<void>; refresh(): Promise<void>; loadHistory(append?: boolean): Promise<void>; selectCommit(oid: string, parent?: string, stashOid?: string): Promise<void>;
  setFilter(ref?: string, search?: string): void; setCheckedRefs(refs: string[]): void; setSearch(value: string): void; selectWorking(): void; selectFile(target: DiffTarget): void; locateHead():void;
  execute(action: GitAction): Promise<boolean>; setDraft(value: string): void; setLanguage(value: Language): void; setLayout(value: Partial<LayoutState>): void; report(error: unknown): void;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const clamp = (n: number, min: number, max: number, fallback: number) => Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
function layout(value: Partial<LayoutState> = {}): LayoutState {
  const l = { ...defaultLayout, ...value };
  return { preset: l.preset === 'editor' ? 'editor' : 'workbench', sidebar: clamp(l.sidebar, 160, 360, 210), details: clamp(l.details, 230, 480, 300), diff: clamp(l.diff, 130, 450, 220), author: clamp(l.author, 64, 220, 100), date: clamp(l.date, 82, 220, 120), font: clamp(l.font, 12, 16, 13), row: clamp(l.row, 24, 36, 26) };
}
export const useWorkbench = create<WorkbenchState>((set, get) => ({
  repositories: [], commits: [], search: '', language: session.language === 'zh-CN' ? 'zh-CN' : 'en', layout: layout(session.layout), locateToken:0,nextOffset: 0, tips: [], hasMore: false, loading: false, historyLoading: false, detailsLoading: false, busy: false, activity: '', tab: 'history', drafts: session.drafts ?? {},
  report(error) { set({ error: message(error) }); },
  async initialize() {
    set({ loading: true });
    try { const repositories = await rpc<Repository[]>('repositories'); set({ repositories }); if (!repositories.some(r => r.id === get().repoId)) { const initial = repositories.find(r => r.id === session.repoId) ?? repositories[0]; if (initial) await get().selectRepository(initial.id); else set({ repoId: undefined, snapshot: undefined, commits: [], details: undefined }); } }
    catch (error) { get().report(error); } finally { set({ loading: false }); }
  },
  async selectRepository(id) {
    ++repositoryEpoch; ++historyEpoch; ++detailEpoch; const view = views[id];
    set({ repoId: id, snapshot: undefined, commits: [], tips: [], details: undefined, stashDetails: undefined, diffTarget: undefined, selectedFile: view?.selectedFile, selectedOid: view?.selectedOid, selectedStashOid: view?.selectedStashOid, ref: view?.ref, checkedRefs: view?.checkedRefs ? [...view.checkedRefs] : view?.ref ? [view.ref] : undefined, search: view?.search ?? '', tab: view?.tab ?? 'history', checkoutFailure: undefined, error: undefined, notice: undefined, loading: true, busy: executingRepositories.has(id), activity: '', detailsLoading: false, historyLoading: false });
    await get().refresh();
  },
  async refresh() {
    const epoch = repositoryEpoch, request = ++snapshotEpoch, repoId = get().repoId; if (!repoId) return; set({ loading: true });
    try {
      const snapshot = await rpc<Snapshot>('snapshot', repoId); if (epoch !== repositoryEpoch || request !== snapshotEpoch || snapshot.version < (get().snapshot?.version ?? -1)) return;
      const initial = get().checkedRefs === undefined;
      const checkedRefs = initial ? [snapshot.refs.find(r => r.kind === 'local' && r.name === snapshot.branch)?.fullName ?? (snapshot.head ? 'HEAD' : ''), snapshot.refs.find(r => r.kind === 'remote' && r.name === snapshot.upstream)?.fullName ?? ''].filter(Boolean) : get().checkedRefs!.filter(ref => ref === 'HEAD' || snapshot.refs.some(r => r.fullName === ref));
      set({ snapshot, checkedRefs }); await get().loadHistory(); if (get().tab === 'changes') get().selectWorking();
    } catch (error) { if (epoch === repositoryEpoch && request === snapshotEpoch) get().report(error); }
    finally { if (epoch === repositoryEpoch && request === snapshotEpoch) set({ loading: false }); }
  },
  async loadHistory(append = false) {
    const { repoId, search, nextOffset, historyLoading, checkedRefs } = get(); if (!repoId || append && historyLoading) return;
    const epoch = ++historyEpoch, repoEpoch = repositoryEpoch; set({ historyLoading: true });
    try {
      const query: HistoryQuery = { offset: append ? nextOffset : 0, tips: append ? get().tips : checkedRefs ?? [], ...(search ? { search } : {}) };
      const page = await rpc<{ commits: Commit[]; nextOffset: number; hasMore: boolean; tips: string[] }>('history', repoId, query);
      if (epoch !== historyEpoch || repoEpoch !== repositoryEpoch) return;
      const prior = new Set(get().commits.map(c => c.oid)), all = append ? [...get().commits, ...page.commits.filter(c => !prior.has(c.oid))] : page.commits;
      set({ commits: all, tips: page.tips, nextOffset: page.nextOffset, hasMore: page.hasMore });
      const stashSelected = !!get().selectedStashOid && get().snapshot?.stashes.some(s => s.oid === get().selectedStashOid);
      if(get().selectedStashOid&&!stashSelected)set({selectedStashOid:undefined,stashDetails:undefined,selectedOid:all[0]?.oid,details:undefined});
      if (!append && get().tab === 'history' && !get().selectedOid && all.length) void get().selectCommit(all[0].oid);
      else if (!append && get().tab === 'history' && get().selectedOid) void get().selectCommit(get().selectedOid!, undefined, stashSelected ? get().selectedStashOid : undefined);
    } catch (error) { if (epoch === historyEpoch && repoEpoch === repositoryEpoch) get().report(error); }
    finally { if (epoch === historyEpoch && repoEpoch === repositoryEpoch) set({ historyLoading: false }); }
  },
  async selectCommit(oid, parent, stashOid) {
    const epoch = ++detailEpoch, repoEpoch = repositoryEpoch, repoId = get().repoId, same = oid === get().selectedOid;
    const selectedStashOid = stashOid ?? (same ? get().selectedStashOid : undefined);
    set({ selectedOid: oid, selectedStashOid, details: undefined, detailsLoading: true, tab: 'history', diffTarget: undefined });
    try {
      const [details, stashDetails] = await Promise.all([rpc<CommitDetails>('details', repoId, { oid, parent }), selectedStashOid && selectedStashOid !== oid && get().stashDetails?.commit.oid !== selectedStashOid ? rpc<CommitDetails>('details', repoId, { oid: selectedStashOid }) : Promise.resolve(get().stashDetails)]);
      if (epoch !== detailEpoch || repoEpoch !== repositoryEpoch) return;
      set({ details, stashDetails: selectedStashOid === oid ? details : stashDetails });
      const file = (same ? details.files.find(f => f.path === get().selectedFile) : undefined) ?? details.files[0];
      if (file) get().selectFile({ kind: 'commit', oid, path: file.path, previousPath: file.previousPath, parent: details.parent }); else set({ selectedFile: undefined, diffTarget: undefined });
    } catch (error) { if (epoch === detailEpoch && repoEpoch === repositoryEpoch) get().report(error); }
    finally { if (epoch === detailEpoch && repoEpoch === repositoryEpoch) set({ detailsLoading: false }); }
  },
  setFilter(ref, search = get().search) { set({ ref, checkedRefs: ref ? [ref] : get().snapshot?.refs.filter(r => r.kind !== 'tag').map(r => r.fullName) ?? [], search, tips: [], selectedStashOid: undefined }); void get().loadHistory(); },
  setCheckedRefs(refs) { set({ checkedRefs: [...new Set(refs)], ref: undefined, tips: [] }); void get().loadHistory(); },
  setSearch(search) { set({ search, tips: [] }); void get().loadHistory(); },
  selectWorking() {
    ++detailEpoch; const file = get().snapshot?.changes.find(f => f.path === get().selectedFile) ?? get().snapshot?.changes[0]; set({ tab: 'changes', detailsLoading: false });
    if (file) get().selectFile({ kind: 'change', path: file.path, area: file.conflict ? 'conflict' : file.worktreeStatus !== ' ' || file.untracked ? 'unstaged' : 'staged' }); else set({ selectedFile: undefined, diffTarget: undefined });
  },
  selectFile(target) { set({ selectedFile: target.path, diffTarget: target }); },
  locateHead(){const snapshot=get().snapshot;if(!snapshot?.head)return;const ref=snapshot.refs.find(r=>r.kind==='local'&&r.name===snapshot.branch)?.fullName??'HEAD';set({checkedRefs:[...new Set([...(get().checkedRefs??[]),ref])],search:'',locateToken:get().locateToken+1,selectedStashOid:undefined});void get().loadHistory();void get().selectCommit(snapshot.head);},
  async execute(action) {
    const repoId = get().repoId, epoch = repositoryEpoch; if (!repoId || get().busy) return false;
    executingRepositories.add(repoId); set({ busy: true, activity: action.type, error: undefined, notice: undefined, checkoutFailure: undefined });
    try {
      await rpc('action', repoId, action);
      if (epoch === repositoryEpoch) {
        await get().refresh();
        if(epoch!==repositoryEpoch)return true;
        const checkout = ['branch.checkout', 'commit.checkout', 'checkout.stash'].includes(action.type) || action.type === 'branch.create' && action.checkout;
        if (checkout) { const snap = get().snapshot; const ref = snap?.refs.find(r => r.kind === 'local' && r.name === snap.branch)?.fullName ?? (snap?.head ? 'HEAD' : undefined); if (ref && !get().checkedRefs?.includes(ref)) get().setCheckedRefs([...(get().checkedRefs ?? []), ref]); }
        set({ notice: demoMode ? (get().language === 'zh-CN' ? `模拟操作：${action.type}；未修改实际仓库。` : `Demo: ${action.type} completed. No disk changes.`) : `${action.type} ✓` });
      }
      return true;
    } catch (error) {
      if (epoch === repositoryEpoch) {
        const structured = error as { code?: string; details?: CheckoutFailure };
        set({ error: message(error), checkoutFailure: structured.details?.target ? { ...structured.details, detached: action.type === 'commit.checkout' || action.type === 'checkout.stash' && action.detached } : undefined });
        if (structured.details?.stashCreated) await get().refresh();
      }
      return false;
    } finally { executingRepositories.delete(repoId); if (get().repoId===repoId) set({ busy: hostBusyRepositories.has(repoId), activity: hostBusyRepositories.has(repoId)?get().activity:'' }); }
  },
  setDraft(value) { const repoId = get().repoId; if (repoId) set({ drafts: { ...get().drafts, [repoId]: value } }); },
  setLanguage(language) { set({ language }); },
  setLayout(value) { set({ layout: layout({ ...get().layout, ...value }) }); },
}));
useWorkbench.subscribe(state => {
  if (state.repoId) views[state.repoId] = { ref: state.ref, checkedRefs: state.checkedRefs, search: state.search, selectedOid: state.selectedOid, selectedStashOid: state.selectedStashOid, selectedFile: state.selectedFile, tab: state.tab };
  saveSession({ version: 2, repoId: state.repoId, drafts: state.drafts, views, language: state.language, layout: state.layout });
});
let changedTimer: ReturnType<typeof setTimeout>;
subscribe(event => {
  const state = useWorkbench.getState(); if (event.type === 'repositoriesChanged') void state.initialize();
  if (event.type === 'changed' && event.repoId === state.repoId) { clearTimeout(changedTimer); changedTimer = setTimeout(() => { void useWorkbench.getState().refresh(); }, 160); }
  if(event.type==='activity'){if(event.busy)hostBusyRepositories.add(event.repoId);else hostBusyRepositories.delete(event.repoId);if(event.repoId===state.repoId)useWorkbench.setState({busy:event.busy||executingRepositories.has(event.repoId),activity:event.label});}
  if (event.type === 'selectRepository') void state.selectRepository(event.repoId);
});
