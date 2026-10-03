import { uiText } from './text';
import { translator } from '../src/i18n';
import type { DiffTarget, GitRef, Repository, RepositoryCollection, Stash, Worktree } from '../src/protocol/types';
import type { RepositoryGroup } from '../src/protocol/repositories';
import type { DialogRequest } from './ActionDialog';
import type { MenuItem } from './ContextMenu';
import { useWorkbench } from './store';
import { samePath } from './pathIdentity';
import { rpc } from './rpc';
import { showRemoteRequest } from './RemoteRequestDialog';
import { cherryPickOrder } from './commitSelection';
import type { CherryPickMenuCheck } from './useCherryPickCheck';

export interface FileMenuEntry { path: string; target: DiffTarget }
export type MenuTarget = { kind: 'repository'; group: RepositoryGroup; groups?:RepositoryGroup[] } | {kind:'repository-collection';collection:RepositoryCollection}| { kind: 'ref'; ref: GitRef; refs?:GitRef[] } | { kind: 'ref-folder'; label: string; refs: GitRef[] } | { kind: 'files'; primary: FileMenuEntry; files: FileMenuEntry[] } | { kind: 'commit'; oid: string; oids?: string[] } | { kind: 'stash'; stash: Stash } | { kind: 'worktree'; worktree: Worktree; worktrees?:Worktree[] } | { kind: 'remote'; name: string } | { kind: 'group'; group: 'repositories' | 'local' | 'remote' | 'tag' | 'stash' | 'worktree' };
export interface MenuApi { open(dialog: DialogRequest): void; checkout(oid: string): void; openDiff(target: DiffTarget): void; editFile(target: DiffTarget): void; host(method: 'copyText'|'openRepository'|'openWorktree'|'renameRepositoryCollection'|'deleteRepositoryCollection'|'moveRepositories', payload: unknown, repoId?: string):Promise<void>; addRepository():Promise<void>; removeRepositories(groups:RepositoryGroup[]):void; fetchRepositories(repositories:Repository[]):void }
export function menuFor(target: MenuTarget, api: MenuApi, check?: CherryPickMenuCheck): { caption: string; items: MenuItem[] } {
  const state=useWorkbench.getState(), snapshot=state.snapshot, busy=state.busy;
  const t=translator(state.language);
  const item=(label:string,run:MenuItem['run'],icon='circle-small',disabled=false,reason?:string):MenuItem=>({label,run,icon,disabled,reason});
  const preset=(entry:MenuItem,pressed:boolean):MenuItem=>({...entry,pressed});
  const action=(label:string,dialog:DialogRequest,icon='git-commit',disabled=busy,reason?:string)=>item(label,()=>api.open(dialog),icon,disabled,reason);
  const detachedReason=state.operationSettings.allowDetachedHead?undefined:t("actions.directDetachedHEADCheckoutIsDisabledCreateAndSwitch");
  const detachedCheckout=(target:string,disabled=false)=>action(t("menus.checkoutToDetachedHEAD"),{type:'commit.checkout',target},'debug-disconnect',busy||!!snapshot?.operation.kind||!state.operationSettings.allowDetachedHead||disabled,detachedReason);
  const refresh=item(t("common.refresh"),()=>{void state.refresh();},'refresh',busy);
  const track=(refs:GitRef[],batch=true)=>action(batch?t("menus.createLocalTrackingBranches"):t("menus.checkoutAsLocalBranch"),{type:'branch.track',sources:refs.filter(ref=>ref.kind==='remote'&&!ref.symbolicTarget&&(ref.targetType===undefined||ref.targetType==='commit')).map(ref=>ref.fullName),target:refs[0]?.fullName,batch,checkout:!batch},'git-branch',busy||!refs.some(ref=>ref.kind==='remote'&&!ref.symbolicTarget&&(ref.targetType===undefined||ref.targetType==='commit')));
  const copy=(label:string,text:string)=>item(label,()=>api.host('copyText',{text}),'copy');
  if(target.kind==='repository'){
    const groups=target.groups?.length?target.groups:[target.group],repositories=groups.map(group=>group.repository),paths=repositories.map(repository=>repository.root);
    if(groups.length>1)return {caption:t("menus.repositoriesSelected", { count: (groups.length) }),items:[item(t("menus.fetchRepositories", { count: (groups.length) }),()=>api.fetchRepositories(repositories),'cloud-download'),item(t("menus.refreshStatusForRepositories", { count: (groups.length) }),()=>state.loadRepositoryStatuses(),'refresh'),copy(t("menus.copyRepositoryPaths", { count: (groups.length) }),paths.join('\n')),item(t("menus.moveToRepositoryGroup"),()=>api.host('moveRepositories',{keys:groups.map(group=>group.key)}),'folder-opened'),item(t("menus.removeFromAlwayGit"),()=>api.removeRepositories(groups),'close')]};
    const repository=target.group.repository,current=target.group.members.some(member=>member.id===state.repoId);
    return {caption:target.group.name,items:[item(t("menus.switchToRepository"),()=>state.selectRepository(repository.id),'repo',current,current?t("menus.thisRepositoryIsAlreadyOpen"):undefined),item(t("menus.openInNewAlwayGitTab"),()=>api.host('openRepository',{newTab:true},repository.id),'split-horizontal'),item(t("menus.openRepositoryInNewProjectWindow"),()=>api.host('openRepository',{newWindow:true},repository.id),'window'),item(uiText("menus.fetch"),()=>api.fetchRepositories([repository]),'cloud-download'),item(t("menus.refreshStatus"),()=>state.loadRepositoryStatuses(),'refresh'),copy(t("menus.copyRepositoryPath"),repository.root),item(t("menus.moveToRepositoryGroup"),()=>api.host('moveRepositories',{keys:[target.group.key]}),'folder-opened'),item(t("menus.removeFromAlwayGit"),()=>api.removeRepositories([target.group]),'close')]};
  }
  if(target.kind==='repository-collection')return {caption:target.collection.name,items:[item(t("menus.renameRepositoryGroup"),()=>api.host('renameRepositoryCollection',{id:target.collection.id}),'edit'),item(t("menus.deleteRepositoryGroup"),()=>api.host('deleteRepositoryCollection',{id:target.collection.id}),'trash')]};
  if(target.kind==='group') {
    const name=target.group;
    const localRefs=snapshot?.refs.filter(ref=>ref.kind==='local')??[],localNames=localRefs.map(ref=>ref.fullName),current=localRefs.find(ref=>ref.name===snapshot?.branch),checked=state.checkedRefs??[],currentOnly=!!current&&checked.length===1&&checked[0]===current.fullName,allLocal=localNames.length>0&&!currentOnly&&localNames.every(ref=>checked.includes(ref));
    const items=name==='repositories'?[item(t("menus.add"),api.addRepository,'add'),item(t("common.refresh"),()=>state.initialize(),'refresh')]:name==='local'?[action(uiText("menus.createBranch"),{type:'branch.create'},'git-branch'),preset(item(t("menus.showAllLocalBranchesInGraph"),()=>state.setCheckedRefs([...checked,...localNames]),'eye',!localNames.length),allLocal),preset(item(t("menus.showCurrentBranchOnlyInGraph"),()=>state.setCheckedRefs(current?[current.fullName]:[]),'target',!current,t("menus.noCurrentLocalBranch")),currentOnly)]:name==='remote'?[action(t("menus.addRemote"),{type:'remote.add'},'add'),track(snapshot?.refs.filter(ref=>ref.kind==='remote')??[]),refresh]:name==='tag'?[action(uiText("menus.createTag"),{type:'tag.create'},'tag'),refresh]:name==='stash'?[action(uiText("menus.stashAllChanges"),{type:'stash.create'},'archive',busy||!snapshot?.changes.length||!!snapshot.operation.kind),refresh]:name==='worktree'?[action(uiText("menus.addWorktree"),{type:'worktree.add'},'new-folder'),refresh]:[refresh];
    return {caption:{repositories:t("menus.repositories"),local:t("menus.localBranches"),remote:t("menus.remotes"),tag:uiText("menus.tags"),stash:uiText("menus.stashes"),worktree:uiText("menus.worktrees")}[name],items};
  }
  if(target.kind==='remote')return {caption:target.name,items:[action(uiText("menus.fetch"),{type:'fetch',remote:target.name},'cloud-download'),track(snapshot?.refs.filter(ref=>ref.kind==='remote'&&ref.name.startsWith(`${target.name}/`))??[]),refresh]};
  const remoteParts=(ref:GitRef)=>{const remote=(snapshot?.remotes??[]).slice().sort((a,b)=>b.length-a.length).find(name=>ref.name.startsWith(`${name}/`));return remote?{remote,branch:ref.name.slice(remote.length+1)}:undefined;};
  const refBatch=(refs:GitRef[],caption:string)=>{
    const graphRefs=refs.filter(ref=>ref.targetType===undefined||ref.targetType==='commit'),names=graphRefs.map(ref=>ref.fullName),allLocal=refs.length>0&&refs.every(ref=>ref.kind==='local'),allRemote=refs.length>0&&refs.every(ref=>ref.kind==='remote'),allTags=refs.length>0&&refs.every(ref=>ref.kind==='tag'),current=refs.find(ref=>ref.kind==='local'&&ref.name===snapshot?.branch),occupied=refs.find(ref=>ref.kind==='local'&&snapshot?.worktrees.some(tree=>tree.branch?.replace(/^refs\/heads\//,'')===ref.name&&!samePath(tree.path,snapshot.repository.root))),blocked=current?t("menus.theCurrentBranchIsSelected"):occupied?t("menus.usedByAnotherWorktree", { name: (occupied.name) }):undefined;
    const items:MenuItem[]=[item(t("menus.showSelectedInGraph"),()=>state.setCheckedRefs([...(state.checkedRefs??[]),...names]),'eye',!graphRefs.length),item(t("menus.showOnlySelected"),()=>state.setCheckedRefs(names),'filter',!graphRefs.length),item(t("menus.hideSelectedFromGraph"),()=>state.setCheckedRefs((state.checkedRefs??[]).filter(name=>!names.includes(name))),'eye-closed',!graphRefs.length)];
    if(allLocal)items.push(action(t("menus.deleteLocalBranches", { count: (refs.length) }),{type:'branch.delete',names:refs.map(ref=>ref.name),expectedOids:Object.fromEntries(refs.map(ref=>[ref.name,ref.oid]))},'trash',busy||!!blocked,blocked));
    if(allRemote){const parsed=refs.map(remoteParts),remote=parsed[0]?.remote,sameRemote=!!remote&&parsed.every(value=>value?.remote===remote),symbolic=refs.some(ref=>!!ref.symbolicTarget),branches=parsed.map(value=>value?.branch).filter((branch):branch is string=>!!branch);items.push(action(remote?t("menus.deleteBranchesFrom", { count: (branches.length), remote: (remote) }):t("menus.deleteRemoteBranches"),{type:'remote.delete',remote,expectedDestination:remote?snapshot?.remoteDestinations?.[remote]:undefined,remoteBranches:branches,expectedOids:Object.fromEntries(refs.flatMap((ref,index)=>parsed[index]?.branch?[[parsed[index]!.branch,ref.oid]]:[]))},'trash',busy||!sameRemote||symbolic,symbolic?t("menus.symbolicRemoteReferencesCannotBeDeleted"):!sameRemote?t("menus.selectBranchesFromOneRemote"):undefined));items.unshift(track(refs));}
    if(allTags){const identities=Object.fromEntries(refs.flatMap(ref=>ref.refOid?[[ref.name,ref.refOid]]:[])),missing=refs.some(ref=>!ref.refOid);items.push(action(t("menus.pushTags",{count:refs.length}),{type:'tag.push',names:refs.map(ref=>ref.name),expectedOids:identities},'cloud-upload',busy||missing,missing?t("menus.refreshToCaptureTagsBeforePush"):undefined));}
    items.push(copy(allTags?t("menus.copyTagNames"):allLocal||allRemote?t("menus.copyBranchNames"):t("menus.copyReferenceNames"),refs.map(ref=>ref.name).join('\n')));
    return {caption,items};
  };
  if(target.kind==='ref-folder')return refBatch(target.refs,`${target.label} · ${target.refs.length} ${t("menus.branches")}`);
  if(target.kind==='files') {
    const unique=[...new Map(target.files.map(file=>[`${file.target.kind}:${file.path}:${'area' in file.target?file.target.area:''}`,file])).values()],paths=[...new Set(unique.map(file=>file.path))];
    const changes=unique.filter((file):file is FileMenuEntry & {target:Extract<DiffTarget,{kind:'change'}>}=>file.target.kind==='change'),stage=changes.filter(file=>file.target.area!=='staged').map(file=>file.path),unstage=changes.filter(file=>file.target.area==='staged').map(file=>file.path),discard=changes.filter(file=>file.target.area==='unstaged').map(file=>file.path),conflicts=changes.filter(file=>file.target.area==='conflict').map(file=>file.path);
    const items:MenuItem[]=[];
    if(unique.length===1)items.push(item(t("menus.openDiffInVSCode"),()=>api.openDiff(target.primary.target),'diff'),item(t("menus.editInVSCode"),()=>api.editFile(target.primary.target),'edit'));
    const ordinary=stage.filter(path=>!conflicts.includes(path));
    if(conflicts.length)items.push(item(t("menus.manuallyHandledMarkStage", { count: (conflicts.length) }),()=>{void state.execute({type:'resolve-and-stage',paths:conflicts});},'add',busy));
    if(ordinary.length)items.push(item(t("menus.stageFiles", { count: (ordinary.length) }),()=>{void state.execute({type:'stage',paths:ordinary});},'add',busy));
    if(unstage.length)items.push(item(t("menus.unstageFiles", { count: (unstage.length) }),()=>{void state.execute({type:'unstage',paths:unstage});},'remove',busy));
    const stashPaths=[...new Set(changes.filter(file=>file.target.area!=='conflict').map(file=>file.path))];
    if(stashPaths.length)items.push(action(t("menus.stashSelectedFiles"),{type:'stash.create',paths:stashPaths},'archive',busy||!!snapshot?.operation.kind||!!snapshot?.operation.conflicts));
    if(discard.length)items.push(action(t("menus.discardFiles", { count: (discard.length) }),{type:'discard',paths:discard},'discard',busy));
    items.push(copy(paths.length===1?t("menus.copyPath"):t("menus.copyPaths", { count: (paths.length) }),paths.join('\n')));
    return {caption:paths.length===1?paths[0]:t("menus.files", { count: (paths.length) }),items};
  }
  if(target.kind==='ref') {
    const ref=target.ref,selected=target.refs?.length?target.refs:[ref];
    if(selected.length>1){const allTags=selected.every(item=>item.kind==='tag'),allBranches=selected.every(item=>item.kind!=='tag');return refBatch(selected,allTags?t("menus.tagsSelected",{count:selected.length}):allBranches?t("menus.branchesVariant2", { count: (selected.length) }):t("menus.referencesSelected",{count:selected.length}));}
    const occupied=snapshot?.worktrees.find(w=>w.branch?.replace(/^refs\/heads\//,'')===ref.name&&!samePath(w.path,snapshot.repository.root));
    const commitTarget=ref.targetType===undefined||ref.targetType==='commit';
    const current=ref.kind==='local'&&ref.name===snapshot?.branch, noBranch=!snapshot?.branch, operation=!!snapshot?.operation.kind;
    const reason=current?t("menus.thisIsTheCurrentBranch"):occupied?t("menus.usedByWorktree", { path: (occupied.path) }):undefined;
    const items:MenuItem[]=[];
    if(ref.kind==='local')items.push(action(uiText("menus.switchToBranch"),{type:'branch.checkout',target:ref.name},'arrow-swap',busy||current||!!occupied,reason));
    if(ref.kind==='tag') {
      items.push(action(t("menus.createBranchAndCheckout"),{type:'branch.create',target:ref.fullName,checkout:true,requireCheckout:true},'arrow-swap',busy||operation||!commitTarget));
      items.push(detachedCheckout(ref.fullName,!commitTarget));
    }
    items.push(item(uiText("menus.showInGraph"),()=>state.setCheckedRefs([...(state.checkedRefs??[]),ref.fullName]),'eye',!commitTarget),item(ref.kind==='tag'?uiText("menus.showOnlyThisTag"):uiText("menus.showOnlyThisBranch"),()=>state.setCheckedRefs([ref.fullName]),'filter',!commitTarget));
    items.push(ref.kind==='remote'?track([ref],false):action(uiText("menus.createBranch"),{type:'branch.create',target:ref.fullName},'git-branch',busy||!commitTarget));
    if(ref.kind==='local')items.push(action(uiText("menus.createTag"),{type:'tag.create',target:ref.fullName},'tag'));
    if(ref.kind!=='tag')items.push(action(uiText("menus.merge"),{type:'merge',target:ref.fullName},'git-merge',busy||noBranch||current||operation),action(uiText("menus.rebase"),{type:'rebase',target:ref.fullName},'git-pull-request',busy||noBranch||current||operation));
    if(ref.kind==='local')items.push(action(uiText("menus.push"),{type:'push',branch:ref.name},'arrow-up'),action(uiText("menus.deleteBranch"),{type:'branch.delete',target:ref.name,names:[ref.name],expectedOids:{[ref.name]:ref.oid}},'trash',busy||current||!!occupied,reason));
    if(ref.kind==='remote'){const parsed=remoteParts(ref);items.push(action(parsed?t("menus.deleteBranchFrom", { remote: (parsed.remote) }):uiText("menus.deleteRemoteBranch"),{type:'remote.delete',remote:parsed?.remote,expectedDestination:parsed?snapshot?.remoteDestinations?.[parsed.remote]:undefined,remoteBranches:parsed?[parsed.branch]:[],expectedOids:parsed?{[parsed.branch]:ref.oid}:undefined},'trash',busy||!parsed||!!ref.symbolicTarget,ref.symbolicTarget?t("menus.symbolicRemoteReferencesCannotBeDeleted"):undefined));}
    if(ref.kind==='tag')items.push(action(t("menus.pushTag"),{type:'tag.push',names:[ref.name],expectedOids:ref.refOid?{[ref.name]:ref.refOid}:{}},'cloud-upload',busy||!ref.refOid,!ref.refOid?t("menus.refreshToCaptureThisTagBeforePush"):undefined),action(uiText("menus.deleteTag"),{type:'tag.delete',target:ref.name,expectedOid:ref.refOid},'trash',busy||!ref.refOid,!ref.refOid?t("menus.refreshToCaptureThisTagBeforeDeletion"):undefined),copy(uiText("menus.copyTagName"),ref.name),item(uiText("menus.copyCommitID"),()=>api.host('copyText',{text:ref.oid}),'copy',!commitTarget,t("menus.thisTagDoesNotPointToACommit")));else items.push(copy(uiText("menus.copyBranchName"),ref.name));
    if(occupied)items.push(item(uiText("menus.openWorktree"),()=>api.host('openWorktree',{path:occupied.path,newWindow:false}),'folder-opened'));
    if (ref.kind === 'local' && ref.upstream) {
      const parsed = remoteParts({ ...ref, kind: 'remote', name: ref.upstream, fullName: `refs/remotes/${ref.upstream}` });
      if (parsed && state.repoId) items.push(item(t('feedback.createRemoteRequest'), () => void showRemoteRequest(state.repoId!, parsed.branch, undefined, parsed.remote, ref.name), 'git-pull-request', busy));
    }
    if (ref.kind === 'remote' && !ref.symbolicTarget && state.repoId) {
      const parsed = remoteParts(ref);
      if (parsed) items.push(item(t('feedback.createRemoteRequest'), () => void showRemoteRequest(state.repoId!, parsed.branch, undefined, parsed.remote), 'git-pull-request', busy));
    }
    return {caption:ref.name,items};
  }
  if(target.kind==='stash')return {caption:`${target.stash.selector} · ${target.stash.subject}`,items:[item(uiText("menus.viewChanges"),()=>state.selectCommit(target.stash.oid,undefined,target.stash.oid),'diff'),action(uiText("menus.applyStash"),{type:'stash.apply',target:target.stash.selector,expectedOid:target.stash.oid},'unarchive'),action(uiText("menus.popStash"),{type:'stash.apply',target:target.stash.selector,pop:true,expectedOid:target.stash.oid},'unarchive'),action(uiText("menus.dropStash"),{type:'stash.drop',target:target.stash.selector,expectedOid:target.stash.oid},'trash')]};
  if(target.kind==='worktree') {
    const trees=target.worktrees?.length?target.worktrees:[target.worktree];
    if(trees.length>1)return {caption:t("menus.worktreesSelected", { count: (trees.length) }),items:[refresh,copy(t("menus.copyWorktreePaths", { count: (trees.length) }),trees.map(tree=>tree.path).join('\n'))]};
    const tree=target.worktree,disabled=busy||!!snapshot&&samePath(tree.path,snapshot.repository.root)||tree===snapshot?.worktrees[0]||!!tree.locked||tree.bare;
    return {caption:tree.path,items:[item(uiText("menus.openWorktree"),()=>api.host('openWorktree',{path:tree.path,newWindow:false}),'folder-opened',tree.bare),item(uiText("menus.openWorktreeInNewProjectWindow"),()=>api.host('openWorktree',{path:tree.path,newWindow:true}),'window',tree.bare),refresh,action(uiText("menus.removeWorktree"),{type:'worktree.remove',target:tree.path},'trash',disabled,tree.locked||t("menus.theMainOrCurrentWorktreeCannotBeRemoved")),copy(uiText("menus.copyWorktreePath"),tree.path)]};
  }
  const oid=target.oid,selected=[...new Set(target.oids?.length?target.oids:[oid])],ordered=cherryPickOrder(state.commits,selected),selectedCommits=ordered.map(id=>state.commits.find(commit=>commit.oid===id)).filter(Boolean),hasMerge=selectedCommits.some(commit=>(commit?.parents.length??0)>1),operationBlocked=busy||!snapshot?.branch||!!snapshot.operation.kind;
  const atHead=!!snapshot?.head&&selected.includes(snapshot.head),included=check?.included.length??0,selectionMissing=selectedCommits.length!==selected.length;
  const eligibilityReason=!snapshot?.branch?uiText('menus.cherryPickRequiresALocalBranch'):atHead?uiText('menus.cherryPickCurrentHead'):selectionMissing?uiText('menus.cherryPickSelectionChanged'):check?.failed?uiText('menus.cherryPickCheckFailed'):!check?uiText('menus.cherryPickChecking'):included?uiText('menus.cherryPickAlreadyIncluded'):undefined;
  const cherryBlocked=operationBlocked||!!eligibilityReason;
  const reapply=included&&!atHead&&!selectionMissing&&!check?.failed?action(uiText('menus.cherryPickReapply'),{type:'cherry-pick',target:ordered.join(' '),reapply:true},'history',operationBlocked||selected.length>1&&hasMerge):undefined;
  const cherry=item(selected.length>1?uiText("menus.cherryPickCommitsTo", { count: (selected.length), value: (snapshot?.branch??uiText("menus.detachedHEAD")) }):uiText("menus.cherryPickTo", { value: (snapshot?.branch??uiText("menus.detachedHEAD")) }),()=>{void state.execute({type:'cherry-pick',commits:ordered,expectedHead:snapshot?.head,expectedBranch:snapshot?.branch||undefined});},'git-commit',cherryBlocked||hasMerge,eligibilityReason??(hasMerge?t("menus.selectMergeCommitsIndividuallyAndChooseTheirMainlineParent"):!snapshot?.branch?t("menus.cherryPickRequiresALocalBranch"):undefined));
  if(selected.length>1)return {caption:uiText("menus.commits", { count: (selected.length) }),items:[...(selected.length===2?[item(uiText("menus.compareCommits"),()=>{void state.compareCommits(selected[0],selected[1]);},'compare-changes')]:[]),cherry,...(reapply?[reapply]:[]),copy(uiText("menus.copyCommitIDs"),ordered.join('\n'))]};
  const branches=snapshot?.refs.filter(ref=>ref.kind==='local'&&ref.oid===oid)??[],branch=branches.length===1?branches[0]:undefined;
  const current=!!branch&&branch.name===snapshot?.branch,occupied=branch&&snapshot?.worktrees.find(tree=>tree.branch?.replace(/^refs\/heads\//,'')===branch.name&&!samePath(tree.path,snapshot.repository.root));
  const checkout=branches.length?item(branch?t("menus.switchToNamedBranch",{name:branch.name}):t("menus.chooseBranchToCheckout"),()=>api.checkout(oid),'arrow-swap',busy||!!snapshot?.operation.kind||current||!!occupied,current?t("menus.thisIsTheCurrentBranch"):occupied?t("menus.usedByWorktree",{path:occupied.path}):undefined):detachedCheckout(oid);
  const createBranch=branches.length?action(uiText("menus.createBranch"),{type:'branch.create',target:oid},'git-branch'):action(t("menus.createBranchAndCheckout"),{type:'branch.create',target:oid,checkout:true,requireCheckout:true},'git-branch');
  const commit=selectedCommits[0],items=[checkout,createBranch,action(uiText("menus.createTag"),{type:'tag.create',target:oid},'tag'),action(uiText("menus.merge"),{type:'merge',target:oid},'git-merge',busy||!snapshot?.branch||!!snapshot.operation.kind),action(uiText("menus.rebase"),{type:'rebase',target:oid},'git-pull-request',busy||!snapshot?.branch||!!snapshot.operation.kind),(commit?.parents.length??0)>1?action(uiText("menus.cherryPickMerge"),{type:'cherry-pick',target:oid},'git-commit',cherryBlocked,eligibilityReason):cherry,...(reapply?[reapply]:[]),action(uiText("menus.revert"),{type:'revert',target:oid},'discard'),action(uiText("menus.reset"),{type:'reset',target:oid},'history',busy||!snapshot?.branch||!!snapshot.operation.kind),copy(uiText("menus.copyCommitID"),oid),item(uiText("menus.copyCommitMessage"),async()=>{try{const details=await rpc<{body:string;commit:{subject:string}}>('details',state.repoId,{oid});await api.host('copyText',{text:details.body||details.commit.subject},state.repoId);}catch(error){state.report(error);}},'comment')];
  if(branches.length&&state.operationSettings.allowDetachedHead)items.splice(1,0,detachedCheckout(oid));
  return {caption:uiText("menus.commit", { value: (oid.slice(0,8)) }),items};
}
