import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { GitRef } from '../src/protocol/types';
import type { MenuTarget } from './menus';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { Button, Icon } from './ui';
import { samePath } from './pathIdentity';
import { buildRefTree, refsUnder, visibleRefs, type RefTreeNode } from './refTree';
import { groupRepositories, type RepositoryGroup } from '../src/protocol/repositories';
import { selectionForClick } from './commitSelection';
import { collectionOrderKey, repositoryOrderKey } from '../src/protocol/repository-order';
import type { MenuItem } from './ContextMenu';
import { handleSelectionKeyboard } from './selectionKeyboard';
import { repositoryDisplayEntries, visibleRepositoryKeys, repositoryCollectionGroups } from './repositoryOrder';

export type ContextHandler = (event: React.MouseEvent | React.KeyboardEvent, target: MenuTarget) => void;
export type SidebarActionProvider = (target: MenuTarget) => MenuItem[];
type Group = Extract<MenuTarget,{kind:'group'}>['group'];

function SidebarActions({items,className='',label}:{items:MenuItem[];className?:string;label?:string}) {
  return <div className={`sidebar-actions ${className}`.trim()} role={label?'group':undefined} aria-label={label}>{items.map(item=>{const hint=item.disabled&&item.reason?`${item.label} — ${item.reason}`:item.label;return <Button key={item.label} className="icon-only sidebar-action" icon={item.icon??'circle-small'} title={hint} aria-label={item.label} aria-pressed={item.pressed} disabled={item.disabled} onClick={()=>void item.run()}/>;})}</div>;
}

function CurrentIndicator({current}:{current:boolean}) {
  return <span className="current-indicator" aria-hidden="true">{current&&<span className="current-indicator-glyph"/>}</span>;
}

function TreeCheckbox({label,checked,mixed,onChange}:{label:string;checked:boolean;mixed:boolean;onChange(checked:boolean):void}) {
  const element=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(element.current)element.current.indeterminate=mixed;},[mixed]);
  return <label className="branch-check"><input ref={element} type="checkbox" aria-label={label} checked={checked} onChange={event=>onChange(event.target.checked)}/></label>;
}

function BranchLeaf({refItem,depth,order,context,checkoutBranch}:{refItem:GitRef;depth:number;order:GitRef[];context:ContextHandler;checkoutBranch(name:string,remote?:boolean):void}) {
  const state=useWorkbench(),current=refItem.kind==='local'&&refItem.name===state.snapshot?.branch,selected=state.selectedRefs.includes(refItem.fullName);
  const choose=(event:React.MouseEvent|React.KeyboardEvent)=>{const names=order.map(ref=>ref.fullName),existing=state.selectedRefs.filter(name=>names.includes(name)),next=selectionForClick(names,existing,state.refSelectionAnchor,refItem.fullName,{toggle:event.ctrlKey||event.metaKey,range:event.shiftKey});state.setRefSelection(next.selected,next.anchor);void state.selectCommit(refItem.oid);};
  const openContext=(event:React.MouseEvent|React.KeyboardEvent)=>{const refs=selected?order.filter(ref=>state.selectedRefs.includes(ref.fullName)):[refItem];if(!selected)state.setRefSelection([refItem.fullName],refItem.fullName);context(event,{kind:'ref',ref:refItem,refs});};
  return <div className={`ref-row tree-row ${selected?'action-selected':''}`} style={{'--tree-depth':depth} as React.CSSProperties} onContextMenu={event=>{event.currentTarget.querySelector<HTMLButtonElement>('.ref-item')?.focus({preventScroll:true});openContext(event);}} role="treeitem" aria-selected={selected}>
    <span className="tree-spacer"/>{refItem.kind!=='tag'&&<TreeCheckbox label={`Show branch ${refItem.name}`} checked={state.checkedRefs?.includes(refItem.fullName)??false} mixed={false} onChange={checked=>state.setCheckedRefs(checked?[...(state.checkedRefs??[]),refItem.fullName]:(state.checkedRefs??[]).filter(name=>name!==refItem.fullName))}/>}
    <button className="sidebar-item ref-item" aria-label={`Branch ${refItem.name}`} aria-current={current?'true':undefined} title={`${refItem.fullName}${current?' · HEAD':''}`} onClick={choose} onDoubleClick={()=>{if(refItem.kind==='local')checkoutBranch(refItem.name);else if(refItem.kind==='remote')checkoutBranch(refItem.fullName,true);}} onKeyDown={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();openContext(event);}}}><CurrentIndicator current={current}/><Icon name={refItem.kind==='remote'?'cloud':'git-branch'}/><span className="truncate">{refItem.name.split('/').at(-1)}</span></button>
  </div>;
}

