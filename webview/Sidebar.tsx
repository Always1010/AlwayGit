import { useEffect, useRef } from 'react';
import type React from 'react';
import type { GitRef } from '../src/protocol/types';
import type { MenuTarget } from './menus';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { Button, Icon } from './ui';
import { samePath } from './pathIdentity';
import { buildRefTree, refsUnder, type RefTreeNode } from './refTree';
import { groupRepositories } from '../src/protocol/repositories';
import { selectionForClick } from './commitSelection';

export type ContextHandler = (event: React.MouseEvent | React.KeyboardEvent, target: MenuTarget) => void;
type Group = Extract<MenuTarget,{kind:'group'}>['group'];

function TreeCheckbox({label,checked,mixed,onChange}:{label:string;checked:boolean;mixed:boolean;onChange(checked:boolean):void}) {
  const element=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(element.current)element.current.indeterminate=mixed;},[mixed]);
  return <label className="branch-check"><input ref={element} type="checkbox" aria-label={label} checked={checked} onChange={event=>onChange(event.target.checked)}/></label>;
}

function BranchLeaf({refItem,depth,order,context,checkoutBranch}:{refItem:GitRef;depth:number;order:GitRef[];context:ContextHandler;checkoutBranch(name:string):void}) {
  const state=useWorkbench(),t=useTranslation(),current=refItem.kind==='local'&&refItem.name===state.snapshot?.branch,selected=state.selectedRefs.includes(refItem.fullName);
  const choose=(event:React.MouseEvent|React.KeyboardEvent)=>{const names=order.map(ref=>ref.fullName),existing=state.selectedRefs.filter(name=>names.includes(name)),next=selectionForClick(names,existing,state.refSelectionAnchor,refItem.fullName,{toggle:event.ctrlKey||event.metaKey,range:event.shiftKey});state.setRefSelection(next.selected,next.anchor);void state.selectCommit(refItem.oid);};
  const openContext=(event:React.MouseEvent|React.KeyboardEvent)=>{const refs=selected?order.filter(ref=>state.selectedRefs.includes(ref.fullName)):[refItem];if(!selected)state.setRefSelection([refItem.fullName],refItem.fullName);context(event,{kind:'ref',ref:refItem,refs});};
  return <div className={`ref-row tree-row ${current?'is-current':''} ${selected?'action-selected':''}`} style={{'--tree-depth':depth} as React.CSSProperties} onContextMenu={openContext} role="treeitem" aria-selected={selected}>
    <span className="tree-spacer"/>{refItem.kind!=='tag'&&<TreeCheckbox label={`Show branch ${refItem.name}`} checked={state.checkedRefs?.includes(refItem.fullName)??false} mixed={false} onChange={checked=>state.setCheckedRefs(checked?[...(state.checkedRefs??[]),refItem.fullName]:(state.checkedRefs??[]).filter(name=>name!==refItem.fullName))}/>}
    <button className="sidebar-item ref-item" aria-label={`Branch ${refItem.name}`} title={`${refItem.fullName}${current?' · HEAD':''}`} onClick={choose} onDoubleClick={()=>{if(refItem.kind==='local')checkoutBranch(refItem.name);}} onKeyDown={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();openContext(event);}}}><Icon name={refItem.kind==='remote'?'cloud':'git-branch'}/><span className="truncate">{refItem.name.split('/').at(-1)}</span>{current&&<span className="current-marker">{t('Current','当前')}</span>}</button>
  </div>;
}

