import type { DiffTarget, GitRef, Repository, Stash, Worktree } from '../src/protocol/types';
import type { DialogRequest } from './ActionDialog';
import type { MenuItem } from './ContextMenu';
import { useWorkbench } from './store';
import { samePath } from './pathIdentity';
import { rpc } from './rpc';
import { cherryPickOrder } from './commitSelection';

export interface FileMenuEntry { path: string; target: DiffTarget }
export type MenuTarget = { kind: 'repository'; repository: Repository } | { kind: 'ref'; ref: GitRef; refs?:GitRef[] } | { kind: 'ref-folder'; label: string; refs: GitRef[] } | { kind: 'files'; primary: FileMenuEntry; files: FileMenuEntry[] } | { kind: 'commit'; oid: string; oids?: string[] } | { kind: 'stash'; stash: Stash } | { kind: 'worktree'; worktree: Worktree } | { kind: 'remote'; name: string } | { kind: 'group'; group: 'repositories' | 'local' | 'remote' | 'tag' | 'stash' | 'worktree' };
export interface MenuApi { open(dialog: DialogRequest): void; checkout(oid: string): void; openDiff(target: DiffTarget): void; editFile(target: DiffTarget): void; host(method: 'copyText'|'openRepository'|'openWorktree', payload: unknown, repoId?: string): Promise<void>; addRepository(): Promise<void>; fetchRepository(repoId: string): Promise<void> }
export function menuFor(target: MenuTarget, api: MenuApi): { caption: string; items: MenuItem[] } {
  const state=useWorkbench.getState(), snapshot=state.snapshot, busy=state.busy;
  const t=(en:string,zh:string=en)=>state.language==='zh-CN'?zh:en;
  const item=(label:string,run:MenuItem['run'],icon='circle-small',disabled=false,reason?:string):MenuItem=>({label,run,icon,disabled,reason});
  const action=(label:string,dialog:DialogRequest,icon='git-commit',disabled=busy,reason?:string)=>item(label,()=>api.open(dialog),icon,disabled,reason);
  const refresh=item(t('Refresh','刷新'),()=>{void state.refresh();},'refresh',busy);
  const copy=(label:string,text:string)=>item(label,()=>api.host('copyText',{text}),'copy');
  if(target.kind==='repository')return {caption:target.repository.name,items:[item('Open Workbench',()=>state.selectRepository(target.repository.id),'repo'),item('Open in New Window',()=>api.host('openRepository',{newWindow:true},target.repository.id),'window'),item(t('Refresh','刷新'),()=>state.selectRepository(target.repository.id),'refresh'),item('Fetch…',()=>api.fetchRepository(target.repository.id),'cloud-download',busy),copy('Copy Repository Path',target.repository.root)]};
  if(target.kind==='group') {
    const name=target.group;
    const items=name==='repositories'?[item('Add Repository…',api.addRepository,'add'),item(t('Refresh','刷新'),()=>state.initialize(),'refresh')]:name==='local'?[action('Create Branch…',{type:'branch.create'},'git-branch'),item(t('Show All in Graph','全部显示在 Graph'),()=>state.setCheckedRefs([...(state.checkedRefs??[]),...(snapshot?.refs.filter(r=>r.kind==='local').map(r=>r.fullName)??[])]),'check-all'),item(t('Show None in Graph','全部从 Graph 隐藏'),()=>state.setCheckedRefs((state.checkedRefs??[]).filter(r=>!r.startsWith('refs/heads/'))),'clear-all')]:name==='tag'?[action('Create Tag…',{type:'tag.create'},'tag'),refresh]:name==='stash'?[action('Stash Changes…',{type:'stash.create'},'archive',busy||!snapshot?.changes.length||!!snapshot.operation.kind),refresh]:name==='worktree'?[action('Add Worktree…',{type:'worktree.add'},'new-folder'),refresh]:[action('Fetch…',{type:'fetch'},'cloud-download'),refresh];
    return {caption:{repositories:t('Repositories','仓库'),local:t('Local Branches','本地分支'),remote:t('Remotes','远端'),tag:'Tags',stash:'Stashes',worktree:'Worktrees'}[name],items};
  }
  if(target.kind==='remote')return {caption:target.name,items:[action('Fetch…',{type:'fetch',remote:target.name},'cloud-download'),refresh]};
  const remoteParts=(ref:GitRef)=>{const remote=(snapshot?.remotes??[]).slice().sort((a,b)=>b.length-a.length).find(name=>ref.name.startsWith(`${name}/`));return remote?{remote,branch:ref.name.slice(remote.length+1)}:undefined;};
  const refBatch=(refs:GitRef[],caption:string)=>{
    const valid=refs.filter(ref=>ref.targetType===undefined||ref.targetType==='commit'),names=valid.map(ref=>ref.fullName),local=valid.every(ref=>ref.kind==='local'),current=valid.find(ref=>ref.kind==='local'&&ref.name===snapshot?.branch),occupied=valid.find(ref=>ref.kind==='local'&&snapshot?.worktrees.some(tree=>tree.branch?.replace(/^refs\/heads\//,'')===ref.name&&!samePath(tree.path,snapshot.repository.root))),blocked=current?t('The current branch is selected.','选择中包含当前分支。'):occupied?t(`Used by another Worktree: ${occupied.name}`,`其他 Worktree 正在使用：${occupied.name}`):undefined;
    const items:MenuItem[]=[item(t('Show Selected in Graph','在 Graph 中显示所选分支'),()=>state.setCheckedRefs([...(state.checkedRefs??[]),...names]),'eye',!valid.length),item(t('Show Only Selected','仅显示所选分支'),()=>state.setCheckedRefs(names),'filter',!valid.length),item(t('Hide Selected from Graph','从 Graph 隐藏所选分支'),()=>state.setCheckedRefs((state.checkedRefs??[]).filter(name=>!names.includes(name))),'eye-closed',!valid.length)];
    if(local)items.push(action(t(`Delete ${valid.length} Local Branch${valid.length===1?'':'es'}…`,`Delete ${valid.length} 个本地分支…`),{type:'branch.delete',names:valid.map(ref=>ref.name),expectedOids:Object.fromEntries(valid.map(ref=>[ref.name,ref.oid]))},'trash',busy||!!blocked,blocked));
    else {const parsed=valid.map(remoteParts),remote=parsed[0]?.remote,sameRemote=!!remote&&parsed.every(value=>value?.remote===remote),symbolic=valid.some(ref=>!!ref.symbolicTarget),branches=parsed.map(value=>value?.branch).filter((branch):branch is string=>!!branch);items.push(action(remote?t(`Delete ${branches.length} Branch${branches.length===1?'':'es'} from ${remote}…`,`从 ${remote} Delete ${branches.length} 个分支…`):t('Delete Remote Branches…','Delete 远程分支…'),{type:'remote.delete',remote,remoteBranches:branches,expectedOids:Object.fromEntries(valid.flatMap((ref,index)=>parsed[index]?.branch?[[parsed[index]!.branch,ref.oid]]:[]))},'trash',busy||!sameRemote||symbolic,symbolic?t('Symbolic remote references cannot be deleted.','不能删除远端符号引用。'):!sameRemote?t('Select branches from one Remote.','请选择同一个 Remote 下的分支。'):undefined));}
    items.push(copy(t('Copy Branch Names','复制分支名称'),valid.map(ref=>ref.name).join('\n')));
    return {caption,items};
  };
  if(target.kind==='ref-folder')return refBatch(target.refs,`${target.label} · ${target.refs.length} ${t('branches','个分支')}`);
  if(target.kind==='files') {
    const unique=[...new Map(target.files.map(file=>[`${file.target.kind}:${file.path}:${'area' in file.target?file.target.area:''}`,file])).values()],paths=[...new Set(unique.map(file=>file.path))];
    const changes=unique.filter((file):file is FileMenuEntry & {target:Extract<DiffTarget,{kind:'change'}>}=>file.target.kind==='change'),stage=changes.filter(file=>file.target.area!=='staged').map(file=>file.path),unstage=changes.filter(file=>file.target.area==='staged').map(file=>file.path),discard=changes.filter(file=>file.target.area==='unstaged').map(file=>file.path),conflicts=changes.filter(file=>file.target.area==='conflict').map(file=>file.path);
    const items:MenuItem[]=[];
    if(unique.length===1)items.push(item(t('Open Diff in VS Code','在 VS Code 中打开 Diff'),()=>api.openDiff(target.primary.target),'diff'),item(t('Edit in VS Code','在 VS Code 中编辑'),()=>api.editFile(target.primary.target),'edit'));
    if(stage.length)items.push(item(conflicts.length===stage.length?t(`Mark ${stage.length} Resolved`,`标记 ${stage.length} 个已解决`):t(`Stage ${stage.length} File${stage.length===1?'':'s'}`,`Stage ${stage.length} 个文件`),()=>{void state.execute({type:'stage',paths:stage});},'add',busy));
    if(unstage.length)items.push(item(t(`Unstage ${unstage.length} File${unstage.length===1?'':'s'}`,`Unstage ${unstage.length} 个文件`),()=>{void state.execute({type:'unstage',paths:unstage});},'remove',busy));
    if(discard.length)items.push(action(t(`Discard ${discard.length} File${discard.length===1?'':'s'}…`,`Discard ${discard.length} 个文件…`),{type:'discard',paths:discard},'discard',busy));
    items.push(copy(paths.length===1?t('Copy Path','复制路径'):t(`Copy ${paths.length} Paths`,`复制 ${paths.length} 个路径`),paths.join('\n')));
    return {caption:paths.length===1?paths[0]:t(`${paths.length} Files`,`${paths.length} 个文件`),items};
  }
  if(target.kind==='ref') {
    const ref=target.ref,selected=target.refs?.length?target.refs:[ref];
    if(selected.length>1)return refBatch(selected,t(`${selected.length} Branches`,`${selected.length} 个分支`));
    const occupied=snapshot?.worktrees.find(w=>w.branch?.replace(/^refs\/heads\//,'')===ref.name&&!samePath(w.path,snapshot.repository.root));
    const commitTarget=ref.targetType===undefined||ref.targetType==='commit';
    const current=ref.kind==='local'&&ref.name===snapshot?.branch, noBranch=!snapshot?.branch, operation=!!snapshot?.operation.kind;
    const reason=current?t('This is the current branch.','这是当前分支。'):occupied?t(`Used by Worktree: ${occupied.path}`,`被 Worktree 使用：${occupied.path}`):undefined;
    const items:MenuItem[]=[];
    if(ref.kind==='local')items.push(action('Checkout…',{type:'branch.checkout',target:ref.name},'arrow-swap',busy||current||!!occupied,reason));
    if(ref.kind==='tag')items.push(item('Checkout…',()=>api.open({type:'commit.checkout',target:ref.fullName}),'arrow-swap',busy||operation||!commitTarget));
    items.push(item('Show in Graph',()=>state.setCheckedRefs([...(state.checkedRefs??[]),ref.fullName]),'eye',!commitTarget),item(ref.kind==='tag'?'Show Only This Tag':'Show Only This Branch',()=>state.setCheckedRefs([ref.fullName]),'filter',!commitTarget));
    items.push(action(ref.kind==='remote'?'Create Tracking Branch…':'Create Branch…',{type:'branch.create',target:ref.fullName},'git-branch',busy||!commitTarget));
    if(ref.kind==='local')items.push(action('Create Tag…',{type:'tag.create',target:ref.fullName},'tag'));
    if(ref.kind!=='tag')items.push(action('Merge…',{type:'merge',target:ref.fullName},'git-merge',busy||noBranch||current||operation),action('Rebase…',{type:'rebase',target:ref.fullName},'git-pull-request',busy||noBranch||current||operation));
    if(ref.kind==='local')items.push(action('Push…',{type:'push',branch:ref.name},'arrow-up'),action('Delete Branch…',{type:'branch.delete',target:ref.name,names:[ref.name],expectedOids:{[ref.name]:ref.oid}},'trash',busy||current||!!occupied,reason));
    if(ref.kind==='remote'){const parsed=remoteParts(ref);items.push(action(parsed?t(`Delete Branch from ${parsed.remote}…`,`从 ${parsed.remote} Delete 分支…`):'Delete Remote Branch…',{type:'remote.delete',remote:parsed?.remote,remoteBranches:parsed?[parsed.branch]:[],expectedOids:parsed?{[parsed.branch]:ref.oid}:undefined},'trash',busy||!parsed||!!ref.symbolicTarget,ref.symbolicTarget?t('Symbolic remote references cannot be deleted.','不能删除远端符号引用。'):undefined));}
    if(ref.kind==='tag')items.push(action('Delete Tag…',{type:'tag.delete',target:ref.name},'trash'),copy('Copy Tag Name',ref.name),item('Copy Commit ID',()=>api.host('copyText',{text:ref.oid}),'copy',!commitTarget,t('This Tag does not point to a Commit.','此 Tag 不指向 Commit。')));else items.push(copy('Copy Branch Name',ref.name));
    if(occupied)items.push(item('Open Worktree',()=>api.host('openWorktree',{path:occupied.path,newWindow:false}),'folder-opened'));
    return {caption:ref.name,items};
  }
  if(target.kind==='stash')return {caption:`${target.stash.selector} · ${target.stash.subject}`,items:[item('View Changes',()=>state.selectCommit(target.stash.oid,undefined,target.stash.oid),'diff'),action('Apply Stash',{type:'stash.apply',target:target.stash.selector,expectedOid:target.stash.oid},'unarchive'),action('Pop Stash',{type:'stash.apply',target:target.stash.selector,pop:true,expectedOid:target.stash.oid},'unarchive'),action('Drop Stash…',{type:'stash.drop',target:target.stash.selector,expectedOid:target.stash.oid},'trash')]};
  if(target.kind==='worktree') {
    const tree=target.worktree,disabled=busy||!!snapshot&&samePath(tree.path,snapshot.repository.root)||tree===snapshot?.worktrees[0]||!!tree.locked||tree.bare;
    return {caption:tree.path,items:[item('Open Worktree',()=>api.host('openWorktree',{path:tree.path,newWindow:false}),'folder-opened',tree.bare),item('Open in New Window',()=>api.host('openWorktree',{path:tree.path,newWindow:true}),'window',tree.bare),refresh,action('Remove Worktree…',{type:'worktree.remove',target:tree.path},'trash',disabled,tree.locked||t('The main or current Worktree cannot be removed.','主 Worktree 或当前 Worktree 无法移除。')),copy('Copy Worktree Path',tree.path)]};
  }
  const oid=target.oid,selected=[...new Set(target.oids?.length?target.oids:[oid])],ordered=cherryPickOrder(state.commits,selected),selectedCommits=ordered.map(id=>state.commits.find(commit=>commit.oid===id)).filter(Boolean),hasMerge=selectedCommits.some(commit=>(commit?.parents.length??0)>1),operationBlocked=busy||!snapshot?.branch||!!snapshot.operation.kind;
  const cherry=item(selected.length>1?`Cherry-pick ${selected.length} Commits to ${snapshot?.branch??'Detached HEAD'}`:`Cherry-pick to ${snapshot?.branch??'Detached HEAD'}`,()=>{void state.execute({type:'cherry-pick',commits:ordered,expectedHead:snapshot?.head,expectedBranch:snapshot?.branch||undefined});},'git-commit',operationBlocked||hasMerge,hasMerge?t('Select merge commits individually and choose their Mainline Parent.','请单独选择 Merge Commit 并指定 Mainline Parent。'):!snapshot?.branch?t('Cherry-pick requires a local branch.','Cherry-pick 需要当前处于本地分支。'):undefined);
  if(selected.length>1)return {caption:`${selected.length} Commits`,items:[...(selected.length===2?[item('Compare Commits',()=>{void state.compareCommits(selected[0],selected[1]);},'compare-changes')]:[]),cherry,copy('Copy Commit IDs',ordered.join('\n'))]};
  const commit=selectedCommits[0],items=[item('Checkout…',()=>api.checkout(oid),'arrow-swap',busy),action('Create Branch…',{type:'branch.create',target:oid},'git-branch'),action('Create Tag…',{type:'tag.create',target:oid},'tag'),action('Merge…',{type:'merge',target:oid},'git-merge',busy||!snapshot?.branch||!!snapshot.operation.kind),action('Rebase…',{type:'rebase',target:oid},'git-pull-request',busy||!snapshot?.branch||!!snapshot.operation.kind),(commit?.parents.length??0)>1?action('Cherry-pick Merge…',{type:'cherry-pick',target:oid},'git-commit',operationBlocked):cherry,action('Revert…',{type:'revert',target:oid},'discard'),action('Reset…',{type:'reset',target:oid},'history',busy||!snapshot?.branch||!!snapshot.operation.kind),copy('Copy Commit ID',oid),item('Copy Commit Message',async()=>{try{const details=await rpc<{body:string;commit:{subject:string}}>('details',state.repoId,{oid});await api.host('copyText',{text:details.body||details.commit.subject},state.repoId);}catch(error){state.report(error);}},'comment')];
  return {caption:`Commit ${oid.slice(0,8)}`,items};
}