function BranchNode({node,depth,order,context,checkoutBranch}:{node:RefTreeNode;depth:number;order:GitRef[];context:ContextHandler;checkoutBranch(name:string,remote?:boolean):void}) {
  const state=useWorkbench(),t=useTranslation(),hasChildren=node.children.length>0;
  if(!hasChildren&&node.ref)return <BranchLeaf refItem={node.ref} depth={depth} order={order} context={context} checkoutBranch={checkoutBranch}/>;
  const refs=refsUnder(node),selected=refs.filter(ref=>state.checkedRefs?.includes(ref.fullName)).length,expanded=state.expandedRefGroups?.includes(node.key)??false;
  const update=(checked:boolean)=>{const names=new Set(state.checkedRefs??[]);for(const ref of refs)checked?names.add(ref.fullName):names.delete(ref.fullName);state.setCheckedRefs([...names]);};
  return <div className="tree-node" role="treeitem" aria-expanded={expanded}>
    <div className="tree-folder tree-row" style={{'--tree-depth':depth} as React.CSSProperties} onContextMenu={event=>{event.currentTarget.querySelector<HTMLButtonElement>('.tree-folder-name')?.focus({preventScroll:true});state.setRefSelection(refs.map(ref=>ref.fullName),refs[0]?.fullName);context(event,{kind:'ref-folder',label:node.label,refs});}}>
      <button type="button" className="tree-chevron" aria-label={`${expanded?t('Collapse','收起'):t('Expand','展开')} ${node.label}`} onClick={()=>state.setExpandedRefGroup(node.key,!expanded)}><Icon name={expanded?'chevron-down':'chevron-right'}/></button>
      <TreeCheckbox label={`Show branch group ${node.label}`} checked={selected===refs.length&&refs.length>0} mixed={selected>0&&selected<refs.length} onChange={update}/>
      <button type="button" className="tree-folder-name" onClick={()=>state.setExpandedRefGroup(node.key,!expanded)}><CurrentIndicator current={false}/><Icon name={expanded?'folder-opened':'folder'}/><span className="truncate">{node.label}</span><span className="tree-count">{selected}/{refs.length}</span></button>
    </div>
    {expanded&&<div role="group">{node.ref&&<BranchLeaf refItem={node.ref} depth={depth+1} order={order} context={context} checkoutBranch={checkoutBranch}/>} {node.children.map(child=><BranchNode key={child.key} node={child} depth={depth+1} order={order} context={context} checkoutBranch={checkoutBranch}/>)}</div>}
  </div>;
}

function BranchTree({refs,keyPrefix,stripPrefix='',context,checkoutBranch}:{refs:GitRef[];keyPrefix:string;stripPrefix?:string;context:ContextHandler;checkoutBranch(name:string,remote?:boolean):void}) {
  const state=useWorkbench(),nodes=buildRefTree(refs,keyPrefix,stripPrefix),order=visibleRefs(nodes,state.expandedRefGroups??[]);
  return <div className="branch-tree" data-ref-kind={refs[0]?.kind} data-selection-scope={keyPrefix} tabIndex={0} role="tree" aria-multiselectable="true">{nodes.map(node=><BranchNode key={node.key} node={node} depth={0} order={order} context={context} checkoutBranch={checkoutBranch}/>)}</div>;
}

