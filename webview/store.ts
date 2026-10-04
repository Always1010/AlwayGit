import { selectedTagRemote, tagQueryKey, tagQueryRetryDelay, type TagQuery } from './tagStatus';
import type { RemoteTags } from '../src/protocol/types';
import { normalizeShortcutOverrides, type ShortcutOverrides } from '../src/protocol/shortcuts';
import { useDock } from './dock-store';
import { translate, uiText, setLanguageReader } from './text';
import { create } from 'zustand';
import { errorMessage } from './rpc-error';
import type { ActionResponse, HostingRepository, CheckoutBlocker, Commit, CommitComparison, CommitDetails, DiffTarget, GitAction, HistoryPage, HistoryQuery, OperationReview, OperationSettings, Repository, RepositoryChanges, RepositoryCollection, RepositoryOrder, ReorderRepository, RepositoryStatus, Snapshot, StashApplyBlocker, StashDetails, StashSection } from '../src/protocol/types';
import { demoMode, readSession, rpc, saveSession, subscribe } from './rpc';
import type { LayoutState } from './rpc';
import type { DiffNavigationScope } from '../src/protocol/session';
import { defaultLayout, interfaceSettingsSchema, overlayInterfaceSettings, type InterfacePreferences, type InterfacePreferencesUpdate } from '../src/protocol/interface-settings';
import type { Language } from './i18n';
import { folderKeys } from './refTree';
import { affectsWorkingDiff, diffKey, historyKey, mergeChanges, shareSnapshot, shareValue, workingTarget } from './refresh';
import { actionTarget } from './actionFeedback';
import type { ActionFeedback } from './actionFeedback';
import { normalizeAppearance, type Appearance, type InterfaceSettings, type InterfaceSettingsUpdate } from './appearance';
import { groupRepositories } from '../src/protocol/repositories';