function BranchNode({node,depth,order,context,checkoutBranch}:{node:RefTreeNode;depth:number;order:GitRef[];context:ContextHandler;checkoutBranch(name:string):void}) {
  const state=useWorkbench(),t=useTranslation(),hasChildren=node.children.length>0;
  if(!hasChildren&&node.ref)return <BranchLeaf refItem={node.ref} depth={depth} order={order} context={context} checkoutBranch={checkoutBranch}/>;
  const refs=refsUnder(node),selected=refs.filter(ref=>state.checkedRefs?.includes(ref.fullName)).length,expanded=state.expandedRefGroups?.includes(node.key)??false;
  const update=(checked:boolean)=>{const names=new Set(state.checkedRefs??[]);for(const ref of refs)checked?names.add(ref.fullName):names.delete(ref.fullName);state.setCheckedRefs([...names]);};
  return <div className="tree-node" role="treeitem" aria-expanded={expanded}>
    <div className="tree-folder tree-row" style={{'--tree-depth':depth} as React.CSSProperties} onContextMenu={event=>{state.setRefSelection(refs.map(ref=>ref.fullName),refs[0]?.fullName);context(event,{kind:'ref-folder',label:node.label,refs});}}>
      <button type="button" className="tree-chevron" aria-label={`${expanded?t('Collapse','收起'):t('Expand','展开')} ${node.label}`} onClick={()=>state.setExpandedRefGroup(node.key,!expanded)}><Icon name={expanded?'chevron-down':'chevron-right'}/></button>
      <TreeCheckbox label={`Show branch group ${node.label}`} checked={selected===refs.length&&refs.length>0} mixed={selected>0&&selected<refs.length} onChange={update}/>
      <button type="button" className="tree-folder-name" onClick={()=>state.setExpandedRefGroup(node.key,!expanded)}><Icon name={expanded?'folder-opened':'folder'}/><span className="truncate">{node.label}</span><span className="tree-count">{selected}/{refs.length}</span></button>
    </div>
    {expanded&&<div role="group">{node.ref&&<BranchLeaf refItem={node.ref} depth={depth+1} order={order} context={context} checkoutBranch={checkoutBranch}/>} {node.children.map(child=><BranchNode key={child.key} node={child} depth={depth+1} order={order} context={context} checkoutBranch={checkoutBranch}/>)}</div>}
  </div>;
}

function BranchTree({refs,keyPrefix,stripPrefix='',context,checkoutBranch}:{refs:GitRef[];keyPrefix:string;stripPrefix?:string;context:ContextHandler;checkoutBranch(name:string):void}) {
  const state=useWorkbench(),nodes=buildRefTree(refs,keyPrefix,stripPrefix),order=nodes.flatMap(refsUnder),names=order.map(ref=>ref.fullName);
  return <div className="branch-tree" role="tree" aria-multiselectable="true" onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();state.setRefSelection(names,names[0]);}else if(event.key==='Escape'){event.preventDefault();state.setRefSelection([]);}}}>{nodes.map(node=><BranchNode key={node.key} node={node} depth={0} order={order} context={context} checkoutBranch={checkoutBranch}/>)}</div>;
}

