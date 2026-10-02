import { groupRepositories } from '../src/protocol/repositories';
import { branchNameConflict, branchNameConflictMessage } from '../src/protocol/ref-name';
import { reconcileRepositoryOrder } from '../src/protocol/repository-order';
import type { RepositoryOrder, ReorderRepository, ActionBlocker, Commit, CommitComparison, CommitDetails, GitAction, HistoryPage, HistoryQuery, HostMessage, Repository, RepositoryCollection, RepositoryStatus, RpcRequest, Snapshot, OperationSettings, StashDetails } from '../src/protocol/types';
import type { Appearance } from './appearance';

export interface LayoutState { preset: 'workbench' | 'editor'; sidebar: number; details: number; diff: number; diffCollapsed: boolean; graph: number; author: number; date: number; font: number; row: number }
export interface SessionState { version?: number; language?: 'en' | 'zh-CN'; layout?: LayoutState; appearance?: Appearance; repoId?: string; drafts?: Record<string, string>; views?: Record<string, { ref?: string; checkedRefs?: string[]; expandedRefGroups?: string[]; collapsedSidebarGroups?: string[]; search: string; selectedOid?: string; selectedParent?: string; selectedStashOid?: string; selectedFile?: string; tab: 'history' | 'changes' }> }
export class RpcError extends Error {
  constructor(message: string, public code?: string, public details?: ActionBlocker) { super(message); this.name = 'RpcError'; }
}
declare global { interface Window { __ALWAYGIT_SESSION__?: SessionState; acquireVsCodeApi?: () => { postMessage(message: unknown): void; getState?(): SessionState | undefined; setState?(state: SessionState): void }; } }
const vscode = typeof window.acquireVsCodeApi === 'function' ? window.acquireVsCodeApi() : undefined;
export const demoMode = !vscode && new URLSearchParams(location.search).get('demo') === '1';
const noRemoteDemo = demoMode && new URLSearchParams(location.search).get('noRemote') === '1';
export const connected = !!vscode || demoMode;
export function readSession(): SessionState {
  if (vscode) return vscode.getState?.() ?? window.__ALWAYGIT_SESSION__ ?? {};
  if (demoMode) try { return JSON.parse(localStorage.getItem('alwaygit.demo-session') || '{}'); } catch { return {}; }
  return {};
}
let previousSession = '';
export function saveSession(state: SessionState) {
  if (vscode) {
    const serialized = JSON.stringify(state); if (serialized === previousSession) return;
    previousSession = serialized; vscode.setState?.(state);
    vscode.postMessage({ id: `session-${++sequence}`, method: 'saveSession', payload: state }); return;
  }
  if (demoMode) try { localStorage.setItem('alwaygit.demo-session', JSON.stringify(state)); } catch { /* The live session still keeps drafts. */ }
}
const listeners = new Set<(event: HostMessage) => void>();
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> }>();
let sequence = 0;
window.addEventListener('message', event => {
  const message = event.data as HostMessage;
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'response') {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new RpcError(message.error.message, message.error.code, message.error.details)); else request.resolve(message.result);
  } else listeners.forEach(listener => listener(message));
});
export function subscribe(listener: (event: HostMessage) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export async function rpc<T>(method: RpcRequest['method'], repoId?: string, payload?: unknown): Promise<T> {
  if (demoMode) return demoRequest(method, payload, repoId) as Promise<T>;
  if (!vscode) throw new Error('Open AlwayGit in VS Code to connect to your repositories.');
  const id = `webview-${++sequence}`;
  return new Promise<T>((resolve, reject) => {
    // Folder selection and cancellable recursive discovery can outlive a Git request.
    const timer = ['pickRepositoryDirectory','discoverRepositories','addRepository'].includes(method) ? undefined : setTimeout(() => { pending.delete(id); reject(new Error('The Git operation timed out. Refresh to check its result before retrying.')); }, 180_000);
    pending.set(id, { resolve: value => resolve(value as T), reject, timer });
    vscode.postMessage({ id, method, repoId, payload } satisfies RpcRequest);
  });
}

const repo: Repository = { id: 'demo-alwaygit', root: 'D:\\Projects\\AlwayGit', commonDir: 'D:\\Projects\\AlwayGit\\.git', name: 'AlwayGit' };
const subjects = ['Polish repository workbench interactions', 'Add native diff integration', 'Merge branch feature/history-graph', 'Render commit graph with stable lanes', 'Keep commit drafts when switching repositories', 'Handle renamed files in changes', 'Improve keyboard navigation', 'Add worktree discovery', 'Show upstream tracking status', 'Update development dependencies', 'Fix status refresh after checkout', 'Introduce Git operation progress'];
const authors = ['Alex Chen', 'Morgan Lee', 'Sam Rivera', 'Jamie Park'];
const oid = (n: number) => (0x9a73ed + n * 98761).toString(16).padStart(8, '0') + 'c42d9918a6bc5e4791033ad7e6f202cc';
const commits: Commit[] = Array.from({ length: 180 }, (_, n) => ({ oid: oid(n), parents: n === 179 ? [] : n % 12 === 2 ? [oid(n + 1), oid(n + 4)] : [oid(n + 1)], author: authors[n % 4], email: `${authors[n % 4].split(' ')[0].toLowerCase()}@example.com`, timestamp: 1790715600 - n * 13800, subject: subjects[n % subjects.length], pushed: n >= 2 }));
let demoSnapshot: Snapshot = { repository: repo, branch: 'main', head: commits[0].oid, upstream: 'origin/main', defaultBranch: 'main', pushTarget: { localBranch: 'main', remote: 'origin', remoteBranch: 'main', configured: true }, ahead: 2, behind: 0, changes: [
  { path: 'webview/App.tsx', indexStatus: 'M', worktreeStatus: ' ', conflict: false, untracked: false },
  { path: 'webview/styles.css', indexStatus: ' ', worktreeStatus: 'M', conflict: false, untracked: false },
  { path: 'src/git/service.ts', indexStatus: ' ', worktreeStatus: 'M', conflict: false, untracked: false },
  { path: 'docs/workbench-notes.md', indexStatus: '?', worktreeStatus: '?', conflict: false, untracked: true },
], refs: [
  { name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: commits[0].oid, upstream: 'origin/main' },
  { name: 'feature/history-graph', fullName: 'refs/heads/feature/history-graph', kind: 'local', oid: commits[3].oid },
  { name: 'feature/login/api', fullName: 'refs/heads/feature/login/api', kind: 'local', oid: commits[5].oid },
  { name: 'feature/test', fullName: 'refs/heads/feature/test', kind: 'local', oid: commits[7].oid },
  { name: 'fix/status-refresh', fullName: 'refs/heads/fix/status-refresh', kind: 'local', oid: commits[8].oid },
  { name: 'origin/main', fullName: 'refs/remotes/origin/main', kind: 'remote', oid: commits[2].oid },
  { name: 'origin/develop', fullName: 'refs/remotes/origin/develop', kind: 'remote', oid: commits[6].oid },
  { name: 'origin/feature/checkout', fullName: 'refs/remotes/origin/feature/checkout', kind: 'remote', oid: commits[7].oid },
  { name: 'origin/feature/subtree/api', fullName: 'refs/remotes/origin/feature/subtree/api', kind: 'remote', oid: commits[8].oid },
  { name: 'v0.1.0', fullName: 'refs/tags/v0.1.0', kind: 'tag', oid: commits[14].oid },
], stashes: [{ selector: 'stash@{0}', oid: commits[9].oid, subject: 'WIP: repository picker styling' }], worktrees: [{ path: repo.root, head: commits[0].oid, branch: 'refs/heads/main', bare: false, detached: false }, { path: 'D:\\Projects\\AlwayGit-graph', head: commits[3].oid, branch: 'refs/heads/feature/history-graph', bare: false, detached: false }], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 1 };
const website:Repository={id:'demo-website',root:'D:\\Projects\\website',commonDir:'D:\\Projects\\website\\.git',name:'website'};
const demoStores:Record<string,{snapshot:Snapshot;commits:Commit[];saved:Map<string,Snapshot['changes']>}>=Object.fromEntries([repo,website].map(repository=>[
  repository.id,
  {snapshot:{...structuredClone(demoSnapshot),repository,remotes:['origin'],worktrees:demoSnapshot.worktrees.map((tree,i)=>({...tree,path:i?repository.root+'-graph':repository.root}))},commits:structuredClone(commits),saved:new Map([[commits[9].oid,[{path:'notes.txt',indexStatus:'?',worktreeStatus:'?',conflict:false,untracked:true}] ]])},
]));
if(noRemoteDemo)for(const store of Object.values(demoStores)){store.snapshot.remotes=[];store.snapshot.refs=store.snapshot.refs.filter(ref=>ref.kind!=='remote');delete store.snapshot.upstream;delete store.snapshot.pushTarget;}
const demoCollections:RepositoryCollection[]=[];
let demoOrder:RepositoryOrder|undefined;
let demoOperationSettings: OperationSettings = { allowDetachedHead: localStorage.getItem('alwaygit.demo-allowDetachedHead') === 'true', scope: 'workspace' };
async function demoRequest(method: RpcRequest['method'], payload: unknown, repoId?:string): Promise<unknown> {
  await new Promise(resolve => setTimeout(resolve, 110));
  const data=demoStores[repoId??repo.id]??demoStores[repo.id],demoSnapshot=data.snapshot,commits=data.commits;
  const resolve=(ref:string)=>ref==='HEAD'?demoSnapshot.head!:demoSnapshot.refs.find(r=>r.name===ref||r.fullName===ref)?.oid??ref;
  if (method === 'operationSettings') return { ...demoOperationSettings };
  if (method === 'saveOperationSettings') { demoOperationSettings = { allowDetachedHead: (payload as { allowDetachedHead: boolean }).allowDetachedHead, scope: 'workspace' }; localStorage.setItem('alwaygit.demo-allowDetachedHead', String(demoOperationSettings.allowDetachedHead)); listeners.forEach(listener => listener({ type: 'operationSettingsChanged', settings: { ...demoOperationSettings } })); return { ...demoOperationSettings }; }
  if (method === 'repositories') return [repo,website];
  if(method==='pickRepositoryDirectory')return 'D:\\Projects';
  if(method==='discoverRepositories'){const scanId=(payload as {scanId:string}).scanId;return {scanId,root:'D:\\Projects',scanned:8,found:3,cancelled:false,candidates:[{key:'demo-existing',name:'AlwayGit',path:repo.root,existing:true},{key:'demo-notes',name:'NotesAnywhere',path:'D:\\Projects\\NotesAnywhere',existing:false},{key:'demo-resume',name:'SwiftResume',path:'D:\\Projects\\SwiftResume',existing:false}],issues:[]};}
  if(method==='cancelRepositoryDiscovery')return null;
  if(method==='addRepository')return {added:2,existing:0,skipped:0};
  if(method==='repositoryCollections')return demoCollections;
  if(method==='repositoryOrder'||method==='reorderRepository'){
    demoOrder=reconcileRepositoryOrder(groupRepositories([repo,website]),demoCollections,demoOrder);
    if(method==='reorderRepository'){const {key,targetKey,position}=payload as ReorderRepository,entries=demoOrder.root.filter(entry=>entry!==key);entries.splice(entries.indexOf(targetKey)+Number(position==='after'),0,key);demoOrder.root=entries;}
    return structuredClone(demoOrder);
  }
  if(method==='createRepositoryCollection'){const collection={id:`demo-group-${demoCollections.length+1}`,name:(payload as {name:string}).name};demoCollections.push(collection);return collection;}
  if (method === 'repositoryStatuses') return Object.values(demoStores).map(({ snapshot }) => ({ repositoryId: snapshot.repository.id, branch: snapshot.branch, upstream: snapshot.upstream, ahead: snapshot.ahead, unpushed: snapshot.unpushed ?? snapshot.ahead } satisfies RepositoryStatus));
  if (method === 'snapshot') return structuredClone(demoSnapshot);
  if (method === 'history') {
    const query = (payload ?? {}) as HistoryQuery;
    const tips=[...new Set(query.tips?.map(resolve)??(query.ref?[resolve(query.ref)]:demoSnapshot.refs.map(r=>r.oid)))],byId=new Map(commits.map(c=>[c.oid,c])),seen=new Set<string>(),pending=[...tips];
    while(pending.length){const id=pending.pop()!;if(seen.has(id))continue;seen.add(id);pending.push(...(byId.get(id)?.parents??[]));}
    const result=commits.filter(c=>seen.has(c.oid)&&(!query.search||c.subject.toLowerCase().includes(query.search.toLowerCase())));
    const offset = query.offset ?? 0, limit = query.limit ?? 100;
    const visible=result.slice(offset,offset+limit),head=commits.find(commit=>commit.oid===demoSnapshot.head);
    return { commits: visible, nextOffset: offset + Math.min(limit,result.length-offset), hasMore: offset + limit < result.length, tips, ...(head?{head}: {}) } satisfies HistoryPage;
  }
  if (method === 'details') {
    const request = payload as { oid: string; parent?: string }; const commit = commits.find(c => c.oid === resolve(request.oid)) ?? commits[0];
    return { commit, body: `${commit.subject}\n\nImprove the repository experience with clear status feedback and consistent navigation.\n\nCloses #24`, parent: request.parent ?? commit.parents[0], files: [{ path: 'webview/App.tsx', status: 'M' }, { path: 'webview/styles.css', status: 'M' }, { path: 'src/git/service.ts', status: 'A' }] } satisfies CommitDetails;
  }
  if (method === 'stashDetails') {
    const request=payload as {oid:string},stash=demoSnapshot.stashes.find(item=>item.oid===request.oid)??demoSnapshot.stashes[0],saved=data.saved.get(stash?.oid??'')??[];
    const base=commits[0],indexCommit={...base,oid:'e'.repeat(40),parents:[base.oid],subject:`index on ${demoSnapshot.branch}`},untrackedCommit={...base,oid:'f'.repeat(40),parents:[],subject:`untracked files on ${demoSnapshot.branch}`},stashCommit={...base,oid:stash?.oid??request.oid,parents:[base.oid,indexCommit.oid,...(saved.some(file=>file.untracked)?[untrackedCommit.oid]:[])],subject:stash?.subject??'WIP'};
    const detail=(commit:Commit,parent:string|undefined,files:typeof saved):CommitDetails=>({commit,body:commit.subject,...(parent?{parent}:{}),files:files.map(file=>({path:file.path,status:file.untracked?'A':file.indexStatus!==' '&&file.indexStatus!=='?'?file.indexStatus:file.worktreeStatus}))});
    const working=detail(stashCommit,indexCommit.oid,saved.filter(file=>!file.untracked&&file.worktreeStatus!==' ')),index=detail(indexCommit,base.oid,saved.filter(file=>!file.untracked&&file.indexStatus!==' '&&file.indexStatus!=='?')),untracked=saved.some(file=>file.untracked)?detail(untrackedCommit,undefined,saved.filter(file=>file.untracked)):undefined;
    return {commit:stashCommit,body:stashCommit.subject,sections:{working,index,...(untracked?{untracked}:{})},totalFiles:new Set(saved.map(file=>file.path)).size} satisfies StashDetails;
  }
  if(method==='compare'){const request=payload as {left:string;right:string},left=commits.find(commit=>commit.oid===resolve(request.left))??commits[1],right=commits.find(commit=>commit.oid===resolve(request.right))??commits[0];return {left,right,files:[{path:'webview/App.tsx',status:'M'},{path:'webview/styles.css',status:'M'},{path:'src/git/service.ts',status:'A'}]} satisfies CommitComparison;}
  if (method === 'operationReview') return { kind: demoSnapshot.operation.kind, token: `demo-${demoSnapshot.version}`, files: demoSnapshot.changes.filter(file=>file.indexStatus!==' '&&!file.untracked).map(file=>({path:file.path,lines:[]})) };
  if (method === 'pickWorktree') return 'D:\\Projects\\AlwayGit-new';
  if(method==='diffPreview'){const target=payload as {path:string;kind:string;area?:string;oid?:string;parent?:string;left?:string;right?:string};return {path:target.path,leftLabel:target.kind==='comparison'?target.left?.slice(0,8):target.kind==='commit'?'Parent '+(target.parent??'').slice(0,8):target.area==='staged'?'HEAD':'Index',rightLabel:target.kind==='comparison'?target.right?.slice(0,8):target.kind==='commit'?target.oid?.slice(0,8):target.area==='staged'?'Index':'Working Tree',left:'export function Workbench() {\n  return <HistoryPanel />;\n}\n',right:'export function Workbench() {\n  return (\n    <WorkbenchLayout>\n      <HistoryPanel />\n      <CommitDetails />\n    </WorkbenchLayout>\n  );\n}\n'};}
  if(method==='copyText'){const {text}=payload as {text:string};if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);else throw new Error('Clipboard is unavailable in this browser.');return null;}
  if (method === 'action') {
    const action = payload as GitAction;
    if (action.type === 'stage' || action.type === 'resolve-and-stage' || action.type === 'unstage' || action.type === 'discard') {
      demoSnapshot.changes = demoSnapshot.changes.flatMap(change => {
        if (!action.paths.includes(change.path)) return [change];
        if (action.type === 'discard') return change.indexStatus === ' ' || change.untracked ? [] : [{ ...change, worktreeStatus: ' ' }];
        return [{ ...change, indexStatus: action.type !== 'unstage' ? 'M' : ' ', worktreeStatus: action.type !== 'unstage' ? ' ' : 'M', conflict: false, untracked: false }];
      });
    } else if (action.type === 'commit') {
      const commit = { ...commits[0], oid: oid(999 + demoSnapshot.version), parents: action.amend ? commits[0].parents : [commits[0].oid], subject: action.message.split('\n')[0], timestamp: Math.floor(Date.now() / 1000), pushed: false }; if (action.amend) commits.shift(); commits.unshift(commit);
      demoSnapshot.head = commit.oid;const branch=demoSnapshot.refs.find(r=>r.kind==='local'&&r.name===demoSnapshot.branch);if(branch)branch.oid=commit.oid; demoSnapshot.changes = demoSnapshot.changes.filter(c => c.worktreeStatus !== ' ' || c.untracked).map(c => ({ ...c, indexStatus: ' ' })); demoSnapshot.ahead++;
    } else if (action.type === 'branch.checkout'||action.type==='commit.checkout'||action.type==='checkout.stash') {
      if ((action.type === 'commit.checkout' || action.type === 'checkout.stash' && action.detached) && !demoOperationSettings.allowDetachedHead) throw new RpcError('Direct Detached HEAD Checkout is disabled. Create and switch to a branch.', 'DETACHED_HEAD_DISABLED');
      const detached=action.type==='commit.checkout'||action.type==='checkout.stash'&&action.detached,target=action.type==='branch.checkout'?action.name:action.target;
      const occupied=demoSnapshot.worktrees.find(tree=>tree.branch?.replace(/^refs\/heads\//,'')===target&&tree.path!==demoSnapshot.repository.root);
      if(!detached&&occupied)throw new RpcError('Branch is in use by another Worktree.','WORKTREE_OCCUPIED',{reason:'worktree-occupied',target,paths:[],worktreePath:occupied.path});
      if(action.type==='checkout.stash'){const stash={selector:'stash@{0}',oid:oid(2000+demoSnapshot.version),subject:'WIP before Checkout'};data.saved.set(stash.oid,structuredClone(demoSnapshot.changes));demoSnapshot.stashes.unshift(stash);demoSnapshot.changes=[];}
      demoSnapshot.branch=detached?'':target;demoSnapshot.head=resolve(target);const tree=demoSnapshot.worktrees[0];if(tree){tree.branch=detached?undefined:target;tree.detached=!!detached;tree.head=demoSnapshot.head;}
    }
    else if (action.type === 'branch.track') {
      const branches=action.branches.map(branch=>{const source=demoSnapshot.refs.find(ref=>ref.kind==='remote'&&ref.fullName===branch.source),existing=demoSnapshot.refs.find(ref=>ref.kind==='local'&&ref.name===branch.name);if(!source||source.symbolicTarget||branch.expectedOid&&source.oid!==branch.expectedOid)throw new Error('Remote branch changed. Refresh and retry.');if(existing&&existing.upstream!==source.name)throw new Error('Local branch has a different upstream.');return {branch,source,existing};});
      const target=branches[0]?.branch.name,occupied=action.checkout&&demoSnapshot.worktrees.find(tree=>tree.branch?.replace(/^refs\/heads\//,'')===target&&tree.path!==demoSnapshot.repository.root);
      if(occupied)throw new RpcError('Branch is in use by another Worktree.','WORKTREE_OCCUPIED',{reason:'worktree-occupied',target:target!,paths:[],worktreePath:occupied.path});
      for(const {branch,source,existing} of branches)if(!existing)demoSnapshot.refs.push({name:branch.name,fullName:'refs/heads/'+branch.name,kind:'local',oid:source.oid,upstream:source.name});
      if(action.checkout&&branches[0]){demoSnapshot.branch=target!;demoSnapshot.head=branches[0].existing?.oid??branches[0].source.oid;demoSnapshot.upstream=branches[0].source.name;const tree=demoSnapshot.worktrees[0];if(tree){tree.branch='refs/heads/'+target;tree.detached=false;tree.head=demoSnapshot.head;}}
    }
    else if (action.type === 'branch.create') {const collision=branchNameConflict(action.name,demoSnapshot.refs.filter(ref=>ref.kind==='local').map(ref=>ref.name));if(collision)throw new RpcError(branchNameConflictMessage(action.name,collision),'BRANCH_EXISTS');const target=resolve(action.start??'HEAD');demoSnapshot.refs.push({ name: action.name, fullName: `refs/heads/${action.name}`, kind: 'local', oid: target,upstream:action.start?.startsWith('refs/remotes/')?action.start.slice(13):undefined }); if (action.checkout){demoSnapshot.branch = action.name;demoSnapshot.head=target;} }
    else if (action.type === 'branch.delete') demoSnapshot.refs = demoSnapshot.refs.filter(r => !(r.kind === 'local' && action.names.includes(r.name)));
    else if(action.type==='remote.add'){demoSnapshot.remotes=[...new Set([...(demoSnapshot.remotes??[]),action.name])];}
    else if(action.type==='remote.delete')demoSnapshot.refs=demoSnapshot.refs.filter(r=>!(r.kind==='remote'&&action.branches.some(branch=>r.name===`${action.remote}/${branch}`)));
    else if (action.type === 'tag.create') demoSnapshot.refs.push({ name: action.name, fullName: `refs/tags/${action.name}`, kind: 'tag', oid: resolve(action.target??'HEAD') });
    else if (action.type === 'tag.delete') demoSnapshot.refs = demoSnapshot.refs.filter(r => !(r.kind === 'tag' && r.name === action.name));
    else if (action.type === 'stash.create') {const stash={selector:'stash@{0}',oid:oid(2000+demoSnapshot.version),subject:action.message||'WIP on '+demoSnapshot.branch};data.saved.set(stash.oid,structuredClone(demoSnapshot.changes));demoSnapshot.stashes.unshift(stash);demoSnapshot.changes=[];}
    else if(action.type==='stash.apply'||action.type==='stash.drop'){
      const stash=demoSnapshot.stashes.find(s=>s.selector===action.selector);
      if(!stash||action.expectedOid&&stash.oid!==action.expectedOid)throw new RpcError('Stash changed. Refresh and retry.','STASH_CHANGED');
      if(action.type==='stash.apply'){
        const saved=data.saved.get(stash.oid)??[{path:'webview/styles.css',indexStatus:' ',worktreeStatus:'M',conflict:false,untracked:false}],collisions=saved.filter(file=>file.untracked&&demoSnapshot.changes.some(change=>change.path===file.path));
        if(collisions.length)throw new RpcError(`Cannot restore the Stash because the project already contains ${collisions[0].path}. Existing files were not overwritten, and the Stash is still saved.`,'STASH_UNTRACKED_CONFLICT',{kind:'stash-apply',reason:'untracked-path-exists',paths:collisions.map(file=>file.path),selector:stash.selector,stashOid:stash.oid,stashRetained:true,workingTreeUnchanged:true});
        const overlaps=saved.filter(file=>demoSnapshot.changes.some(change=>change.path===file.path));
        if(overlaps.length)throw new RpcError('Preflight found conflicting local changes. Restore stopped; the Index and Working Tree are unchanged and the Stash is still saved.','STASH_RESTORE_CONFLICT',{kind:'stash-apply',reason:'restore-conflict',paths:overlaps.map(file=>file.path),selector:stash.selector,stashOid:stash.oid,stashRetained:true,workingTreeUnchanged:true});
        if(demoSnapshot.operation.kind||demoSnapshot.operation.conflicts)throw new RpcError('Resolve the current Git operation or conflicts before restoring this Stash.','STASH_RESTORE_BLOCKED',{kind:'stash-apply',reason:'restore-blocked',paths:demoSnapshot.changes.filter(change=>change.conflict).map(change=>change.path),selector:stash.selector,stashOid:stash.oid,stashRetained:true,workingTreeUnchanged:true});
        demoSnapshot.changes.push(...structuredClone(saved));
      }
      if(action.type==='stash.drop'||action.pop)demoSnapshot.stashes=demoSnapshot.stashes.filter(s=>s.oid!==stash.oid);
    }
    else if (action.type === 'worktree.add') { if ((action.detach || !action.branch && !action.newBranch && action.start) && !demoOperationSettings.allowDetachedHead) throw new RpcError('Detached Worktrees are disabled. Choose a branch.', 'DETACHED_HEAD_DISABLED'); demoSnapshot.worktrees.push({ path: action.path, head: commits[0].oid, branch: action.branch || action.newBranch, bare: false, detached: !!action.detach || !action.branch && !action.newBranch && !!action.start }); }
    else if (action.type === 'worktree.remove') demoSnapshot.worktrees = demoSnapshot.worktrees.filter(w => w.path !== action.path);
    else if (action.type === 'push') { demoSnapshot.ahead = 0; commits.forEach(commit => { commit.pushed = true; }); }
    else if (action.type === 'pull') demoSnapshot.behind = 0;
    demoSnapshot.stashes.forEach((stash,index)=>stash.selector=`stash@{${index}}`);
    demoSnapshot.version++; return undefined;
  }
  return undefined;
}