let catalogEpoch = 0, repositoryEpoch = 0, repositoryStatusEpoch = 0, snapshotEpoch = 0, historyEpoch = 0, detailEpoch = 0;
let tagController: AbortController | undefined;
let tagQuerySequence = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let historyController: AbortController | undefined;
function cancelSearchTimer() { clearTimeout(searchTimer); searchTimer = undefined; }
let refreshInvalidation: { epoch: number; changes?: RepositoryChanges; forceHistory: boolean } | undefined;
const session = readSession(), views = session.views ?? {}, executingRepositories = new Set<string>(), hostBusyRepositories = new Set<string>();
const actionFeedbacks = new Map<string, ActionFeedback>();
let actionSequence = 0;
export interface RepositoryActionContext { repoId?: string; epoch: number }
export function captureActionContext(): RepositoryActionContext { return { repoId: useWorkbench.getState().repoId, epoch: repositoryEpoch }; }
export function isActionContextCurrent(context: RepositoryActionContext): boolean { return context.repoId === useWorkbench.getState().repoId && context.epoch === repositoryEpoch; }
export { defaultLayout } from '../src/protocol/interface-settings';
let preferencesEpoch = 0;
export type CheckoutFailure = CheckoutBlocker & { detached?: boolean };
interface HistoryView {
  refs: string[]; search: string; commits: Commit[]; head?: Commit; tips: string[]; nextOffset: number; hasMore: boolean;
  selectedOid?: string; selectedParent?: string; selectedStashOid?: string; selectedFile?: string; tab: 'history' | 'changes';
  scrollTop: number; key: string;
}
const historyViews = new Map<string, HistoryView[]>();
function rememberHistory(): void {
  const state = useWorkbench.getState(), displayed = state.displayedHistory;
  if (!state.repoId || !state.snapshot || !displayed || state.historyLoading) return;
  const stack = historyViews.get(state.repoId) ?? [], last = stack.at(-1);
  if (last && last.search === displayed.search && last.refs.join('\0') === displayed.refs.join('\0') && last.selectedOid === state.selectedOid && last.tab === state.tab && last.scrollTop === state.historyScrollTop) return;
  const cacheable = state.commits.length <= 10_000;
  stack.push({ refs: [...displayed.refs], search: displayed.search, commits: cacheable ? state.commits : [], head: state.historyHead, tips: state.tips,
    nextOffset: state.nextOffset, hasMore: state.hasMore, selectedOid: state.selectedOid, selectedParent: state.selectedParent,
    selectedStashOid: state.selectedStashOid, selectedFile: state.selectedFile, tab: state.tab, scrollTop: state.historyScrollTop,
    key: cacheable ? state.displayedHistoryKey ?? historyKey(state.snapshot, displayed.refs) : '' });
  while (stack.length > 12 || stack.length > 1 && stack.reduce((count, view) => count + view.commits.length, 0) > 24_000) stack.shift();
  historyViews.set(state.repoId, stack);
  if (historyViews.size > 8) historyViews.delete(historyViews.keys().next().value!);
  useWorkbench.setState({ historyBackDepth: stack.length });
}
interface WorkbenchState {
  tagRemote?: string; tagQueries: Record<string, TagQuery>;
  setTagRemote(remote: string): void; loadTagStatuses(force?: boolean, remote?: string): Promise<void>;
  catalogState: 'loading' | 'ready' | 'error'; catalogError?: string;
  historyBackDepth: number; historyScrollTop: number; historyRestoreTop: number; historyRestoreToken: number;
  backHistory(): void; resetHistory(): void; setHistoryScroll(top: number): void;
  locateRef(ref: string, oid: string): void;
  displayedHistory?: { refs: string[]; search: string }; displayedHistoryKey?: string; historyError?: string;
  remoteRequest?: { repoId: string; branch: string; repositories: HostingRepository[]; defaultBranch?: string };
  operationReview?: { repoId: string; action: Extract<GitAction, { type: 'commit' | 'operation.continue' }>; review: OperationReview };
  operationSettings: OperationSettings; loadOperationSettings(): Promise<void>; saveOperationSettings(settings: Pick<OperationSettings,'allowDetachedHead' | 'pushFollowTags' | 'pushTagAfterCreate' | 'defaultResetMode'>, scope?: OperationSettings['scope']): Promise<void>;
  appearance: Appearance; diffNavigationScope: DiffNavigationScope; singleKeyShortcuts: boolean; shortcutOverrides: ShortcutOverrides; changeListMode: 'split' | 'unified'; settingsBaseline?: InterfaceSettings;
  beginSettings(): void; previewSettings(value: InterfaceSettingsUpdate): void; finishSettings(apply: boolean): Promise<void>; restoreLayout(): void;
  repositories: Repository[]; repositoryCollections:RepositoryCollection[]; repositoryOrder?:RepositoryOrder; reorderRepository(payload:ReorderRepository):Promise<void>; repositoryStatuses: Record<string, RepositoryStatus>; selectedRepositoryKeys:string[]; repositorySelectionAnchor?:string; selectedWorktreePaths:string[]; worktreeSelectionAnchor?:string; repoId?: string; snapshot?: Snapshot; commits: Commit[]; historyHead?: Commit; details?: CommitDetails; comparison?: CommitComparison; selectedOid?: string; selectedOids: string[]; selectionAnchor?: string; selectedRefs:string[]; refSelectionAnchor?:string; selectedParent?: string; selectedStashOid?: string; selectedStashSection?:StashSection; stashDetails?: StashDetails; selectedFile?: string; diffTarget?: DiffTarget; diffRevision: number;
  ref?: string; checkedRefs?: string[]; expandedRefGroups?:string[]; collapsedSidebarGroups:string[]; search: string; language: Language; layout: LayoutState; checkoutFailure?: CheckoutFailure; stashApplyFailure?: StashApplyBlocker; actionFeedback?: ActionFeedback; locateToken:number;
  nextOffset: number; hasMore: boolean; tips: string[]; loading: boolean; historyLoading: boolean; locatingOid?: string; locateCommit(oid: string, append?: boolean): Promise<void>; detailsLoading: boolean; busy: boolean; activity: string; error?: string; notice?: string; tab: 'history' | 'changes'; drafts: Record<string, string>;
  initialize(): Promise<void>; loadRepositoryStatuses(): Promise<void>; selectRepository(id: string): Promise<void>; refresh(options?: { background?: boolean; changes?: RepositoryChanges; snapshot?: Snapshot }): Promise<void>; loadHistory(append?: boolean): Promise<void>; selectCommit(oid: string, parent?: string, stashOid?: string, preserveSelection?: boolean): Promise<void>; selectStashSection(section:StashSection):void; compareCommits(left:string,right:string,preserveOrder?:boolean):Promise<void>; setCommitSelection(oids:string[],anchor?:string,primary?:string):void; setRefSelection(refs:string[],anchor?:string):void; setRepositorySelection(keys:string[],anchor?:string):void; setWorktreeSelection(paths:string[],anchor?:string):void;
  setFilter(ref?: string, search?: string): void; setCheckedRefs(refs: string[]): void; setExpandedRefGroup(key:string,expanded:boolean):void; toggleSidebarGroup(key:string):void; setSearch(value: string): void; selectWorking(): void; selectFile(target: DiffTarget, activate?: boolean): void; locateHead():void;
  workingFilters: Record<string, string>; setWorkingFilter(value: string): void;
  execute(action: GitAction, context?: RepositoryActionContext): Promise<boolean>; dismissFeedback(): void; setDraft(value: string): void; setLanguage(value: Language): void; setLayout(value: Partial<LayoutState>): void; report(error: unknown): void;
}
const message = (error: unknown) => errorMessage(error, useWorkbench.getState().language);
const clamp = (n: number, min: number, max: number, fallback: number) => Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
function layout(value: Partial<LayoutState> = {}): LayoutState {
  const l = { ...defaultLayout, ...value };
  return { preset: 'workbench', sidebar: clamp(l.sidebar, 160, 360, 210), details: clamp(l.details, 230, 480, 300), diff: clamp(l.diff, 130, 1400, 220), diffCollapsed: Boolean(l.diffCollapsed), graph: clamp(l.graph, 48, 180, 64), author: clamp(l.author, 64, 220, 100), date: clamp(l.date, 82, 220, 120), font: Math.round(clamp(l.font, 12, 16, 13)), row: Math.round(clamp(l.row, 22, 36, 24)) };
}
function interfaceSnapshot(state: Pick<WorkbenchState, 'language' | 'layout' | 'appearance' | 'diffNavigationScope' | 'singleKeyShortcuts' | 'shortcutOverrides' | 'changeListMode'>): InterfaceSettings {
  return { language: state.language, font: state.layout.font, row: state.layout.row, appearance: state.appearance,
    diffNavigationScope: state.diffNavigationScope, singleKeyShortcuts: state.singleKeyShortcuts, shortcutOverrides: state.shortcutOverrides, changeListMode: state.changeListMode };
}
function preferenceChanges(next: InterfaceSettings, baseline: InterfaceSettings): InterfacePreferencesUpdate {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof InterfaceSettings)[]) {
    if (JSON.stringify(next[key]) === JSON.stringify(baseline[key])) continue;
    if (key === 'appearance') {
      patch.appearance = Object.fromEntries(Object.entries(next.appearance).filter(([field, value]) => JSON.stringify(value) !== JSON.stringify(baseline.appearance[field as keyof Appearance])));
    } else patch[key] = next[key];
  }
  return patch as InterfacePreferencesUpdate;
}
function settingsState(settings: InterfaceSettings, current: WorkbenchState): Partial<WorkbenchState> {
  const { font, row, ...rest } = settings;
  return { ...rest, layout: layout({ ...current.layout, font, row }) };
}
function synchronizeInterfaceSettings(preferences: InterfacePreferences): void {
  const current = useWorkbench.getState();
  const saved = overlayInterfaceSettings({ layout: current.layout }, preferences);
  const baseline: InterfaceSettings = { language: saved.language === 'zh-CN' ? 'zh-CN' : 'en', font: saved.layout!.font, row: saved.layout!.row,
    appearance: normalizeAppearance(saved.appearance), changeListMode: saved.changeListMode ?? 'split', diffNavigationScope: saved.diffNavigationScope ?? 'commit',
    singleKeyShortcuts: saved.singleKeyShortcuts !== false, shortcutOverrides: normalizeShortcutOverrides(saved.shortcutOverrides) };
  if (!current.settingsBaseline) { useWorkbench.setState(settingsState(baseline, current)); return; }
  const draft = preferenceChanges(interfaceSnapshot(current), current.settingsBaseline);
  const preview = { ...baseline, ...draft, appearance: normalizeAppearance({ ...baseline.appearance, ...draft.appearance }) } as InterfaceSettings;
  useWorkbench.setState({ ...settingsState(preview, current), settingsBaseline: baseline });
}
const initialLayout = layout(session.layout);
// Only the old default density migrates; custom dimensions and drafts are kept.
if (!session.appearance && initialLayout.row === 26) initialLayout.row = 24;
export const useWorkbench = create<WorkbenchState>((set, get) => ({
  tagQueries: {},
  setTagRemote(remote) {
    if (!get().snapshot?.remotes?.includes(remote)) return;
    tagController?.abort(); ++tagQuerySequence;
    set(state => ({ tagRemote: remote, tagQueries: Object.fromEntries(Object.entries(state.tagQueries).map(([key, value]) => [key, value.loading ? { ...value, loading: false, attemptedAt: 0 } : value])) })); void get().loadTagStatuses();
  },
  async loadTagStatuses(force = false, requestedRemote) {
    const snapshot = get().snapshot, repoId = get().repoId;
    const remote = requestedRemote ?? selectedTagRemote(snapshot, get().tagRemote);
    if (!snapshot || !repoId || !remote || !snapshot.remoteReadDestinations?.[remote]) return;
    const key = tagQueryKey(snapshot, remote), previous = get().tagQueries[key];
    if (!force && previous && (previous.loading || !!previous.result || Date.now() - previous.attemptedAt < tagQueryRetryDelay)) return;
    tagController?.abort(); const controller = tagController = new AbortController(), sequence = ++tagQuerySequence;
    set(state => ({ tagQueries: { ...Object.fromEntries(Object.entries(state.tagQueries).slice(-31).map(([key, value]) => [key, { ...value, loading: false }])), [key]: { ...previous, requestId: sequence, loading: true, attemptedAt: Date.now(), error: undefined } } }));
    const active = () => sequence === tagQuerySequence && get().repoId === repoId && get().snapshot && tagQueryKey(get().snapshot!, remote) === key;
    try {
      const result = await rpc<RemoteTags>('remoteTags', repoId, { remote, expectedDestination: snapshot.remoteReadDestinations[remote] }, { signal: controller.signal });
      if (!active()) return;
      if (!result || result.remote !== remote || result.destination !== snapshot.remoteReadDestinations[remote] || !result.refs || !Number.isFinite(result.checkedAt)) throw new Error(uiText('tags.unavailable'));
      set(state => ({ tagQueries: { ...state.tagQueries, [key]: { result, loading: false, attemptedAt: Date.now() } } }));
    } catch (error) {
      if (!active()) return;
      set(state => ({ tagQueries: { ...state.tagQueries, [key]: { ...state.tagQueries[key], loading: false, error: message(error) } } }));
    } finally {
      if (get().tagQueries[key]?.requestId === sequence && get().tagQueries[key]?.loading) set(state => ({ tagQueries: { ...state.tagQueries, [key]: { ...state.tagQueries[key], loading: false, attemptedAt: 0 } } }));
      if (sequence === tagQuerySequence) tagController = undefined;
    }
  },
  historyBackDepth: 0, historyScrollTop: 0, historyRestoreTop: 0, historyRestoreToken: 0,
  setHistoryScroll(top) { set({ historyScrollTop: Math.max(0, top) }); },
  backHistory() {
    const state = get(), stack = state.repoId ? historyViews.get(state.repoId) : undefined, view = stack?.pop();
    if (!view || !state.snapshot) return;
    cancelSearchTimer(); historyController?.abort(); ++historyEpoch; ++detailEpoch;
    const valid = view.key === historyKey(state.snapshot, view.refs);
    set({ historyBackDepth: stack!.length, checkedRefs: view.refs.filter(ref => ref === 'HEAD' || state.snapshot!.refs.some(item => item.fullName === ref)), search: view.search, ref: undefined,
      commits: valid ? view.commits : [], historyHead: valid ? view.head : undefined, tips: valid ? view.tips : [],
      nextOffset: valid ? view.nextOffset : 0, hasMore: valid && view.hasMore, displayedHistory: valid ? { refs: view.refs, search: view.search } : undefined,
      displayedHistoryKey: valid ? view.key : undefined,
      historyLoading: false, historyError: undefined, error: undefined, notice: undefined, locatingOid: undefined,
      selectedOid: view.selectedOid, selectedParent: view.selectedParent, selectedStashOid: view.selectedStashOid, selectedFile: view.selectedFile,
      selectedOids: view.selectedOid ? [view.selectedOid] : [], selectionAnchor: view.selectedOid, tab: view.tab,
      comparison: undefined, details: undefined, stashDetails: undefined, selectedStashSection: undefined, detailsLoading: false, diffTarget: undefined,
      historyScrollTop: valid ? view.scrollTop : 0, historyRestoreTop: valid ? view.scrollTop : 0, historyRestoreToken: state.historyRestoreToken + 1 });
    if (!valid) void get().loadHistory();
    if (view.tab === 'changes') get().selectWorking();
    else if (view.selectedOid) void get().selectCommit(view.selectedOid, view.selectedParent, view.selectedStashOid);
  },
  resetHistory() {
    const state = get(), snapshot = state.snapshot; if (!snapshot?.head) return;
    const ref = snapshot.refs.find(ref => ref.kind === 'local' && ref.name === snapshot.branch)?.fullName ?? 'HEAD';
    if (state.checkedRefs?.length === 1 && state.checkedRefs[0] === ref && !state.search && !state.historyError && !state.historyLoading) { get().locateHead(); return; }
    rememberHistory(); cancelSearchTimer();
    set({ checkedRefs: [ref], search: '', ref: undefined, selectedOids: [], comparison: undefined });
    void get().locateCommit(snapshot.head);
  },
  locateRef(ref, oid) {
    const state = get();
    if (state.commits.some(commit => commit.oid === oid) && !state.search && !state.historyLoading && !state.historyError) {
      if (state.selectedOid !== oid) rememberHistory();
      set({ locateToken: state.locateToken + 1, locatingOid: undefined });
      void get().selectCommit(oid);
      return;
    }
    // A reference's own history starts at its tip; do not page through unrelated branches.
    rememberHistory(); cancelSearchTimer();
    set({ checkedRefs: [ref], search: '', ref: undefined, selectedOids: [], comparison: undefined });
    void get().locateCommit(oid);
  },
  workingFilters: {},
  setWorkingFilter(value) { const repoId = get().repoId; if (repoId) set({ workingFilters: { ...get().workingFilters, [repoId]: value } }); },
  diffNavigationScope: session.diffNavigationScope === 'file' ? 'file' : 'commit',
  changeListMode: session.changeListMode === 'unified' ? 'unified' : 'split',
  singleKeyShortcuts: session.singleKeyShortcuts !== false, shortcutOverrides: normalizeShortcutOverrides(session.shortcutOverrides),
  operationSettings: { allowDetachedHead: false, pushFollowTags: false, pushTagAfterCreate: false, defaultResetMode: 'mixed', scope: 'workspace' },
  async loadOperationSettings() { const settings = await rpc<OperationSettings>('operationSettings'); if (typeof settings?.allowDetachedHead === 'boolean'&&typeof settings?.pushFollowTags==='boolean'&&typeof settings?.pushTagAfterCreate==='boolean'&&['soft','mixed','hard'].includes(settings?.defaultResetMode)) set({ operationSettings: settings }); },
  async saveOperationSettings(update, scope) { const settings = await rpc<OperationSettings>('saveOperationSettings', undefined, { ...update, ...(scope ? { scope } : {}) }); if (typeof settings?.allowDetachedHead !== 'boolean' || typeof settings?.pushFollowTags !== 'boolean' || typeof settings?.pushTagAfterCreate !== 'boolean' || !['soft','mixed','hard'].includes(settings?.defaultResetMode) || settings.allowDetachedHead !== update.allowDetachedHead || settings.pushFollowTags !== update.pushFollowTags || settings.pushTagAfterCreate !== update.pushTagAfterCreate || settings.defaultResetMode !== update.defaultResetMode || scope && settings.scope !== scope) throw new Error(uiText("notices.couldNotSaveGitOperationSettings")); if (scope) await get().loadOperationSettings(); else set({ operationSettings: settings }); },
  catalogState: 'loading', catalogError: undefined,
  repositories: [], repositoryCollections:[], repositoryStatuses: {}, selectedRepositoryKeys:[], selectedWorktreePaths:[], commits: [], selectedOids:[], selectedRefs:[], search: '', language: session.language === 'zh-CN' ? 'zh-CN' : 'en', layout: initialLayout, appearance: normalizeAppearance(session.appearance), locateToken:0,nextOffset: 0, tips: [], hasMore: false, loading: false, historyLoading: false, detailsLoading: false, diffRevision: 0, busy: false, activity: '', tab: 'history', drafts: session.drafts ?? {}, collapsedSidebarGroups:[],
  report(error) { set({ error: message(error) }); },
  async initialize() {
    const preferenceRequest = preferencesEpoch;
    void rpc<InterfacePreferences>('interfaceSettings').then(settings => {
      if (settings && preferenceRequest === preferencesEpoch && interfaceSettingsSchema.safeParse(settings).success) synchronizeInterfaceSettings(settings);
    }).catch(error => get().report(error));
    const request = ++catalogEpoch;
    const showLoading = !get().repositories.length && !get().snapshot;
    const loadingCatalog = get().catalogState !== 'ready';
    if (loadingCatalog) set({ catalogState: 'loading', catalogError: undefined });
    void get().loadOperationSettings().catch(error => { if (request === catalogEpoch) get().report(error); });
    if (showLoading) set({ loading: true });
    try {
      const [repositories, collectionsResult, orderResult] = await Promise.all([
        rpc<Repository[]>('repositories'), rpc<RepositoryCollection[]>('repositoryCollections'), rpc<RepositoryOrder>('repositoryOrder'),
      ]);
      if (request !== catalogEpoch) return;
      const repositoryCollections = Array.isArray(collectionsResult) ? collectionsResult : [];
      const currentId = get().repoId, keys = new Set(groupRepositories(repositories, currentId).map(group => group.key));
      const selectedRepositoryKeys = get().selectedRepositoryKeys.filter(key => keys.has(key));
      const repositorySelectionAnchor = selectedRepositoryKeys.includes(get().repositorySelectionAnchor ?? '') ? get().repositorySelectionAnchor : undefined;
      const removed = !!currentId && !repositories.some(repo => repo.id === currentId);
      if (removed) { cancelSearchTimer(); ++repositoryEpoch; ++historyEpoch; ++detailEpoch; }
      set({
        repositories, repositoryCollections, repositoryOrder: orderResult?.root ? orderResult : undefined, catalogState: 'ready', catalogError: undefined,
        selectedRepositoryKeys, repositorySelectionAnchor,
        ...(removed ? {
          repoId: undefined, snapshot: undefined, commits: [], historyHead: undefined, details: undefined,
          comparison: undefined, stashDetails: undefined, selectedStashOid: undefined, selectedStashSection: undefined,
          selectedOid: undefined, selectedOids: [], selectedFile: undefined, diffTarget: undefined,
          operationReview: undefined, loading: false, busy: false, activity: '',
          notice: translate(get().language, "notices.theRepositoryWasRemovedFromAlwayGit"),
        } : {}),
      });
      void get().loadRepositoryStatuses();
      if (!currentId) {
        const initial = repositories.find(repo => repo.id === session.repoId);
        if (initial) await get().selectRepository(initial.id);
      }
    } catch (error) { if (request === catalogEpoch) { if (loadingCatalog) set({ catalogState: 'error', catalogError: message(error) }); else get().report(error); } }
    finally { if (showLoading && request === catalogEpoch) set({ loading: false }); }
  },
  async reorderRepository(payload) {
    try { const order=await rpc<RepositoryOrder>('reorderRepository',undefined,payload); set({repositoryOrder:order}); } catch(error) { get().report(error); }
  },
  async loadRepositoryStatuses() {
    const request = ++repositoryStatusEpoch;
    try {
      const statuses = await rpc<RepositoryStatus[]>('repositoryStatuses');
      if (request !== repositoryStatusEpoch || !Array.isArray(statuses)) return;
      const known = new Set(get().repositories.map(repository => repository.id));
      const repositoryStatuses = Object.fromEntries(statuses.filter(status => known.has(status.repositoryId)).map(status => [status.repositoryId, status]));
      const snapshot = get().snapshot;
      if (snapshot && known.has(snapshot.repository.id)) repositoryStatuses[snapshot.repository.id] = { repositoryId: snapshot.repository.id, branch: snapshot.branch, ...(snapshot.upstream ? { upstream: snapshot.upstream } : {}), ahead: snapshot.ahead, unpushed: snapshot.unpushed ?? snapshot.ahead };
      set(state => ({ repositoryStatuses: shareValue(state.repositoryStatuses, repositoryStatuses) }));
    } catch { /* Repository badges are supplementary; the selected repository still refreshes normally. */ }
  },
  async selectRepository(id) {
    tagController?.abort(); ++tagQuerySequence;
    set(state => ({ tagQueries: Object.fromEntries(Object.entries(state.tagQueries).map(([key, value]) => [key, value.loading ? { ...value, loading: false, attemptedAt: 0 } : value])) }));
    cancelSearchTimer();
    historyController?.abort();
    set({ historyBackDepth: historyViews.get(id)?.length ?? 0, historyScrollTop: 0 });
    set({ displayedHistory: undefined, displayedHistoryKey: undefined, historyError: undefined });
    ++repositoryEpoch; ++historyEpoch; ++detailEpoch; const view = views[id];
    set({ operationReview: undefined });
    set({ repoId: id, tagRemote: view?.tagRemote, locatingOid: undefined, snapshot: undefined, commits: [], historyHead: undefined, selectedOids:[], selectionAnchor:undefined, selectedRefs:[],refSelectionAnchor:undefined, selectedWorktreePaths:[],worktreeSelectionAnchor:undefined, tips: [], details: undefined, comparison:undefined, stashDetails: undefined, selectedStashSection:undefined, diffTarget: undefined, diffRevision:0, selectedFile: view?.selectedFile, selectedOid: view?.selectedOid, selectedParent: view?.selectedParent, selectedStashOid: view?.selectedStashOid, ref: view?.ref, checkedRefs: view?.checkedRefs ? [...view.checkedRefs] : view?.ref ? [view.ref] : undefined, expandedRefGroups:view?.expandedRefGroups?[...view.expandedRefGroups]:undefined,collapsedSidebarGroups:[...(view?.collapsedSidebarGroups??[])], search: view?.search ?? '', tab: view?.tab ?? 'history', remoteRequest: undefined, checkoutFailure: undefined, stashApplyFailure: undefined, error: undefined, notice: undefined, actionFeedback: actionFeedbacks.get(id), loading: true, busy: executingRepositories.has(id) || hostBusyRepositories.has(id), activity: '', detailsLoading: false, historyLoading: false });
    await get().refresh();
  },
  async refresh(options = {}) {
    const epoch = repositoryEpoch, request = ++snapshotEpoch, repoId = get().repoId; if (!repoId) return;
    if (!options.background || !get().snapshot) set({ loading: true });
    refreshInvalidation = {
      epoch,
      changes: refreshInvalidation?.epoch === epoch ? mergeChanges(refreshInvalidation.changes, options.changes) : options.changes,
      forceHistory: !options.background || (refreshInvalidation?.epoch === epoch && refreshInvalidation.forceHistory),
    };
    try {
      const incoming = options.snapshot ?? await rpc<Snapshot>('snapshot', repoId); if (epoch !== repositoryEpoch || request !== snapshotEpoch || incoming.repository.id !== repoId || incoming.version < (get().snapshot?.version ?? -1)) return;
      const snapshot = shareSnapshot(get().snapshot, incoming);
      const invalidation = refreshInvalidation!; refreshInvalidation = undefined;
      const previous = get().snapshot, previousRefs = get().checkedRefs ?? [], previousTarget = get().diffTarget;
      const initial = get().checkedRefs === undefined,previousBranch=previous?.branch;
      const checkedRefs = initial ? [snapshot.refs.find(r => r.kind === 'local' && r.name === snapshot.branch)?.fullName ?? (snapshot.head ? 'HEAD' : ''), snapshot.refs.find(r => r.kind === 'remote' && r.name === snapshot.upstream)?.fullName ?? ''].filter(Boolean) : get().checkedRefs!.filter(ref => ref === 'HEAD' || snapshot.refs.some(r => r.fullName === ref));
      const currentFolders=folderKeys(snapshot.branch,'local'),baseExpanded=get().expandedRefGroups,expandedRefGroups=baseExpanded===undefined||previousBranch!==snapshot.branch?[...new Set([...(baseExpanded??[]),...currentFolders])]:baseExpanded;
      const stashDisappeared = !!get().selectedStashOid && !snapshot.stashes.some(stash => stash.oid === get().selectedStashOid);
      const reloadHistory = !previous || invalidation.forceHistory || stashDisappeared || historyKey(previous, previousRefs) !== historyKey(snapshot, checkedRefs);
      const selectedRefs=get().selectedRefs.filter(ref=>snapshot.refs.some(item=>item.fullName===ref)),refSelectionAnchor=get().refSelectionAnchor&&selectedRefs.includes(get().refSelectionAnchor!)?get().refSelectionAnchor:undefined;
      set(state => ({ snapshot, checkedRefs: shareValue(state.checkedRefs, checkedRefs), expandedRefGroups, selectedRefs: shareValue(state.selectedRefs, selectedRefs), refSelectionAnchor, repositoryStatuses: shareValue(state.repositoryStatuses, { ...state.repositoryStatuses, [snapshot.repository.id]: { repositoryId: snapshot.repository.id, branch: snapshot.branch, ...(snapshot.upstream ? { upstream: snapshot.upstream } : {}), ahead: snapshot.ahead, unpushed: snapshot.unpushed ?? snapshot.ahead } }) }));
      if (!get().collapsedSidebarGroups.includes('tag')) void get().loadTagStatuses();
      if (get().tab === 'changes') {
        const target = workingTarget(snapshot, get().diffTarget, get().selectedFile);
        if (target) get().selectFile(target, false); else if (get().diffTarget || get().selectedFile) set({ selectedFile: undefined, diffTarget: undefined });
        if (target && diffKey(target) === diffKey(previousTarget) && affectsWorkingDiff(previous, snapshot, target, invalidation.changes)) set({ diffRevision: get().diffRevision + 1 });
      }
      if (reloadHistory) await get().loadHistory();
    } catch (error) { if (epoch === repositoryEpoch && request === snapshotEpoch) get().report(error); }
    finally { if (epoch === repositoryEpoch && request === snapshotEpoch) { refreshInvalidation = undefined; set({ loading: false }); } }
  },
  async loadHistory(append = false) {
    const { repoId, search, nextOffset, historyLoading, checkedRefs } = get(); if (!repoId || append && historyLoading) return;
    const displayed = get().displayedHistory;
    if (append && (get().historyError || !displayed || displayed.search !== search || displayed.refs.join('\0') !== (checkedRefs ?? []).join('\0'))) return;
    cancelSearchTimer();
    const epoch = ++historyEpoch, repoEpoch = repositoryEpoch; set({ historyLoading: true, historyError: undefined });
    const sourceKey = get().snapshot ? historyKey(get().snapshot!, checkedRefs ?? []) : undefined;
    historyController?.abort(); const controller = historyController = new AbortController();
    try {
      const query: HistoryQuery = { offset: append ? nextOffset : 0, tips: append ? get().tips : checkedRefs ?? [], ...(search ? { search } : {}), ...(get().snapshot?.head ? { head: get().snapshot!.head } : {}) };
      const page = await rpc<HistoryPage>('history', repoId, query, { signal: controller.signal });
      if (epoch !== historyEpoch || repoEpoch !== repositoryEpoch) return;
      const prior = new Set(get().commits.map(c => c.oid)), all = append ? [...get().commits, ...page.commits.filter(c => !prior.has(c.oid))] : page.commits;
      set({ commits: all, historyHead: page.head, tips: page.tips, nextOffset: page.nextOffset, hasMore: page.hasMore, displayedHistory: { refs: [...(checkedRefs ?? [])], search }, displayedHistoryKey: sourceKey });
      const stashSelected = !!get().selectedStashOid && get().snapshot?.stashes.some(s => s.oid === get().selectedStashOid);
      if(get().selectedStashOid&&!stashSelected){++detailEpoch;set({selectedStashOid:undefined,selectedStashSection:undefined,stashDetails:undefined,selectedOid:all[0]?.oid,selectedParent:undefined,details:undefined,detailsLoading:false,diffTarget:undefined});}
      if (!append && get().tab === 'history' && !get().selectedOid && all.length) void get().selectCommit(all[0].oid);
      else if (!append && get().tab === 'history' && get().selectedOid && !get().details && !get().comparison && !get().detailsLoading) void get().selectCommit(get().selectedOid!, get().selectedParent, stashSelected ? get().selectedStashOid : undefined, get().selectedOids.length>1);
    } catch (error) { if (epoch === historyEpoch && repoEpoch === repositoryEpoch) { set({ historyError: message(error) }); get().report(error); } }
    finally { if (epoch === historyEpoch && repoEpoch === repositoryEpoch) set({ historyLoading: false }); }
  },
  async selectCommit(oid, parent, stashOid, preserveSelection=false) {
    if(get().locatingOid&&get().locatingOid!==oid)set({locatingOid:undefined});
    const repoEpoch = repositoryEpoch, repoId = get().repoId, same = oid === get().selectedOid;
    parent ??= same ? get().selectedParent : undefined;
    const selectedStashOid = stashOid ?? (same ? get().selectedStashOid : undefined);
    if(selectedStashOid){
      const epoch=++detailEpoch;
      set({selectedOid:oid,selectedParent:parent,...(!preserveSelection?{selectedOids:[oid],selectionAnchor:oid}:{}),selectedStashOid,comparison:undefined,details:undefined,detailsLoading:true,tab:'history',diffTarget:undefined});
      try{
        const stashDetails=get().stashDetails?.commit.oid===selectedStashOid?get().stashDetails!:await rpc<StashDetails>('stashDetails',repoId,{oid:selectedStashOid});
        if(epoch!==detailEpoch||repoEpoch!==repositoryEpoch)return;
        const entries=(Object.entries(stashDetails.sections) as [StashSection,CommitDetails][]).filter((entry):entry is [StashSection,CommitDetails]=>!!entry[1]);
        const requested=oid===selectedStashOid&&parent===undefined?undefined:entries.find(([,value])=>value.commit.oid===oid&&(!parent||value.parent===parent));
        const chosen=requested??entries.find(([,value])=>value.files.length>0)??entries[0];
        if(!chosen)throw new Error(uiText("notices.theSelectedStashHasNoReadableSections"));
        const [selectedStashSection,details]=chosen;
        set({details,stashDetails,selectedStashSection,selectedOid:details.commit.oid,selectedParent:details.parent});
        const file=(same?details.files.find(candidate=>candidate.path===get().selectedFile):undefined)??details.files[0];
        if(file)get().selectFile({kind:'commit',oid:details.commit.oid,path:file.path,previousPath:file.previousPath,parent:details.parent}, false);else set({selectedFile:undefined,diffTarget:undefined});
      }catch(error){if(epoch===detailEpoch&&repoEpoch===repositoryEpoch)get().report(error);}
      finally{if(epoch===detailEpoch&&repoEpoch===repositoryEpoch)set({detailsLoading:false});}
      return;
    }
    if (same && get().tab === 'history' && get().details?.commit.oid === oid && get().details?.parent === parent && selectedStashOid === get().selectedStashOid) {
      if (!preserveSelection) set({ selectedOids: [oid], selectionAnchor: oid });
      return;
    }
    const epoch = ++detailEpoch;
    set({ selectedOid: oid, selectedParent: parent, ...(!preserveSelection?{selectedOids:[oid],selectionAnchor:oid}:{}), selectedStashOid:undefined,selectedStashSection:undefined,stashDetails:undefined, comparison:undefined, details: undefined, detailsLoading: true, tab: 'history', diffTarget: undefined });
    try {
      const details=await rpc<CommitDetails>('details', repoId, { oid, parent });
      if (epoch !== detailEpoch || repoEpoch !== repositoryEpoch) return;
      set({ details, selectedParent: details.parent });
      const file = (same ? details.files.find(f => f.path === get().selectedFile) : undefined) ?? details.files[0];
      if (file) get().selectFile({ kind: 'commit', oid, path: file.path, previousPath: file.previousPath, parent: details.parent }, false); else set({ selectedFile: undefined, diffTarget: undefined });
    } catch (error) { if (epoch === detailEpoch && repoEpoch === repositoryEpoch) get().report(error); }
    finally { if (epoch === detailEpoch && repoEpoch === repositoryEpoch) set({ detailsLoading: false }); }
  },
  selectStashSection(section){
    const stashDetails=get().stashDetails,details=stashDetails?.sections[section];if(!stashDetails||!details)return;
    ++detailEpoch;set({selectedStashSection:section,selectedOid:details.commit.oid,selectedParent:details.parent,details,detailsLoading:false,comparison:undefined,diffTarget:undefined,selectedFile:undefined});
    const file=details.files[0];if(file)get().selectFile({kind:'commit',oid:details.commit.oid,path:file.path,previousPath:file.previousPath,parent:details.parent});
  },
  async compareCommits(left,right,preserveOrder=false){
    const epoch=++detailEpoch,repoEpoch=repositoryEpoch,repoId=get().repoId;if(!repoId)return;set({comparison:undefined,details:undefined,selectedStashOid:undefined,selectedStashSection:undefined,stashDetails:undefined,detailsLoading:true,tab:'history',diffTarget:undefined,error:undefined});
    try{const comparison=await rpc<CommitComparison>('compare',repoId,{left,right,preserveOrder});if(epoch!==detailEpoch||repoEpoch!==repositoryEpoch)return;set({comparison});const file=comparison.files[0];if(file)get().selectFile({kind:'comparison',left:comparison.left.oid,right:comparison.right.oid,path:file.path,previousPath:file.previousPath});else set({selectedFile:undefined,diffTarget:undefined});}
    catch(error){if(epoch===detailEpoch&&repoEpoch===repositoryEpoch)get().report(error);}
    finally{if(epoch===detailEpoch&&repoEpoch===repositoryEpoch)set({detailsLoading:false});}
  },
  setCommitSelection(oids,selectionAnchor,primary){
    const selectedOids=[...new Set(oids)],anchor=selectionAnchor&&selectedOids.includes(selectionAnchor)?selectionAnchor:undefined;
    set({selectedOids,selectionAnchor:anchor,locatingOid:undefined});
    if(selectedOids.length===2){void get().compareCommits(selectedOids[0],selectedOids[1]);return;}
    if(selectedOids.length){const oid=primary&&selectedOids.includes(primary)?primary:anchor??selectedOids.at(-1)!;void get().selectCommit(oid,undefined,undefined,true);return;}
    ++detailEpoch;set({selectedOid:undefined,selectedParent:undefined,selectedStashOid:undefined,selectedStashSection:undefined,details:undefined,comparison:undefined,stashDetails:undefined,detailsLoading:false,selectedFile:undefined,diffTarget:undefined});
  },
  setRefSelection(refs,anchor){const selectedRefs=[...new Set(refs)],refSelectionAnchor=anchor&&selectedRefs.includes(anchor)?anchor:undefined;set(selectedRefs.length?{selectedRefs,refSelectionAnchor,selectedRepositoryKeys:[],repositorySelectionAnchor:undefined,selectedWorktreePaths:[],worktreeSelectionAnchor:undefined}:{selectedRefs,refSelectionAnchor});},
  setRepositorySelection(keys,anchor){const selectedRepositoryKeys=[...new Set(keys)],repositorySelectionAnchor=anchor&&selectedRepositoryKeys.includes(anchor)?anchor:undefined;set(selectedRepositoryKeys.length?{selectedRepositoryKeys,repositorySelectionAnchor,selectedRefs:[],refSelectionAnchor:undefined,selectedWorktreePaths:[],worktreeSelectionAnchor:undefined}:{selectedRepositoryKeys,repositorySelectionAnchor});},
  setWorktreeSelection(paths,anchor){const selectedWorktreePaths=[...new Set(paths)],worktreeSelectionAnchor=anchor&&selectedWorktreePaths.includes(anchor)?anchor:undefined;set(selectedWorktreePaths.length?{selectedWorktreePaths,worktreeSelectionAnchor,selectedRepositoryKeys:[],repositorySelectionAnchor:undefined,selectedRefs:[],refSelectionAnchor:undefined}:{selectedWorktreePaths,worktreeSelectionAnchor});},
  setFilter(ref, search = get().search) { set({ ref, locatingOid: undefined, checkedRefs: ref ? [ref] : get().snapshot?.refs.filter(r => r.kind !== 'tag').map(r => r.fullName) ?? [], search, tips: [], selectedOids:[], selectionAnchor:undefined, comparison:undefined, selectedStashOid: undefined,selectedStashSection:undefined,stashDetails:undefined }); void get().loadHistory(); },
  setCheckedRefs(refs) {
    const next = [...new Set(refs)], prior = get().checkedRefs ?? [];
    if (next.length === prior.length && next.every(ref => prior.includes(ref))) return;
    rememberHistory();
    set({ locatingOid: undefined, checkedRefs: next, ref: undefined, tips: [], selectedOids:[], selectionAnchor:undefined, comparison:undefined });
    void get().loadHistory();
  },
  setExpandedRefGroup(key,expanded){set({expandedRefGroups:expanded?[...new Set([...(get().expandedRefGroups??[]),key])]:(get().expandedRefGroups??[]).filter(item=>item!==key)});},
  toggleSidebarGroup(key){set({collapsedSidebarGroups:get().collapsedSidebarGroups.includes(key)?get().collapsedSidebarGroups.filter(item=>item!==key):[...get().collapsedSidebarGroups,key]});},
  setSearch(search) {
    if (search === get().search) return;
    rememberHistory(); historyController?.abort();
    cancelSearchTimer(); ++historyEpoch;
    set({ displayedHistory: undefined, historyError: undefined });
    set({ search, commits: [], historyHead: undefined, tips: [], nextOffset: 0, hasMore: false, locatingOid: undefined, selectedOids:[], selectionAnchor:undefined, comparison:undefined, historyLoading: !!get().repoId });
    if (get().repoId) searchTimer = setTimeout(() => { searchTimer = undefined; void get().loadHistory(); }, 200);
  },
  selectWorking() {
    ++detailEpoch; const snapshot = get().snapshot, target = snapshot && workingTarget(snapshot, get().diffTarget, get().selectedFile); set({ tab: 'changes', locatingOid:undefined, selectedOids:[], selectionAnchor:undefined, comparison:undefined, detailsLoading: false });
    if (target) get().selectFile(target); else set({ selectedFile: undefined, diffTarget: undefined });
  },
  selectFile(target, activate = true) { if (activate) useDock.getState().select('diff'); if (diffKey(target) !== diffKey(get().diffTarget)) set({ selectedFile: target.path, diffTarget: target }); },
  locateHead() {
    const state=get(),snapshot=state.snapshot;if(!snapshot?.head)return;
    if(state.commits.some(commit=>commit.oid===snapshot.head)) {
      set({locatingOid:undefined,locateToken:state.locateToken+1,selectedStashOid:undefined,selectedStashSection:undefined,stashDetails:undefined,notice:undefined});
      void get().selectCommit(snapshot.head);
      return;
    }
    const ref=snapshot.refs.find(r=>r.kind==='local'&&r.name===snapshot.branch)?.fullName??'HEAD';
    const refsChanged=!state.checkedRefs?.includes(ref);
    if(refsChanged){rememberHistory();set({checkedRefs:[...(state.checkedRefs??[]),ref],ref:undefined});}
    const append=!refsChanged&&!state.search&&!state.historyLoading&&state.commits.length>0&&state.hasMore;
    void get().locateCommit(snapshot.head,append);
  },
  async locateCommit(oid, append = false) {
    if(!get().repoId)return;
    if (!append) { rememberHistory(); set({ displayedHistory: undefined, historyError: undefined }); }
    const repoEpoch=repositoryEpoch,token=get().locateToken+1;
    set({search:'',...(!append?{commits:[],historyHead:undefined,tips:[],nextOffset:0,hasMore:false}:{}),locateToken:token,locatingOid:oid,selectedStashOid:undefined,selectedStashSection:undefined,stashDetails:undefined,notice:undefined});
    void get().selectCommit(oid);
    const current=()=>repositoryEpoch===repoEpoch&&get().locateToken===token&&get().locatingOid===oid&&get().selectedOid===oid&&!get().search&&get().tab==='history';
    try {
      let pages=0;
      while(current()) {
        const offset=get().nextOffset,expectedEpoch=historyEpoch+1;
        await get().loadHistory(append);
        if(!current()||historyEpoch!==expectedEpoch)return;
        if (get().historyError) return;
        if(get().commits.some(commit=>commit.oid===oid))return;
        if(!get().hasMore||get().nextOffset<=offset) {
          set({notice:translate(get().language, "notices.couldNotLocateThisCommitInTheFullHistory")});
          return;
        }
        if (++pages >= 20 || get().commits.length >= 10_000) {
          set({notice:translate(get().language, "notices.automaticLocateReachedItsReadLimitHistoryAndCommit")});
          return;
        }
        append=true;
      }
    } finally {
      if(repositoryEpoch===repoEpoch&&get().locateToken===token)set({locatingOid:undefined});
    }
  },
  async execute(action, context) {
    if (context && !isActionContextCurrent(context)) return false;
    const repoId = get().repoId, epoch = repositoryEpoch; if (!repoId || get().busy) return false;
    if ((action.type === 'operation.continue' || action.type === 'commit' && get().snapshot?.operation.kind) && !action.reviewToken) {
      executingRepositories.add(repoId); set({ busy: true, activity: uiText("notices.inspectStagedResult"), error: undefined, operationReview: undefined });
      try {
        const review = await rpc<OperationReview>('operationReview', repoId);
        if (epoch === repositoryEpoch) {
          if (action.type === 'operation.continue' && review.kind !== action.kind) throw new Error(uiText("notices.theGitOperationChangedRefreshBeforeContinuing"));
          set({ operationReview: { repoId, action, review } });
        }
      } catch (error) { if (epoch === repositoryEpoch) { get().report(error); await get().refresh({ background: true }); } }
      finally {
        // Results require the original view epoch; releasing this repository's lock does not.
        executingRepositories.delete(repoId);
        if (get().repoId === repoId) set({ busy: hostBusyRepositories.has(repoId), activity: hostBusyRepositories.has(repoId) ? get().activity : '' });
      }
      return false;
    }
    set({ operationReview: undefined });
    const submittedDraft = action.type === 'commit' ? get().drafts[repoId] : undefined;
    const before=get().snapshot,committedFiles = action.type === 'commit' && !action.amend ? action.files ? new Set(action.files.map(file => file.path)).size : before?.changes.filter(change => !change.conflict && change.indexStatus !== ' ' && change.indexStatus !== '?' && !!change.indexStatus).length : undefined;
    const stashChanges=action.type==='stash.create'?before?.changes.filter(change=>(!action.paths||action.paths.includes(change.path))&&(!change.untracked||!!action.paths||!!action.includeUntracked))??[]:[];
    const stashed=action.type==='stash.create'?{files:new Set(stashChanges.map(change=>change.path)).size,untracked:new Set(stashChanges.filter(change=>change.untracked).map(change=>change.path)).size,previousOid:before?.stashes[0]?.oid}:undefined;
    const feedback: ActionFeedback = { id: ++actionSequence, repoId, action, status: 'running', startedAt: Date.now(), phase: 'executing', target: actionTarget(action, get().snapshot) };
    const finish = (status: 'success' | 'error', error?: string, result?: ActionFeedback['result']) => {
      if (actionFeedbacks.get(repoId)?.id !== feedback.id) return;
      const completed = { ...feedback, status, error, result, refreshWarning: status === 'success' && get().repoId === repoId ? get().error : undefined };
      actionFeedbacks.set(repoId, completed);
      if (get().repoId === repoId) set({ actionFeedback: completed });
    };
    actionFeedbacks.set(repoId, feedback);
    executingRepositories.add(repoId); set({ busy: true, activity: action.type, actionFeedback: feedback, error: undefined, notice: undefined, checkoutFailure: undefined, stashApplyFailure: undefined });
    try {
      const response = await rpc<ActionResponse | Snapshot | undefined>('action', repoId, action);
      // Accept legacy snapshots from demo fixtures and an older host during reload.
      const envelope = response && !('repository' in response) ? response : undefined;
      const result = response && 'repository' in response ? response : envelope?.snapshot;
      const published = envelope?.result;
      const commitResult: ActionFeedback['result'] = action.type === 'commit' && result?.repository.id === repoId && result.head ? { kind: 'commit', oid: result.head, files: committedFiles, remaining: result.changes.length, amended: !!action.amend } : undefined;
      if (action.type === 'commit' && submittedDraft !== undefined && submittedDraft.trim() === action.message && get().drafts[repoId] === submittedDraft) {
        set({ drafts: { ...get().drafts, [repoId]: '' } });
      }
      // Freeze this action's result before history loading or another refresh changes the store.
      if (published) feedback.target = published.destinations.flatMap(destination => destination.refs.filter(ref => ref.kind === 'branch').map(ref => `${published.localBranch ?? ref.name} → ${published.remote ?? destination.label}/${ref.name}`)).join(', ') || feedback.target;
      if (epoch === repositoryEpoch) {
        feedback.phase = 'refreshing';
        if (get().actionFeedback?.id === feedback.id) set({ actionFeedback: { ...get().actionFeedback!, phase: 'refreshing' } });
        await get().refresh({ background: true, snapshot: result });
        if(epoch===repositoryEpoch) {
          const checkout = ['branch.checkout', 'commit.checkout', 'checkout.stash'].includes(action.type) || (action.type === 'branch.create' || action.type === 'branch.track') && action.checkout;
          if (checkout) { const snap = get().snapshot; const ref = snap?.refs.find(r => r.kind === 'local' && r.name === snap.branch)?.fullName ?? (snap?.head ? 'HEAD' : undefined); if (ref && !get().checkedRefs?.includes(ref)) { set({checkedRefs:[...(get().checkedRefs??[]),ref]});await get().loadHistory(); } }
          set({ notice: demoMode ? (translate(get().language, "notices.demoCompletedNoDiskChanges", { kind: (action.type) })) : action.type === 'resolve-and-stage' ? (translate(get().language, "notices.markedAndStagedInspectTheResultBeforeContinuing")) : `${action.type} ✓` });
        }
      }
      const snapshot = result?.repository.id === repoId ? result : epoch === repositoryEpoch ? get().snapshot : undefined;
      if (action.type === 'stash.create') feedback.stashOid = snapshot?.stashes[0]?.oid;
      const checkout = ['branch.checkout', 'commit.checkout', 'checkout.stash'].includes(action.type) || (action.type === 'branch.track' && action.checkout);
      const remoteNames = new Set([...(before?.refs ?? []), ...(snapshot?.refs ?? [])].filter(ref => ref.kind === 'remote').map(ref => ref.fullName));
      const fetched = action.type === 'fetch' && snapshot ? [...remoteNames].filter(name => before?.refs.find(ref => ref.fullName === name)?.oid !== snapshot.refs.find(ref => ref.fullName === name)?.oid) : [];
      let finalResult: ActionFeedback['result'] = published ?? commitResult;
      if (!finalResult) {
        if (stashed && snapshot && snapshot.stashes[0]?.oid !== stashed.previousOid) finalResult = {kind:'stash',files:stashed.files,untracked:stashed.untracked,clean:snapshot.changes.length===0};
        else if (action.type === 'branch.create' && snapshot) finalResult = {kind:'branch',name:action.name,checkedOut:!!action.checkout,currentBranch:snapshot.branch||uiText('notices.detachedHEAD')};
        else if (checkout && snapshot) finalResult = {kind:'checkout',branch:snapshot.branch||uiText('notices.detachedHEAD'),head:snapshot.head};
        else if (action.type === 'fetch' && snapshot) finalResult = {kind:'fetch',refs:fetched};
        else if (action.type === 'worktree.add') finalResult = {kind:'worktree',path:action.path};
        else if (action.type === 'tag.create') finalResult = {kind:'tag',name:action.name};
        else if (snapshot && ['pull','merge','rebase','reset','cherry-pick','revert','operation.continue','operation.abort','operation.skip'].includes(action.type)) finalResult = {kind:'update',head:snapshot.head,previousHead:before?.head};
      }
      const failed = published && published.outcome !== 'success';
      if (epoch === repositoryEpoch && ['fetch', 'pull', 'push', 'tag.push', 'tag.create', 'tag.delete'].includes(action.type)) {
        const remote = action.type === 'tag.create' ? action.pushRemote : 'remote' in action ? action.remote : undefined;
        void get().loadTagStatuses(true, remote).then(() => { if (epoch === repositoryEpoch && remote && remote !== selectedTagRemote(get().snapshot, get().tagRemote)) void get().loadTagStatuses(true); });
      }
      finish(failed ? 'error' : 'success', failed ? published.error : undefined, finalResult);
      if (failed && get().repoId === repoId) set({ error: published.error });
      return !failed;
    } catch (error) {
      if (get().repoId === repoId) {
        const structured = error as { code?: string; details?: CheckoutBlocker | StashApplyBlocker };
        // Failed Merge / Cherry-pick can leave a new operation and conflicts on disk.
        await get().refresh({ background: true });
        if (epoch === repositoryEpoch && ['fetch', 'pull', 'push', 'tag.push', 'tag.create', 'tag.delete'].includes(action.type)) void get().loadTagStatuses(true);
        if (get().repoId !== repoId) { finish('error', message(error), (error as {pushResult?: ActionFeedback['result']})?.pushResult); return false; }
        const details=structured.details;
        set({ error: message(error), stashApplyFailure: details&&'kind' in details&&details.kind==='stash-apply'?details:undefined, checkoutFailure: details&&'target' in details ? { ...details, detached: action.type === 'commit.checkout' || action.type === 'checkout.stash' && action.detached } : undefined });
      }
      finish('error', message(error), (error as {pushResult?: ActionFeedback['result']})?.pushResult);
      return false;
    } finally { executingRepositories.delete(repoId); if (get().repoId===repoId) set({ busy: hostBusyRepositories.has(repoId), activity: hostBusyRepositories.has(repoId)?get().activity:'' }); }
  },
  dismissFeedback() {
    const feedback = get().actionFeedback;
    if (!feedback || feedback.status === 'running') return;
    actionFeedbacks.delete(feedback.repoId);
    set({ actionFeedback: undefined, notice: undefined, ...(get().error === feedback.error ? { error: undefined, stashApplyFailure: undefined } : {}) });
  },
  setDraft(value) { const repoId = get().repoId; if (repoId) set({ drafts: { ...get().drafts, [repoId]: value } }); },
  setLanguage(language) { set({ language }); },
  setLayout(value) { set({ layout: layout({ ...get().layout, ...value }) }); },
  restoreLayout() { const { font, row } = get().layout; set({ layout: { ...defaultLayout, font, row } }); },
  beginSettings() {
    const state = get(); if (state.settingsBaseline) return;
    set({ settingsBaseline: { language: state.language, font: state.layout.font, row: state.layout.row, appearance: { ...state.appearance }, diffNavigationScope: state.diffNavigationScope, singleKeyShortcuts: state.singleKeyShortcuts, shortcutOverrides: state.shortcutOverrides, changeListMode: state.changeListMode } });
  },
  previewSettings(value) {
    if (!get().settingsBaseline) return;
    const state = get();
    set({ language: value.language ?? state.language, appearance: normalizeAppearance(value.appearance ?? state.appearance), diffNavigationScope: value.diffNavigationScope ?? state.diffNavigationScope, singleKeyShortcuts: value.singleKeyShortcuts ?? state.singleKeyShortcuts, shortcutOverrides: normalizeShortcutOverrides(value.shortcutOverrides ?? state.shortcutOverrides), changeListMode: value.changeListMode ?? state.changeListMode, layout: layout({ ...state.layout, font: value.font ?? state.layout.font, row: value.row ?? state.layout.row }) });
  },
  async finishSettings(apply) {
    const baseline = get().settingsBaseline; if (!baseline) return;
    if (!apply) { set({ ...settingsState(baseline, get()), settingsBaseline: undefined }); return; }
    const patch = preferenceChanges(interfaceSnapshot(get()), baseline);
    if (!Object.keys(patch).length) { set({ settingsBaseline: undefined }); return; }
    const saved = interfaceSettingsSchema.parse(await rpc<InterfacePreferences>('saveInterfaceSettings', undefined, patch));
    ++preferencesEpoch;
    set({ settingsBaseline: undefined });
    synchronizeInterfaceSettings(saved);
  },
}));
let persistedSelection: unknown[] = [];
useWorkbench.subscribe(state => {
  const selection = [state.tagRemote, state.repoId, state.drafts, state.ref, state.checkedRefs, state.expandedRefGroups, state.collapsedSidebarGroups, state.search, state.selectedOid, state.selectedParent, state.selectedStashOid, state.selectedFile, state.tab, state.language, state.layout, state.appearance, state.diffNavigationScope, state.singleKeyShortcuts, state.shortcutOverrides, state.changeListMode, state.settingsBaseline];
  if (selection.every((value, index) => Object.is(value, persistedSelection[index]))) return;
  persistedSelection = selection;
  if (state.repoId) views[state.repoId] = { tagRemote: state.tagRemote, ref: state.ref, checkedRefs: state.checkedRefs, expandedRefGroups:state.expandedRefGroups,collapsedSidebarGroups:state.collapsedSidebarGroups, search: state.search, selectedOid: state.selectedOid, selectedParent: state.selectedParent, selectedStashOid: state.selectedStashOid, selectedFile: state.selectedFile, tab: state.tab };
  const baseline = state.settingsBaseline;
  saveSession({ version: 2, changeListMode: baseline?.changeListMode ?? state.changeListMode, diffNavigationScope: baseline?.diffNavigationScope ?? state.diffNavigationScope, singleKeyShortcuts: baseline?.singleKeyShortcuts ?? state.singleKeyShortcuts, shortcutOverrides: baseline?.shortcutOverrides ?? state.shortcutOverrides, repoId: state.repoId, drafts: state.drafts, views, language: baseline?.language ?? state.language, layout: baseline ? { ...state.layout, font: baseline.font, row: baseline.row } : state.layout, appearance: baseline?.appearance ?? state.appearance }, error => useWorkbench.getState().report(new Error(`${translate(state.language, "notices.couldNotSaveTheRecoveryBaselineDraftsRemainIn")} ${error.message}`)));
});
let changedTimer: ReturnType<typeof setTimeout>;
let pendingChange: { repoId: string; changes?: RepositoryChanges; snapshot?: Snapshot } | undefined;
subscribe(event => {
  if (event.type === 'interfaceSettingsChanged') { ++preferencesEpoch; synchronizeInterfaceSettings(event.settings); }
  const state = useWorkbench.getState(); if (event.type === 'operationSettingsChanged') useWorkbench.setState({ operationSettings: event.settings });
  if (event.type === 'fileOperationProgress' && event.repoId === state.repoId && state.actionFeedback?.status === 'running') useWorkbench.setState({ actionFeedback: { ...state.actionFeedback, progress: event.progress } });
  if (event.type === 'repositoriesChanged') void state.initialize();
  if (event.type === 'changed' && event.repoId === state.repoId) {
    clearTimeout(changedTimer);
    pendingChange = { repoId: event.repoId, snapshot: event.snapshot, changes: pendingChange?.repoId === event.repoId ? mergeChanges(pendingChange.changes, event.changes) : event.changes };
    changedTimer = setTimeout(() => {
      const pending = pendingChange; pendingChange = undefined;
      if (pending && pending.repoId === useWorkbench.getState().repoId) void useWorkbench.getState().refresh({ background: true, changes: pending.changes, snapshot: pending.snapshot });
    }, 160);
  }
  if(event.type==='activity'){
    const externalStart=event.busy&&!hostBusyRepositories.has(event.repoId)&&!executingRepositories.has(event.repoId);
    if(externalStart)actionFeedbacks.delete(event.repoId);
    if(event.busy)hostBusyRepositories.add(event.repoId);else hostBusyRepositories.delete(event.repoId);
    if(event.repoId===state.repoId)useWorkbench.setState({busy:event.busy||executingRepositories.has(event.repoId),activity:event.label,...(externalStart?{actionFeedback:undefined}:{})});
  }
  if (event.type === 'selectRepository') void state.selectRepository(event.repoId);
});


setLanguageReader(() => useWorkbench.getState().language);