export function Sidebar({ context, actions, checkoutBranch, openWorktree }: { context: ContextHandler; actions:SidebarActionProvider; checkoutBranch(name:string,remote?:boolean):void; openWorktree(path:string):void }) {
  const state=useWorkbench(),snapshot=state.snapshot,t=useTranslation();
  const [worktreeSelection,setWorktreeSelection]=useState<{repoId?:string;paths:string[];anchor?:string}>({paths:[]});
  const [collapsedRepositoryCollections,setCollapsedRepositoryCollections]=useState<string[]>([]);
  const dragging=useRef<{key:string;parent?:string}>(undefined),[dropTarget,setDropTarget]=useState<{key:string;position:'before'|'after'}>(),[ordering,setOrdering]=useState(false);
  const dragProps=(key:string,parent?:string)=>({
    draggable:!ordering,
    'data-repository-order-key':key,
    'data-drop-position':dropTarget?.key===key?dropTarget.position:undefined,
    onDragStart:(event:React.DragEvent<HTMLButtonElement>)=>{dragging.current={key,parent};event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',key);},
    onDragEnd:()=>{dragging.current=undefined;setDropTarget(undefined);},
    onDragOver:(event:React.DragEvent<HTMLButtonElement>)=>{const source=dragging.current;if(!source||source.parent!==parent||source.key===key){setDropTarget(undefined);return;}event.preventDefault();event.dataTransfer.dropEffect='move';const bounds=event.currentTarget.getBoundingClientRect();setDropTarget({key,position:event.clientY<bounds.top+bounds.height/2?'before':'after'});},
    onDrop:(event:React.DragEvent<HTMLButtonElement>)=>{const source=dragging.current;if(!source||source.parent!==parent||source.key===key)return;event.preventDefault();const bounds=event.currentTarget.getBoundingClientRect(),position=event.clientY<bounds.top+bounds.height/2?'before':'after';dragging.current=undefined;setDropTarget(undefined);setOrdering(true);void state.reorderRepository({key:source.key,targetKey:key,position}).finally(()=>setOrdering(false));},
  });
  const groupOpen=(key:string)=>!state.collapsedSidebarGroups.includes(key);
  const local=snapshot?.refs.filter(ref=>ref.kind==='local')??[],remoteRefs=snapshot?.refs.filter(ref=>ref.kind==='remote')??[],tags=snapshot?.refs.filter(ref=>ref.kind==='tag')??[];
  const remotes=snapshot?.remotes??[...new Set(remoteRefs.map(ref=>ref.name.split('/')[0]))];
  const repositoryGroups=groupRepositories(state.repositories,state.repoId);
  const repositoryEntries=repositoryDisplayEntries(repositoryGroups,state.repositoryCollections,state.repositoryOrder);
  const repositorySelectionOrder=visibleRepositoryKeys(repositoryEntries,repositoryGroups,collapsedRepositoryCollections,state.repositoryOrder);
  const worktrees=snapshot?.worktrees??[],worktreePaths=worktrees.map(tree=>tree.path),selectedWorktreePaths=worktreeSelection.repoId===state.repoId?worktreeSelection.paths.filter(path=>worktreePaths.includes(path)):[],worktreeAnchor=worktreeSelection.repoId===state.repoId&&worktreePaths.includes(worktreeSelection.anchor??'')?worktreeSelection.anchor:undefined;
  const graphPresets=snapshot?actions({kind:'group',group:'local'}).filter(item=>item.pressed!==undefined):[];
  const remoteActions=snapshot?actions({kind:'group',group:'remote'}):[],addRemote=remoteActions.find(item=>item.label===t('Add Remote…','添加远端…'));
  const keyboard=(event:React.KeyboardEvent,target:MenuTarget,activate?:()=>void)=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();context(event,target);}else if(event.key==='Enter'&&activate){event.preventDefault();activate();}};
  const selectionKeys=(event:React.KeyboardEvent<HTMLElement>)=>{
    const target=event.target;if(!(target instanceof Element))return;const scope=target.closest<HTMLElement>('[data-selection-scope]')?.dataset.selectionScope;if(!scope)return;
    if(scope==='repositories'){const keys=repositoryGroups.map(group=>group.key);handleSelectionKeyboard(event,()=>state.setRepositorySelection(keys,keys[0]),()=>state.setRepositorySelection([]));return;}
    if(scope==='worktrees'){handleSelectionKeyboard(event,()=>setWorktreeSelection({repoId:state.repoId,paths:worktreePaths,anchor:worktreePaths[0]}),()=>setWorktreeSelection({repoId:state.repoId,paths:[]}));return;}
    const refs=scope==='local'?local:scope.startsWith('remote:')?remoteRefs.filter(ref=>ref.name.startsWith(`${scope.slice(7)}/`)):[];
    const names=buildRefTree(refs,scope,scope.startsWith('remote:')?scope.slice(7):'').flatMap(refsUnder).map(ref=>ref.fullName);
    handleSelectionKeyboard(event,()=>state.setRefSelection(names,names[0]),()=>state.setRefSelection([]));
  };
  const heading=(label:string,group:Group)=>{const target:MenuTarget={kind:'group',group},collapsed=state.collapsedSidebarGroups.includes(group),items=actions(target),selectionScope=['repositories','local','worktree'].includes(group)?group==='worktree'?'worktrees':group:undefined;return <div className="sidebar-heading" data-selection-scope={selectionScope} onContextMenu={event=>context(event,target)}><Button className="heading-toggle" icon={collapsed?'chevron-right':'chevron-down'} title={label} aria-expanded={!collapsed} onClick={()=>state.toggleSidebarGroup(group)}><span className="truncate">{label}</span></Button><SidebarActions items={group==='local'||group==='remote'?items.slice(0,1):items}/></div>;};
  const repositoryButton=(group:RepositoryGroup,nested=false)=>{const repo=group.repository,status=state.repositoryStatuses[repo.id],unpushed=status?.unpushed??0,current=group.members.some(member=>member.id===state.repoId),selected=state.selectedRepositoryKeys.includes(group.key),label=unpushed?t(`${group.name}, ${unpushed} unpushed commits`,`${group.name}，${unpushed} 个未推送提交`):group.name,activate=()=>{if(!current)void state.selectRepository(repo.id);},choose=(event:React.MouseEvent)=>{const next=selectionForClick(repositorySelectionOrder,state.selectedRepositoryKeys,state.repositorySelectionAnchor,group.key,{toggle:event.ctrlKey||event.metaKey,range:event.shiftKey});state.setRepositorySelection(next.selected,next.anchor);},openContext=(event:React.MouseEvent|React.KeyboardEvent)=>{const groups=selected?repositoryGroups.filter(item=>state.selectedRepositoryKeys.includes(item.key)):[group];if(!selected)state.setRepositorySelection([group.key],group.key);context(event,{kind:'repository',group,groups});},target:MenuTarget={kind:'repository',group,groups:[group]};return <button key={group.key} data-repository-group={group.key} {...dragProps(repositoryOrderKey(group.key),nested?group.collectionId:undefined)} className={`sidebar-item${nested?' repository-collection-member':''} ${selected?'action-selected':''}`} role="option" aria-selected={selected} aria-label={label} aria-current={current?'true':undefined} title={`${repo.root}${status?.branch?`\n${status.branch}${unpushed?` · ${unpushed} unpushed`:''}`:''}\n${t('Double-click or press Enter to switch repository.','双击或按 Enter 切换仓库。')}`} onClick={choose} onDoubleClick={activate} onContextMenu={event=>{event.currentTarget.focus({preventScroll:true});openContext(event);}} onKeyDown={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();openContext(event);}else keyboard(event,target,activate);}}><CurrentIndicator current={current}/><Icon name="repo"/><span className="truncate">{group.name}</span>{unpushed?<span className="notification-badge" aria-hidden="true">{unpushed>99?'99+':unpushed}</span>:null}</button>;};
  return <aside data-testid="sidebar" className="sidebar" onKeyDownCapture={selectionKeys}>
    {heading(t('Repositories','仓库'),'repositories')}{groupOpen('repositories')&&<div className="sidebar-list repository-list" data-selection-scope="repositories" tabIndex={0} role="listbox" aria-label={t('Repositories','仓库')} aria-multiselectable="true">{repositoryEntries.map(entry=>{if(entry.kind==='repository')return repositoryButton(entry.group);const groups=repositoryCollectionGroups(repositoryGroups,entry.collection.id,state.repositoryOrder),collapsed=collapsedRepositoryCollections.includes(entry.collection.id),target:MenuTarget={kind:'repository-collection',collection:entry.collection};return <div className="repository-collection" key={entry.collection.id} role="group" aria-label={entry.collection.name}><button type="button" className="sidebar-item repository-collection-heading" {...dragProps(collectionOrderKey(entry.collection.id))} aria-expanded={!collapsed} title={entry.collection.name} onClick={()=>setCollapsedRepositoryCollections(current=>collapsed?current.filter(id=>id!==entry.collection.id):[...current,entry.collection.id])} onContextMenu={event=>context(event,target)} onKeyDown={event=>keyboard(event,target,()=>setCollapsedRepositoryCollections(current=>collapsed?current.filter(id=>id!==entry.collection.id):[...current,entry.collection.id]))}><CurrentIndicator current={false}/><Icon name={collapsed?'chevron-right':'chevron-down'}/><Icon name={collapsed?'folder':'folder-opened'}/><span className="truncate">{entry.collection.name}</span><span className="tree-count">{groups.length}</span></button>{!collapsed&&<div className="repository-collection-members">{groups.map(group=>repositoryButton(group,true))}</div>}</div>;})}</div>}
    {snapshot&&<>
      {heading(t('Local Branches','本地分支'),'local')}{groupOpen('local')&&<><div className="branch-shortcuts" data-selection-scope="local"><span className="muted">Graph:</span><SidebarActions className="branch-shortcut-actions" label={t('Graph branch display presets','Graph 分支显示预设')} items={graphPresets}/></div><BranchTree refs={local} keyPrefix="local" context={context} checkoutBranch={checkoutBranch}/></>}
      {heading(t('Remotes','远端'),'remote')}{groupOpen('remote')&&(remotes.length?remotes.map(remote=>{const key=`remote-root:${remote}`,scope=`remote:${remote}`,open=!state.collapsedSidebarGroups.includes(key),target:MenuTarget={kind:'remote',name:remote};return <div key={remote} className="remote-group" data-selection-scope={scope}><div className="remote-heading" onContextMenu={event=>context(event,target)}><Button className="remote-toggle" icon={open?'chevron-down':'chevron-right'} title={remote} aria-expanded={open} onClick={()=>state.toggleSidebarGroup(key)}><span className="truncate">{remote}</span></Button><SidebarActions items={actions(target)}/></div>{open&&<BranchTree refs={remoteRefs.filter(ref=>ref.name.startsWith(remote+'/'))} keyPrefix={scope} stripPrefix={remote} context={context} checkoutBranch={checkoutBranch}/>}</div>}):<div className="sidebar-empty remote-empty"><span>{t('No remote repository connected.','尚未连接远程仓库。')}</span>{addRemote&&<Button icon="add" onClick={()=>void addRemote.run()}>{t('Add Remote…','添加远端…')}</Button>}</div>)}
      {heading('Tags','tag')}{groupOpen('tag')&&<div className="sidebar-list">{tags.map(ref=><button key={ref.fullName} className="sidebar-item" title={ref.fullName} onClick={event=>ref.targetType&&ref.targetType!=='commit'?context(event,{kind:'ref',ref}):void state.selectCommit(ref.oid)} onContextMenu={event=>context(event,{kind:'ref',ref})} onKeyDown={event=>keyboard(event,{kind:'ref',ref})}><Icon name="tag"/><span className="truncate">{ref.name}</span></button>)}{!tags.length&&<div className="sidebar-empty">{t('No tags','暂无 Tag')}</div>}</div>}
      {heading('Stashes','stash')}{groupOpen('stash')&&<div className="sidebar-list">{snapshot.stashes.map(stash=><button key={stash.oid} className="sidebar-item" title={`${stash.selector}: ${stash.subject}`} onClick={()=>void state.selectCommit(stash.oid,undefined,stash.oid)} onContextMenu={event=>context(event,{kind:'stash',stash})} onKeyDown={event=>keyboard(event,{kind:'stash',stash})}><Icon name="archive"/><span className="truncate">{stash.selector}: {stash.subject}</span></button>)}{!snapshot.stashes.length&&<div className="sidebar-empty">{t('No saved changes','暂无保存的修改')}</div>}</div>}
      {heading('Worktrees','worktree')}{groupOpen('worktree')&&<div className="sidebar-list worktree-list" data-selection-scope="worktrees" tabIndex={0} role="listbox" aria-label="Worktrees" aria-multiselectable="true">{worktrees.map(tree=>{const current=samePath(tree.path,snapshot.repository.root),selected=selectedWorktreePaths.includes(tree.path),label=`${tree.branch?.replace(/^refs\/heads\//,'')||'Detached HEAD'} · ${tree.path.replace(/\\/g,'/').split('/').at(-1)}`,activate=()=>{if(!current)openWorktree(tree.path);},choose=(event:React.MouseEvent)=>{const next=selectionForClick(worktreePaths,selectedWorktreePaths,worktreeAnchor,tree.path,{toggle:event.ctrlKey||event.metaKey,range:event.shiftKey});setWorktreeSelection({repoId:state.repoId,paths:next.selected,anchor:next.anchor});},openContext=(event:React.MouseEvent|React.KeyboardEvent)=>{const selectedTrees=selected?worktrees.filter(item=>selectedWorktreePaths.includes(item.path)):[tree];if(!selected)setWorktreeSelection({repoId:state.repoId,paths:[tree.path],anchor:tree.path});context(event,{kind:'worktree',worktree:tree,worktrees:selectedTrees});},target:MenuTarget={kind:'worktree',worktree:tree};return <button key={tree.path} data-worktree-path={tree.path} className={`sidebar-item ${selected?'action-selected':''}`} role="option" aria-selected={selected} aria-label={label} aria-current={current?'true':undefined} title={`${tree.path}\n${tree.branch||'Detached HEAD'}${tree.locked?' · Locked':''}\n${t('Double-click or press Enter to switch Worktree.','双击或按 Enter 切换 Worktree。')}`} onClick={choose} onDoubleClick={activate} onContextMenu={event=>{event.currentTarget.focus({preventScroll:true});openContext(event);}} onKeyDown={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();openContext(event);}else keyboard(event,target,activate);}}><CurrentIndicator current={current}/><Icon name={tree.locked?'lock':'folder'}/><span className="truncate">{label}</span></button>;})}</div>}
    </>}
    {!snapshot&&<div className="sidebar-empty">{t('Select a repository to begin.','选择仓库以开始。')}</div>}
  </aside>;
}
