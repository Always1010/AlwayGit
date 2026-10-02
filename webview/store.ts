import { create } from 'zustand';
import type { CheckoutBlocker, Commit, CommitComparison, CommitDetails, DiffTarget, GitAction, HistoryPage, HistoryQuery, OperationReview, Repository, RepositoryChanges, RepositoryCollection, RepositoryOrder, ReorderRepository, RepositoryStatus, Snapshot, StashApplyBlocker, StashDetails, StashSection } from '../src/protocol/types';
import { demoMode, readSession, rpc, saveSession, subscribe } from './rpc';
import type { LayoutState } from './rpc';
import type { Language } from './i18n';
import { folderKeys } from './refTree';
import { affectsWorkingDiff, diffKey, historyKey, mergeChanges, shareSnapshot, shareValue, workingTarget } from './refresh';
import { actionTarget } from './actionFeedback';
import type { ActionFeedback } from './actionFeedback';
import { normalizeAppearance, type Appearance, type InterfaceSettings, type InterfaceSettingsUpdate } from './appearance';
import { groupRepositories } from '../src/protocol/repositories';

let repositoryEpoch = 0, repositoryStatusEpoch = 0, snapshotEpoch = 0, historyEpoch = 0, detailEpoch = 0;
let refreshInvalidation: { epoch: number; changes?: RepositoryChanges; forceHistory: boolean } | undefined;
const session = readSession(), views = session.views ?? {}, executingRepositories = new Set<string>(), hostBusyRepositories = new Set<string>();
const actionFeedbacks = new Map<string, ActionFeedback>();
let actionSequence = 0;
export const defaultLayout: LayoutState = { preset: 'workbench', sidebar: 210, details: 300, diff: 220, diffCollapsed: false, graph: 64, author: 100, date: 120, font: 13, row: 24 };
export type CheckoutFailure = CheckoutBlocker & { detached?: boolean };
interface WorkbenchState {
  operationReview?: { repoId: string; action: Extract<GitAction, { type: 'commit' | 'operation.continue' }>; review: OperationReview };
  appearance: Appearance; settingsBaseline?: InterfaceSettings;
  beginSettings(): void; previewSettings(value: InterfaceSettingsUpdate): void; finishSettings(apply: boolean): void; restoreLayout(): void;
  repositories: Repository[]; repositoryCollections:RepositoryCollection[]; repositoryOrder?:RepositoryOrder; reorderRepository(payload:ReorderRepository):Promise<void>; repositoryStatuses: Record<string, RepositoryStatus>; selectedRepositoryKeys:string[]; repositorySelectionAnchor?:string; repoId?: string; snapshot?: Snapshot; commits: Commit[]; historyHead?: Commit; details?: CommitDetails; comparison?: CommitComparison; selectedOid?: string; selectedOids: string[]; selectionAnchor?: string; selectedRefs:string[]; refSelectionAnchor?:string; selectedParent?: string; selectedStashOid?: string; selectedStashSection?:StashSection; stashDetails?: StashDetails; selectedFile?: string; diffTarget?: DiffTarget; diffRevision: number;
  ref?: string; checkedRefs?: string[]; expandedRefGroups?:string[]; collapsedSidebarGroups:string[]; search: string; language: Language; layout: LayoutState; checkoutFailure?: CheckoutFailure; stashApplyFailure?: StashApplyBlocker; actionFeedback?: ActionFeedback; locateToken:number;
  nextOffset: number; hasMore: boolean; tips: string[]; loading: boolean; historyLoading: boolean; locatingOid?: string; locateCommit(oid: string): Promise<void>; detailsLoading: boolean; busy: boolean; activity: string; error?: string; notice?: string; tab: 'history' | 'changes'; drafts: Record<string, string>;
  initialize(): Promise<void>; loadRepositoryStatuses(): Promise<void>; selectRepository(id: string): Promise<void>; refresh(options?: { background?: boolean; changes?: RepositoryChanges }): Promise<void>; loadHistory(append?: boolean): Promise<void>; selectCommit(oid: string, parent?: string, stashOid?: string, preserveSelection?: boolean): Promise<void>; selectStashSection(section:StashSection):void; compareCommits(left:string,right:string,preserveOrder?:boolean):Promise<void>; setCommitSelection(oids:string[],anchor?:string,primary?:string):void; setRefSelection(refs:string[],anchor?:string):void; setRepositorySelection(keys:string[],anchor?:string):void;
  setFilter(ref?: string, search?: string): void; setCheckedRefs(refs: string[]): void; setExpandedRefGroup(key:string,expanded:boolean):void; toggleSidebarGroup(key:string):void; setSearch(value: string): void; selectWorking(): void; selectFile(target: DiffTarget): void; locateHead():void;
  execute(action: GitAction): Promise<boolean>; dismissFeedback(): void; setDraft(value: string): void; setLanguage(value: Language): void; setLayout(value: Partial<LayoutState>): void; report(error: unknown): void;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const clamp = (n: number, min: number, max: number, fallback: number) => Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
function layout(value: Partial<LayoutState> = {}): LayoutState {
  const l = { ...defaultLayout, ...value };
  return { preset: 'workbench', sidebar: clamp(l.sidebar, 160, 360, 210), details: clamp(l.details, 230, 480, 300), diff: clamp(l.diff, 130, 1400, 220), diffCollapsed: Boolean(l.diffCollapsed), graph: clamp(l.graph, 48, 180, 64), author: clamp(l.author, 64, 220, 100), date: clamp(l.date, 82, 220, 120), font: Math.round(clamp(l.font, 12, 16, 13)), row: Math.round(clamp(l.row, 22, 36, 24)) };
}
const initialLayout = layout(session.layout);
// Only the old default density migrates; custom dimensions and drafts are kept.
if (!session.appearance && initialLayout.row === 26) initialLayout.row = 24;
export const useWorkbench = create<WorkbenchState>((set, get) => ({
  repositories: [], repositoryCollections:[], repositoryStatuses: {}, selectedRepositoryKeys:[], commits: [], selectedOids:[], selectedRefs:[], search: '', language: session.language === 'zh-CN' ? 'zh-CN' : 'en', layout: initialLayout, appearance: normalizeAppearance(session.appearance), locateToken:0,nextOffset: 0, tips: [], hasMore: false, loading: false, historyLoading: false, detailsLoading: false, diffRevision: 0, busy: false, activity: '', tab: 'history', drafts: session.drafts ?? {}, collapsedSidebarGroups:[],
  report(error) { set({ error: message(error) }); },
  async initialize() {
    set({ loading: true });
    try { const [repositories,collectionsResult,orderResult] = await Promise.all([rpc<Repository[]>('repositories'),rpc<RepositoryCollection[]>('repositoryCollections'),rpc<RepositoryOrder>('repositoryOrder')]),repositoryCollections=Array.isArray(collectionsResult)?collectionsResult:[],currentId=get().repoId,keys=new Set(groupRepositories(repositories,currentId).map(group=>group.key)),selectedRepositoryKeys=get().selectedRepositoryKeys.filter(key=>keys.has(key)),repositorySelectionAnchor=selectedRepositoryKeys.includes(get().repositorySelectionAnchor??'')?get().repositorySelectionAnchor:undefined; set({ repositories,repositoryCollections,repositoryOrder:orderResult?.root?orderResult:undefined,selectedRepositoryKeys,repositorySelectionAnchor }); void get().loadRepositoryStatuses(); if (!repositories.some(r => r.id === currentId)) { const initial = currentId?undefined:repositories.find(r => r.id === session.repoId); if (initial) await get().selectRepository(initial.id); else { ++repositoryEpoch; ++historyEpoch; ++detailEpoch; set({ repoId: undefined, snapshot: undefined, commits: [], historyHead: undefined, details: undefined, comparison:undefined, selectedOid:undefined,selectedOids:[],selectedFile:undefined,diffTarget:undefined,busy:false,activity:'',...(currentId?{notice:get().language==='zh-CN'?'该仓库已从 AlwayGit 移除。':'The repository was removed from AlwayGit.'}:{}) }); } } }
    catch (error) { get().report(error); } finally { set({ loading: false }); }
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
    ++repositoryEpoch; ++historyEpoch; ++detailEpoch; const view = views[id];
    set({ operationReview: undefined });
    set({ repoId: id, locatingOid: undefined, snapshot: undefined, commits: [], historyHead: undefined, selectedOids:[], selectionAnchor:undefined, selectedRefs:[],refSelectionAnchor:undefined, tips: [], details: undefined, comparison:undefined, stashDetails: undefined, selectedStashSection:undefined, diffTarget: undefined, diffRevision:0, selectedFile: view?.selectedFile, selectedOid: view?.selectedOid, selectedParent: view?.selectedParent, selectedStashOid: view?.selectedStashOid, ref: view?.ref, checkedRefs: view?.checkedRefs ? [...view.checkedRefs] : view?.ref ? [view.ref] : undefined, expandedRefGroups:view?.expandedRefGroups?[...view.expandedRefGroups]:undefined,collapsedSidebarGroups:[...(view?.collapsedSidebarGroups??[])], search: view?.search ?? '', tab: view?.tab ?? 'history', checkoutFailure: undefined, stashApplyFailure: undefined, error: undefined, notice: undefined, actionFeedback: actionFeedbacks.get(id), loading: true, busy: executingRepositories.has(id) || hostBusyRepositories.has(id), activity: '', detailsLoading: false, historyLoading: false });
    await get().refresh();
  },
  async refresh(options = {}) {
    const epoch = repositoryEpoch, request = ++snapshotEpoch, repoId = get().repoId; if (!repoId) return; set({ loading: true });
    refreshInvalidation = {
      epoch,
      changes: refreshInvalidation?.epoch === epoch ? mergeChanges(refreshInvalidation.changes, options.changes) : options.changes,
      forceHistory: !options.background || (refreshInvalidation?.epoch === epoch && refreshInvalidation.forceHistory),
    };
    try {
      const incoming = await rpc<Snapshot>('snapshot', repoId); if (epoch !== repositoryEpoch || request !== snapshotEpoch || incoming.version < (get().snapshot?.version ?? -1)) return;
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
      if (get().tab === 'changes') {
        const target = workingTarget(snapshot, get().diffTarget, get().selectedFile);
        if (target) get().selectFile(target); else if (get().diffTarget) set({ selectedFile: undefined, diffTarget: undefined });
        if (target && diffKey(target) === diffKey(previousTarget) && affectsWorkingDiff(previous, snapshot, target, invalidation.changes)) set({ diffRevision: get().diffRevision + 1 });
      }
      if (reloadHistory) await get().loadHistory();
    } catch (error) { if (epoch === repositoryEpoch && request === snapshotEpoch) get().report(error); }
    finally { if (epoch === repositoryEpoch && request === snapshotEpoch) { refreshInvalidation = undefined; set({ loading: false }); } }
  },
  async loadHistory(append = false) {
    const { repoId, search, nextOffset, historyLoading, checkedRefs } = get(); if (!repoId || append && historyLoading) return;
    const epoch = ++historyEpoch, repoEpoch = repositoryEpoch; set({ historyLoading: true });
    try {
      const query: HistoryQuery = { offset: append ? nextOffset : 0, tips: append ? get().tips : checkedRefs ?? [], ...(search ? { search } : {}), ...(get().snapshot?.head ? { head: get().snapshot!.head } : {}) };
      const page = await rpc<HistoryPage>('history', repoId, query);
      if (epoch !== historyEpoch || repoEpoch !== repositoryEpoch) return;
      const prior = new Set(get().commits.map(c => c.oid)), all = append ? [...get().commits, ...page.commits.filter(c => !prior.has(c.oid))] : page.commits;
      set({ commits: all, historyHead: page.head, tips: page.tips, nextOffset: page.nextOffset, hasMore: page.hasMore });
      const stashSelected = !!get().selectedStashOid && get().snapshot?.stashes.some(s => s.oid === get().selectedStashOid);
      if(get().selectedStashOid&&!stashSelected){++detailEpoch;set({selectedStashOid:undefined,selectedStashSection:undefined,stashDetails:undefined,selectedOid:all[0]?.oid,selectedParent:undefined,details:undefined,detailsLoading:false,diffTarget:undefined});}
      if (!append && get().tab === 'history' && !get().selectedOid && all.length) void get().selectCommit(all[0].oid);
      else if (!append && get().tab === 'history' && get().selectedOid && !get().details && !get().comparison && !get().detailsLoading) void get().selectCommit(get().selectedOid!, get().selectedParent, stashSelected ? get().selectedStashOid : undefined, get().selectedOids.length>1);
    } catch (error) { if (epoch === historyEpoch && repoEpoch === repositoryEpoch) get().report(error); }
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
        if(!chosen)throw new Error('The selected Stash has no readable sections.');
        const [selectedStashSection,details]=chosen;
        set({details,stashDetails,selectedStashSection,selectedOid:details.commit.oid,selectedParent:details.parent});
        const file=(same?details.files.find(candidate=>candidate.path===get().selectedFile):undefined)??details.files[0];
        if(file)get().selectFile({kind:'commit',oid:details.commit.oid,path:file.path,previousPath:file.previousPath,parent:details.parent});else set({selectedFile:undefined,diffTarget:undefined});
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
      if (file) get().selectFile({ kind: 'commit', oid, path: file.path, previousPath: file.previousPath, parent: details.parent }); else set({ selectedFile: undefined, diffTarget: undefined });
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
  setRefSelection(selectedRefs,refSelectionAnchor){set({selectedRefs:[...new Set(selectedRefs)],refSelectionAnchor});},
  setRepositorySelection(selectedRepositoryKeys,repositorySelectionAnchor){set({selectedRepositoryKeys:[...new Set(selectedRepositoryKeys)],repositorySelectionAnchor});},
  setFilter(ref, search = get().search) { set({ ref, locatingOid: undefined, checkedRefs: ref ? [ref] : get().snapshot?.refs.filter(r => r.kind !== 'tag').map(r => r.fullName) ?? [], search, tips: [], selectedOids:[], selectionAnchor:undefined, comparison:undefined, selectedStashOid: undefined,selectedStashSection:undefined,stashDetails:undefined }); void get().loadHistory(); },
  setCheckedRefs(refs) { set({ locatingOid: undefined, checkedRefs: [...new Set(refs)], ref: undefined, tips: [], selectedOids:[], selectionAnchor:undefined, comparison:undefined }); void get().loadHistory(); },
  setExpandedRefGroup(key,expanded){set({expandedRefGroups:expanded?[...new Set([...(get().expandedRefGroups??[]),key])]:(get().expandedRefGroups??[]).filter(item=>item!==key)});},
  toggleSidebarGroup(key){set({collapsedSidebarGroups:get().collapsedSidebarGroups.includes(key)?get().collapsedSidebarGroups.filter(item=>item!==key):[...get().collapsedSidebarGroups,key]});},
  setSearch(search) { set({ search, commits: [], historyHead: undefined, tips: [], nextOffset: 0, hasMore: false, locatingOid: undefined, selectedOids:[], selectionAnchor:undefined, comparison:undefined }); void get().loadHistory(); },
  selectWorking() {
    ++detailEpoch; const snapshot = get().snapshot, target = snapshot && workingTarget(snapshot, get().diffTarget, get().selectedFile); set({ tab: 'changes', locatingOid:undefined, selectedOids:[], selectionAnchor:undefined, comparison:undefined, detailsLoading: false });
    if (target) get().selectFile(target); else set({ selectedFile: undefined, diffTarget: undefined });
  },
  selectFile(target) { if (diffKey(target) !== diffKey(get().diffTarget)) set({ selectedFile: target.path, diffTarget: target }); },
  locateHead(){const snapshot=get().snapshot;if(!snapshot?.head)return;const ref=snapshot.refs.find(r=>r.kind==='local'&&r.name===snapshot.branch)?.fullName??'HEAD';set({checkedRefs:[...new Set([...(get().checkedRefs??[]),ref])],search:'',commits:[],historyHead:undefined,nextOffset:0,hasMore:false,locatingOid:undefined,locateToken:get().locateToken+1,selectedStashOid:undefined,selectedStashSection:undefined,stashDetails:undefined});void get().loadHistory();void get().selectCommit(snapshot.head);},
  async locateCommit(oid) {
    if(!get().repoId)return;
    const repoEpoch=repositoryEpoch,token=get().locateToken+1;
    set({search:'',commits:[],historyHead:undefined,tips:[],nextOffset:0,hasMore:false,locateToken:token,locatingOid:oid,selectedStashOid:undefined,selectedStashSection:undefined,stashDetails:undefined,notice:undefined});
    void get().selectCommit(oid);
    const current=()=>repositoryEpoch===repoEpoch&&get().locateToken===token&&get().locatingOid===oid&&get().selectedOid===oid&&!get().search&&get().tab==='history';
    try {
      let append=false;
      while(current()) {
        const offset=get().nextOffset,expectedEpoch=historyEpoch+1;
        await get().loadHistory(append);
        if(!current()||historyEpoch!==expectedEpoch)return;
        if(get().commits.some(commit=>commit.oid===oid))return;
        if(!get().hasMore||get().nextOffset<=offset) {
          set({notice:get().language==='zh-CN'?'无法在当前引用的完整历史中定位该 Commit。':'Could not locate this Commit in the full history of the selected refs.'});
          return;
        }
        append=true;
      }
    } finally {
      if(repositoryEpoch===repoEpoch&&get().locateToken===token)set({locatingOid:undefined});
    }
  },
  async execute(action) {
    const repoId = get().repoId, epoch = repositoryEpoch; if (!repoId || get().busy) return false;
    if ((action.type === 'operation.continue' || action.type === 'commit' && get().snapshot?.operation.kind) && !action.reviewToken) {
      executingRepositories.add(repoId); set({ busy: true, activity: 'Inspect staged result', error: undefined, operationReview: undefined });
      try {
        const review = await rpc<OperationReview>('operationReview', repoId);
        if (epoch === repositoryEpoch) {
          if (action.type === 'operation.continue' && review.kind !== action.kind) throw new Error('The Git operation changed. Refresh before continuing.');
          set({ operationReview: { repoId, action, review } });
        }
      } catch (error) { if (epoch === repositoryEpoch) { get().report(error); await get().refresh({ background: true }); } }
      finally { executingRepositories.delete(repoId); if (epoch === repositoryEpoch) set({ busy: hostBusyRepositories.has(repoId), activity: '' }); }
      return false;
    }
    set({ operationReview: undefined });
    const before=get().snapshot,committedFiles = action.type === 'commit' && !action.amend ? before?.changes.filter(change => !change.conflict && change.indexStatus !== ' ' && change.indexStatus !== '?' && !!change.indexStatus).length : undefined;
    const stashed=action.type==='stash.create'?{files:before?.changes.length??0,untracked:before?.changes.filter(change=>change.untracked).length??0,previousOid:before?.stashes[0]?.oid}:undefined;
    const feedback: ActionFeedback = { id: ++actionSequence, repoId, action, status: 'running', target: actionTarget(action, get().snapshot) };
    const finish = (status: 'success' | 'error', error?: string, result?: ActionFeedback['result']) => {
      if (actionFeedbacks.get(repoId)?.id !== feedback.id) return;
      const completed = { ...feedback, status, error, result };
      actionFeedbacks.set(repoId, completed);
      if (get().repoId === repoId) set({ actionFeedback: completed });
    };
    actionFeedbacks.set(repoId, feedback);
    executingRepositories.add(repoId); set({ busy: true, activity: action.type, actionFeedback: feedback, error: undefined, notice: undefined, checkoutFailure: undefined, stashApplyFailure: undefined });
    try {
      await rpc('action', repoId, action);
      if (epoch === repositoryEpoch) {
        await get().refresh({ background: true });
        if(epoch===repositoryEpoch) {
          const checkout = ['branch.checkout', 'commit.checkout', 'checkout.stash'].includes(action.type) || (action.type === 'branch.create' || action.type === 'branch.track') && action.checkout;
          if (checkout) { const snap = get().snapshot; const ref = snap?.refs.find(r => r.kind === 'local' && r.name === snap.branch)?.fullName ?? (snap?.head ? 'HEAD' : undefined); if (ref && !get().checkedRefs?.includes(ref)) get().setCheckedRefs([...(get().checkedRefs ?? []), ref]); }
          set({ notice: demoMode ? (get().language === 'zh-CN' ? `模拟操作：${action.type}；未修改实际仓库。` : `Demo: ${action.type} completed. No disk changes.`) : action.type === 'resolve-and-stage' ? (get().language === 'zh-CN' ? '已标记并暂存；继续前请检查结果。' : 'Marked and staged; inspect the result before continuing.') : `${action.type} ✓` });
        }
      }
      const snapshot = epoch === repositoryEpoch ? get().snapshot : undefined;
      finish('success', undefined, action.type === 'commit' && snapshot?.head ? { kind: 'commit', oid: snapshot.head, files: committedFiles, remaining: snapshot.changes.length, amended: !!action.amend } : stashed&&snapshot&&snapshot.stashes[0]?.oid!==stashed.previousOid?{kind:'stash',files:stashed.files,untracked:stashed.untracked,clean:snapshot.changes.length===0}:action.type==='branch.create'&&snapshot?{kind:'branch',name:action.name,checkedOut:!!action.checkout,currentBranch:snapshot.branch||'Detached HEAD'}:undefined);
      return true;
    } catch (error) {
      if (get().repoId === repoId) {
        const structured = error as { code?: string; details?: CheckoutBlocker | StashApplyBlocker };
        // Failed Merge / Cherry-pick can leave a new operation and conflicts on disk.
        await get().refresh({ background: true });
        if (get().repoId !== repoId) { finish('error', message(error)); return false; }
        const details=structured.details;
        set({ error: message(error), stashApplyFailure: details&&'kind' in details&&details.kind==='stash-apply'?details:undefined, checkoutFailure: details&&'target' in details ? { ...details, detached: action.type === 'commit.checkout' || action.type === 'checkout.stash' && action.detached } : undefined });
      }
      finish('error', message(error));
      return false;
    } finally { executingRepositories.delete(repoId); if (get().repoId===repoId) set({ busy: hostBusyRepositories.has(repoId), activity: hostBusyRepositories.has(repoId)?get().activity:'' }); }
  },
  dismissFeedback() {
    const feedback = get().actionFeedback;
    if (!feedback || feedback.status === 'running') return;
    actionFeedbacks.delete(feedback.repoId);
    set({ actionFeedback: undefined, ...(get().error === feedback.error ? { error: undefined, stashApplyFailure: undefined } : {}) });
  },
  setDraft(value) { const repoId = get().repoId; if (repoId) set({ drafts: { ...get().drafts, [repoId]: value } }); },
  setLanguage(language) { set({ language }); },
  setLayout(value) { set({ layout: layout({ ...get().layout, ...value }) }); },
  restoreLayout() { const { font, row } = get().layout; set({ layout: { ...defaultLayout, font, row } }); },
  beginSettings() {
    const state = get(); if (state.settingsBaseline) return;
    set({ settingsBaseline: { language: state.language, font: state.layout.font, row: state.layout.row, appearance: { ...state.appearance } } });
  },
  previewSettings(value) {
    if (!get().settingsBaseline) return;
    const state = get();
    set({ language: value.language ?? state.language, appearance: normalizeAppearance(value.appearance ?? state.appearance), layout: layout({ ...state.layout, font: value.font ?? state.layout.font, row: value.row ?? state.layout.row }) });
  },
  finishSettings(apply) {
    const baseline = get().settingsBaseline; if (!baseline) return;
    set(apply ? { settingsBaseline: undefined } : { settingsBaseline: undefined, language: baseline.language, appearance: baseline.appearance, layout: layout({ ...get().layout, font: baseline.font, row: baseline.row }) });
  },
}));
useWorkbench.subscribe(state => {
  if (state.repoId) views[state.repoId] = { ref: state.ref, checkedRefs: state.checkedRefs, expandedRefGroups:state.expandedRefGroups,collapsedSidebarGroups:state.collapsedSidebarGroups, search: state.search, selectedOid: state.selectedOid, selectedParent: state.selectedParent, selectedStashOid: state.selectedStashOid, selectedFile: state.selectedFile, tab: state.tab };
  const baseline = state.settingsBaseline;
  saveSession({ version: 2, repoId: state.repoId, drafts: state.drafts, views, language: baseline?.language ?? state.language, layout: baseline ? { ...state.layout, font: baseline.font, row: baseline.row } : state.layout, appearance: baseline?.appearance ?? state.appearance });
});
let changedTimer: ReturnType<typeof setTimeout>;
let pendingChange: { repoId: string; changes?: RepositoryChanges } | undefined;
subscribe(event => {
  const state = useWorkbench.getState(); if (event.type === 'repositoriesChanged') void state.initialize();
  if (event.type === 'changed' && event.repoId === state.repoId) {
    clearTimeout(changedTimer);
    pendingChange = { repoId: event.repoId, changes: pendingChange?.repoId === event.repoId ? mergeChanges(pendingChange.changes, event.changes) : event.changes };
    changedTimer = setTimeout(() => {
      const pending = pendingChange; pendingChange = undefined;
      if (pending && pending.repoId === useWorkbench.getState().repoId) void useWorkbench.getState().refresh({ background: true, changes: pending.changes });
    }, 160);
  }
  if(event.type==='activity'){if(event.busy)hostBusyRepositories.add(event.repoId);else hostBusyRepositories.delete(event.repoId);if(event.repoId===state.repoId)useWorkbench.setState({busy:event.busy||executingRepositories.has(event.repoId),activity:event.label});}
  if (event.type === 'selectRepository') void state.selectRepository(event.repoId);
});
