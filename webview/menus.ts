import type { GitRef, Repository, Stash, Worktree } from '../src/protocol/types';
import type { DialogRequest } from './ActionDialog';
import type { MenuItem } from './ContextMenu';
import { useWorkbench } from './store';
import { samePath } from './pathIdentity';
import { rpc } from './rpc';

export type MenuTarget = { kind: 'repository'; repository: Repository } | { kind: 'ref'; ref: GitRef } | { kind: 'commit'; oid: string } | { kind: 'stash'; stash: Stash } | { kind: 'worktree'; worktree: Worktree } | { kind: 'remote'; name: string } | { kind: 'group'; group: 'repositories' | 'local' | 'remote' | 'tag' | 'stash' | 'worktree' };
export interface MenuApi { open(dialog: DialogRequest): void; checkout(oid: string): void; host(method: 'copyText'|'openRepository'|'openWorktree', payload: unknown, repoId?: string): Promise<void>; addRepository(): Promise<void>; fetchRepository(repoId: string): Promise<void> }
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
    const items=name==='repositories'?[item('Add Repository…',api.addRepository,'add'),item(t('Refresh','刷新'),()=>state.initialize(),'refresh')]:name==='local'?[action('Create Branch…',{type:'branch.create'},'git-branch'),item(t('Select All','全选'),()=>state.setCheckedRefs([...(state.checkedRefs??[]),...(snapshot?.refs.filter(r=>r.kind==='local').map(r=>r.fullName)??[])]),'check-all'),item(t('Clear Selection','取消选择'),()=>state.setCheckedRefs((state.checkedRefs??[]).filter(r=>!r.startsWith('refs/heads/'))),'clear-all')]:name==='tag'?[action('Create Tag…',{type:'tag.create'},'tag'),refresh]:name==='stash'?[action('Stash Changes…',{type:'stash.create'},'archive',busy||!snapshot?.changes.length||!!snapshot.operation.kind),refresh]:name==='worktree'?[action('Add Worktree…',{type:'worktree.add'},'new-folder'),refresh]:[action('Fetch…',{type:'fetch'},'cloud-download'),refresh];
    return {caption:{repositories:t('Repositories','仓库'),local:t('Local Branches','本地分支'),remote:t('Remotes','远端'),tag:'Tags',stash:'Stashes',worktree:'Worktrees'}[name],items};
  }
  if(target.kind==='remote')return {caption:target.name,items:[action('Fetch…',{type:'fetch',remote:target.name},'cloud-download'),refresh]};
  if(target.kind==='ref') {
    const ref=target.ref, occupied=snapshot?.worktrees.find(w=>w.branch?.replace(/^refs\/heads\//,'')===ref.name&&!samePath(w.path,snapshot.repository.root));
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
    if(ref.kind==='local')items.push(action('Push…',{type:'push',branch:ref.name},'arrow-up'),action('Delete Branch…',{type:'branch.delete',target:ref.name},'trash',busy||current||!!occupied,reason));
    if(ref.kind==='tag')items.push(action('Delete Tag…',{type:'tag.delete',target:ref.name},'trash'),copy('Copy Tag Name',ref.name),item('Copy Commit ID',()=>api.host('copyText',{text:ref.oid}),'copy',!commitTarget,t('This Tag does not point to a Commit.','此 Tag 不指向 Commit。')));else items.push(copy('Copy Branch Name',ref.name));
    if(occupied)items.push(item('Open Worktree',()=>api.host('openWorktree',{path:occupied.path,newWindow:false}),'folder-opened'));
    return {caption:ref.name,items};
  }
  if(target.kind==='stash')return {caption:`${target.stash.selector} · ${target.stash.subject}`,items:[item('View Changes',()=>state.selectCommit(target.stash.oid,undefined,target.stash.oid),'diff'),action('Apply Stash',{type:'stash.apply',target:target.stash.selector,expectedOid:target.stash.oid},'unarchive'),action('Pop Stash',{type:'stash.apply',target:target.stash.selector,pop:true,expectedOid:target.stash.oid},'unarchive'),action('Drop Stash…',{type:'stash.drop',target:target.stash.selector,expectedOid:target.stash.oid},'trash')]};
  if(target.kind==='worktree') {
    const tree=target.worktree,disabled=busy||!!snapshot&&samePath(tree.path,snapshot.repository.root)||tree===snapshot?.worktrees[0]||!!tree.locked||tree.bare;
    return {caption:tree.path,items:[item('Open Worktree',()=>api.host('openWorktree',{path:tree.path,newWindow:false}),'folder-opened',tree.bare),item('Open in New Window',()=>api.host('openWorktree',{path:tree.path,newWindow:true}),'window',tree.bare),refresh,action('Remove Worktree…',{type:'worktree.remove',target:tree.path},'trash',disabled,tree.locked||t('The main or current Worktree cannot be removed.','主 Worktree 或当前 Worktree 无法移除。')),copy('Copy Worktree Path',tree.path)]};
  }
  const oid=target.oid,items=[item('Checkout…',()=>api.checkout(oid),'arrow-swap',busy),action('Create Branch…',{type:'branch.create',target:oid},'git-branch'),action('Create Tag…',{type:'tag.create',target:oid},'tag'),action('Merge…',{type:'merge',target:oid},'git-merge',busy||!snapshot?.branch||!!snapshot.operation.kind),action('Rebase…',{type:'rebase',target:oid},'git-pull-request',busy||!snapshot?.branch||!!snapshot.operation.kind),action('Cherry-pick…',{type:'cherry-pick',target:oid},'git-commit'),action('Revert…',{type:'revert',target:oid},'discard'),action('Reset…',{type:'reset',target:oid},'history',busy||!snapshot?.branch||!!snapshot.operation.kind),copy('Copy Commit ID',oid),item('Copy Commit Message',async()=>{try{const details=await rpc<{body:string;commit:{subject:string}}>('details',state.repoId,{oid});await api.host('copyText',{text:details.body||details.commit.subject},state.repoId);}catch(error){state.report(error);}},'comment')];
  return {caption:`Commit ${oid.slice(0,8)}`,items};
}