export function Sidebar({ context, checkoutBranch, openWorktree }: { context: ContextHandler; checkoutBranch(name:string):void; openWorktree(path:string):void }) {
  const state=useWorkbench(),snapshot=state.snapshot,t=useTranslation();
  const keyboard=(event:React.KeyboardEvent,target:MenuTarget)=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();context(event,target);}};
  const heading=(label:string,group:Group)=>{const target:MenuTarget={kind:'group',group},collapsed=state.collapsedSidebarGroups.includes(group);return <div className="sidebar-heading" onContextMenu={event=>context(event,target)}><Button className="heading-toggle" icon={collapsed?'chevron-right':'chevron-down'} aria-expanded={!collapsed} onClick={()=>state.toggleSidebarGroup(group)}>{label}</Button><Button className="heading-menu" icon="ellipsis" aria-label={`${label} actions`} title={`${label} actions`} onClick={event=>context(event,target)} onKeyDown={event=>keyboard(event,target)}/></div>;};
  const groupOpen=(key:string)=>!state.collapsedSidebarGroups.includes(key);
  const local=snapshot?.refs.filter(ref=>ref.kind==='local')??[],remoteRefs=snapshot?.refs.filter(ref=>ref.kind==='remote')??[],tags=snapshot?.refs.filter(ref=>ref.kind==='tag')??[];
  const remotes=snapshot?.remotes??[...new Set(remoteRefs.map(ref=>ref.name.split('/')[0]))];
  const repositoryGroups=groupRepositories(state.repositories,state.repoId);
  return <aside data-testid="sidebar" className="sidebar">
    {heading(t('Repositories','仓库'),'repositories')}{groupOpen('repositories')&&<div className="sidebar-list">{repositoryGroups.map(group=>{const repo=group.repository,status=state.repositoryStatuses[repo.id],unpushed=status?.unpushed??0,label=unpushed?t(`${group.name}, ${unpushed} unpushed commits`,`${group.name}，${unpushed} 个未推送提交`):group.name;return <button key={group.key} data-repository-group={group.key} className={`sidebar-item ${repo.id===state.repoId?'selected':''}`} aria-label={label} title={`${repo.root}${status?.branch?`\n${status.branch}${unpushed?` · ${unpushed} unpushed`:''}`:''}`} onClick={()=>{if(repo.id!==state.repoId)void state.selectRepository(repo.id);}} onContextMenu={event=>context(event,{kind:'repository',repository:repo})} onKeyDown={event=>keyboard(event,{kind:'repository',repository:repo})}><Icon name="repo"/><span className="truncate">{group.name}</span>{unpushed?<span className="notification-badge" aria-hidden="true">{unpushed>99?'99+':unpushed}</span>:null}</button>;})}</div>}
    {snapshot&&<>
      {heading(t('Local Branches','本地分支'),'local')}{groupOpen('local')&&<><div className="branch-shortcuts"><span className="muted">Graph:</span><Button title={t('Show all local branches in Graph','在 Graph 中显示全部本地分支')} onClick={()=>state.setCheckedRefs([...(state.checkedRefs??[]),...local.map(ref=>ref.fullName)])}>{t('Show All','全部显示')}</Button><Button title={t('Show only the current branch in Graph','在 Graph 中仅显示当前分支')} onClick={()=>state.setCheckedRefs(local.filter(ref=>ref.name===snapshot.branch).map(ref=>ref.fullName))}>{t('Current Only','仅当前')}</Button><Button title={t('Hide all branches from Graph','从 Graph 隐藏全部分支')} onClick={()=>state.setCheckedRefs([])}>{t('Show None','全部隐藏')}</Button></div><BranchTree refs={local} keyPrefix="local" context={context} checkoutBranch={checkoutBranch}/></>}
      {heading(t('Remotes','远端'),'remote')}{groupOpen('remote')&&remotes.map(remote=>{const key=`remote-root:${remote}`,open=!state.collapsedSidebarGroups.includes(key),target:MenuTarget={kind:'remote',name:remote};return <div key={remote} className="remote-group"><div className="remote-heading" onContextMenu={event=>context(event,target)}><Button className="remote-toggle" icon={open?'chevron-down':'chevron-right'} aria-expanded={open} onClick={()=>state.toggleSidebarGroup(key)}>{remote}</Button><Button className="heading-menu" icon="ellipsis" aria-label={`${remote} actions`} onClick={event=>context(event,target)} onKeyDown={event=>keyboard(event,target)}/></div>{open&&<BranchTree refs={remoteRefs.filter(ref=>ref.name.startsWith(remote+'/'))} keyPrefix={`remote:${remote}`} stripPrefix={remote} context={context} checkoutBranch={checkoutBranch}/>}</div>;})}
      {heading('Tags','tag')}{groupOpen('tag')&&<div className="sidebar-list">{tags.map(ref=><button key={ref.fullName} className="sidebar-item" title={ref.fullName} onClick={event=>ref.targetType&&ref.targetType!=='commit'?context(event,{kind:'ref',ref}):void state.selectCommit(ref.oid)} onContextMenu={event=>context(event,{kind:'ref',ref})} onKeyDown={event=>keyboard(event,{kind:'ref',ref})}><Icon name="tag"/><span className="truncate">{ref.name}</span></button>)}{!tags.length&&<div className="sidebar-empty">{t('No tags','暂无 Tag')}</div>}</div>}
      {heading('Stashes','stash')}{groupOpen('stash')&&<div className="sidebar-list">{snapshot.stashes.map(stash=><button key={stash.oid} className="sidebar-item" title={`${stash.selector}: ${stash.subject}`} onClick={()=>void state.selectCommit(stash.oid,undefined,stash.oid)} onContextMenu={event=>context(event,{kind:'stash',stash})} onKeyDown={event=>keyboard(event,{kind:'stash',stash})}><Icon name="archive"/><span className="truncate">{stash.selector}: {stash.subject}</span></button>)}{!snapshot.stashes.length&&<div className="sidebar-empty">{t('No saved changes','暂无保存的修改')}</div>}</div>}
      {heading('Worktrees','worktree')}{groupOpen('worktree')&&<div className="sidebar-list">{snapshot.worktrees.map(tree=><button key={tree.path} className={`sidebar-item ${samePath(tree.path,snapshot.repository.root)?'is-current':''}`} title={`${tree.path}\n${tree.branch||'Detached HEAD'}${tree.locked?' · Locked':''}`} onClick={()=>openWorktree(tree.path)} onContextMenu={event=>context(event,{kind:'worktree',worktree:tree})} onKeyDown={event=>keyboard(event,{kind:'worktree',worktree:tree})}><Icon name={tree.locked?'lock':'folder'}/><span className="truncate">{tree.branch?.replace(/^refs\/heads\//,'')||'Detached HEAD'} · {tree.path.replace(/\\/g,'/').split('/').at(-1)}</span></button>)}</div>}
    </>}
    {!snapshot&&<div className="sidebar-empty">{t('Select a repository to begin.','选择仓库以开始。')}</div>}
  </aside>;
}
