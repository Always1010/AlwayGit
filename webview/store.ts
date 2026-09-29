import { create } from 'zustand';
import type { Commit, CommitDetails, GitAction, HistoryQuery, Repository, Snapshot } from '../src/protocol/types';
import { demoMode, readSession, rpc, saveSession, subscribe } from './rpc';
let repositoryEpoch = 0, snapshotEpoch = 0, historyEpoch = 0, detailEpoch = 0;
const session = readSession();
const views = session.views ?? {};
const executingRepositories = new Set<string>();
interface WorkbenchState {
  repositories: Repository[]; repoId?: string; snapshot?: Snapshot; commits: Commit[]; details?: CommitDetails; selectedOid?: string; selectedStashOid?: string; stashDetails?: CommitDetails; ref?: string; search: string;
  nextOffset: number; hasMore: boolean; tips: string[]; loading: boolean; historyLoading: boolean; detailsLoading: boolean; busy: boolean; activity: string; error?: string; notice?: string; tab: 'history' | 'changes'; drafts: Record<string, string>;
  initialize(): Promise<void>; selectRepository(id: string): Promise<void>; refresh(): Promise<void>; loadHistory(append?: boolean): Promise<void>; selectCommit(oid: string, parent?: string, stashOid?: string): Promise<void>; setFilter(ref?: string, search?: string): void; execute(action: GitAction): Promise<boolean>; setDraft(value: string): void; report(error: unknown): void;
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
export const useWorkbench = create<WorkbenchState>((set, get) => ({
  repositories: [], commits: [], search: '', nextOffset: 0, tips: [], hasMore: false, loading: false, historyLoading: false, detailsLoading: false, busy: false, activity: '', tab: 'history', drafts: session.drafts ?? {},
  report(error) { set({ error: errorMessage(error) }); },
  async initialize() {
    set({ loading: true });
    try { const repositories = await rpc<Repository[]>('repositories'); set({ repositories }); const current = get().repoId; if (!repositories.some(r => r.id === current)) { const initial = repositories.find(repo => repo.id === session.repoId) ?? repositories[0]; if (initial) await get().selectRepository(initial.id); else set({ repoId: undefined, snapshot: undefined, commits: [], details: undefined }); } }
    catch (error) { get().report(error); } finally { set({ loading: false }); }
  },
  async selectRepository(id) {
    ++repositoryEpoch; ++historyEpoch; ++detailEpoch;
    const view = views[id];
    set({ repoId: id, snapshot: undefined, commits: [], tips: [], details: undefined, stashDetails: undefined, selectedOid: view?.selectedOid, selectedStashOid: view?.selectedStashOid, ref: view?.ref, search: view?.search ?? '', tab: view?.tab ?? 'history', error: undefined, loading: true, busy: executingRepositories.has(id), activity: '', detailsLoading: false, historyLoading: false });
    await get().refresh();
  },
  async refresh() {
    const epoch = repositoryEpoch, requestEpoch = ++snapshotEpoch, repoId = get().repoId; if (!repoId) return;
    set({ loading: true });
    try { const snapshot = await rpc<Snapshot>('snapshot', repoId); if (epoch !== repositoryEpoch || requestEpoch !== snapshotEpoch || snapshot.version < (get().snapshot?.version ?? -1)) return; set({ snapshot }); await get().loadHistory(); }
    catch (error) { if (epoch === repositoryEpoch && requestEpoch === snapshotEpoch) get().report(error); }
    finally { if (epoch === repositoryEpoch && requestEpoch === snapshotEpoch) set({ loading: false }); }
  },
  async loadHistory(append = false) {
    const { repoId, ref, search, nextOffset, historyLoading } = get(); if (!repoId || append && historyLoading) return;
    const epoch = ++historyEpoch, repoEpoch = repositoryEpoch;
    set({ historyLoading: true });
    try {
      const query: HistoryQuery = { offset: append ? nextOffset : 0, ...(append ? { tips: get().tips } : {}), ...(ref ? { ref } : {}), ...(search ? { search } : {}) };
      const page = await rpc<{ commits: Commit[]; nextOffset: number; hasMore: boolean; tips: string[] }>('history', repoId, query);
      if (epoch !== historyEpoch || repoEpoch !== repositoryEpoch) return;
      const all = append ? [...get().commits, ...page.commits.filter(c => !get().commits.some(existing => existing.oid === c.oid))] : page.commits;
      set({ commits: all, tips: page.tips, nextOffset: page.nextOffset, hasMore: page.hasMore });
      const stashSelected = !!get().selectedStashOid && get().snapshot?.stashes.some(stash => stash.oid === get().selectedStashOid);
      if (!append && all.length && !all.some(c => c.oid === get().selectedOid) && !stashSelected) void get().selectCommit(all[0].oid);
      else if (!append && !all.length) { ++detailEpoch; set({ selectedOid: undefined, details: undefined, detailsLoading: false }); }
      else if (!append && get().selectedOid) void get().selectCommit(get().selectedOid!, undefined, stashSelected ? get().selectedStashOid : undefined);
    } catch (error) { if (epoch === historyEpoch && repoEpoch === repositoryEpoch) get().report(error); }
    finally { if (epoch === historyEpoch && repoEpoch === repositoryEpoch) set({ historyLoading: false }); }
  },
  async selectCommit(oid, parent, stashOid) {
    const epoch = ++detailEpoch, repoEpoch = repositoryEpoch, repoId = get().repoId;
    const selectedStashOid = stashOid ?? (oid === get().selectedOid ? get().selectedStashOid : undefined);
    set({ selectedOid: oid, selectedStashOid, details: undefined, detailsLoading: true });
    try {
      const [details, stashDetails] = await Promise.all([rpc<CommitDetails>('details', repoId, { oid, parent }), selectedStashOid && selectedStashOid !== oid && get().stashDetails?.commit.oid !== selectedStashOid ? rpc<CommitDetails>('details', repoId, { oid: selectedStashOid }) : Promise.resolve(get().stashDetails)]);
      if (epoch === detailEpoch && repoEpoch === repositoryEpoch) set({ details, stashDetails: selectedStashOid === oid ? details : stashDetails });
    }
    catch (error) { if (epoch === detailEpoch && repoEpoch === repositoryEpoch) get().report(error); }
    finally { if (epoch === detailEpoch && repoEpoch === repositoryEpoch) set({ detailsLoading: false }); }
  },
  setFilter(ref, search = get().search) { set({ ref, search, tips: [], selectedStashOid: undefined }); void get().loadHistory(); },
  async execute(action) {
    const repoId = get().repoId, epoch = repositoryEpoch; if (!repoId || get().busy) return false;
    executingRepositories.add(repoId); set({ busy: true, activity: action.type, error: undefined, notice: undefined });
    try {
      await rpc('action', repoId, action);
      if (epoch === repositoryEpoch) { await get().refresh(); set({ notice: demoMode ? `Demo: ${action.type} completed in sample data. No repository files were changed.` : `${action.type} completed.` }); }
      return true;
    } catch (error) { if (epoch === repositoryEpoch) get().report(error); return false; }
    finally { executingRepositories.delete(repoId); if (epoch === repositoryEpoch) set({ busy: false, activity: '' }); }
  },
  setDraft(value) { const repoId = get().repoId; if (!repoId) return; set({ drafts: { ...get().drafts, [repoId]: value } }); },
}));
useWorkbench.subscribe(state => {
  if (state.repoId) views[state.repoId] = { ref: state.ref, search: state.search, selectedOid: state.selectedOid, selectedStashOid: state.selectedStashOid, tab: state.tab };
  saveSession({ repoId: state.repoId, drafts: state.drafts, views });
});
let changedTimer: ReturnType<typeof setTimeout>;
subscribe(event => {
  const store = useWorkbench.getState();
  if (event.type === 'repositoriesChanged') void store.initialize();
  if (event.type === 'changed' && event.repoId === store.repoId) { clearTimeout(changedTimer); changedTimer = setTimeout(() => { void useWorkbench.getState().refresh(); }, 160); }
  if (event.type === 'activity' && event.repoId === store.repoId) useWorkbench.setState({ busy: event.busy || executingRepositories.has(event.repoId), activity: event.label });
  if (event.type === 'selectRepository') void store.selectRepository(event.repoId);
});
