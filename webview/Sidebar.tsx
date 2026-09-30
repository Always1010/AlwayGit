import type React from 'react';
import type { GitRef } from '../src/protocol/types';
import type { MenuTarget } from './menus';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { Button, Icon } from './ui';
import { samePath } from './pathIdentity';

export type ContextHandler = (event: React.MouseEvent | React.KeyboardEvent, target: MenuTarget) => void;
export function Sidebar({ context, checkoutBranch, openWorktree }: { context: ContextHandler; checkoutBranch(name:string):void; openWorktree(path:string):void }) {
  const state=useWorkbench(),snapshot=state.snapshot,t=useTranslation();
  const keyboard=(event:React.KeyboardEvent,target:MenuTarget)=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();context(event,target);}};
  const heading=(label:string,group:Extract<MenuTarget,{kind:'group'}>['group'])=><div className="sidebar-heading" onContextMenu={event=>context(event,{kind:'group',group})}><Button onClick={event=>context(event,{kind:'group',group})} onKeyDown={event=>keyboard(event,{kind:'group',group})}>{label}</Button><Icon name="ellipsis" /></div>;
  const refs=(kind:GitRef['kind'],remote?:string)=>(snapshot?.refs.filter(r=>r.kind===kind&&(!remote||r.name.startsWith(remote+'/')))??[]).map(ref=>{
    const current=kind==='local'&&ref.name===snapshot?.branch,target:MenuTarget={kind:'ref',ref};
    return <div className={`ref-row ${current?'is-current':''}`} key={ref.fullName} onContextMenu={event=>context(event,target)}>
      {kind!=='tag'&&<label className="branch-check"><input type="checkbox" aria-label={`Show branch ${ref.name}`} checked={state.checkedRefs?.includes(ref.fullName)??false} onChange={event=>state.setCheckedRefs(event.target.checked?[...(state.checkedRefs??[]),ref.fullName]:(state.checkedRefs??[]).filter(r=>r!==ref.fullName))}/></label>}
      <button className="sidebar-item ref-item" title={`${ref.fullName}${current?' · HEAD':''}${ref.targetType&&ref.targetType!=='commit'?' · '+ref.targetType:''}`} onClick={event=>{if(!ref.targetType||ref.targetType==='commit')void state.selectCommit(ref.oid);else context(event,target);}} onDoubleClick={()=>{if(kind==='local')checkoutBranch(ref.name);}} onKeyDown={event=>keyboard(event,target)}><Icon name={kind==='tag'?'tag':kind==='remote'?'cloud':'git-branch'}/><span className="truncate">{ref.name}</span>{current&&<span className="current-marker">{t('Current','当前')}</span>}</button>
    </div>;
  });
  const remotes=snapshot?.remotes??[...new Set(snapshot?.refs.filter(r=>r.kind==='remote').map(r=>r.name.split('/')[0])??[])];
  return <aside data-testid="sidebar" className="sidebar">
    {heading(t('Repositories','仓库'),'repositories')}<div className="sidebar-list">{state.repositories.map(repo=><button key={repo.id} className={`sidebar-item ${repo.id===state.repoId?'selected':''}`} title={repo.root} onClick={()=>void state.selectRepository(repo.id)} onContextMenu={event=>context(event,{kind:'repository',repository:repo})} onKeyDown={event=>keyboard(event,{kind:'repository',repository:repo})}><Icon name="repo"/><span className="truncate">{repo.name}</span></button>)}</div>
    {snapshot&&<>
      {heading(t('Local Branches','本地分支'),'local')}<div className="branch-shortcuts"><Button onClick={()=>state.setCheckedRefs([...(state.checkedRefs??[]),...snapshot.refs.filter(r=>r.kind==='local').map(r=>r.fullName)])}>{t('Select All','全选')}</Button><Button onClick={()=>state.setCheckedRefs(snapshot.refs.filter(r=>r.kind==='local'&&r.name===snapshot.branch).map(r=>r.fullName))}>{t('Current Only','仅当前')}</Button><Button onClick={()=>state.setCheckedRefs([])}>{t('Clear Selection','取消选择')}</Button></div><div className="sidebar-list">{refs('local')}</div>
      {heading(t('Remotes','远端'),'remote')}{remotes.map(remote=><div key={remote}><button className="remote-heading" onClick={event=>context(event,{kind:'remote',name:remote})} onContextMenu={event=>context(event,{kind:'remote',name:remote})} onKeyDown={event=>keyboard(event,{kind:'remote',name:remote})}><Icon name="cloud"/>{remote}</button><div className="sidebar-list">{refs('remote',remote)}</div></div>)}
      {heading('Tags','tag')}<div className="sidebar-list">{refs('tag')}{!snapshot.refs.some(r=>r.kind==='tag')&&<div className="sidebar-empty">{t('No tags','暂无 Tag')}</div>}</div>
      {heading('Stashes','stash')}<div className="sidebar-list">{snapshot.stashes.map(stash=><button key={stash.oid} className="sidebar-item" title={`${stash.selector}: ${stash.subject}`} onClick={()=>void state.selectCommit(stash.oid,undefined,stash.oid)} onContextMenu={event=>context(event,{kind:'stash',stash})} onKeyDown={event=>keyboard(event,{kind:'stash',stash})}><Icon name="archive"/><span className="truncate">{stash.selector}: {stash.subject}</span></button>)}{!snapshot.stashes.length&&<div className="sidebar-empty">{t('No saved changes','暂无保存的修改')}</div>}</div>
      {heading('Worktrees','worktree')}<div className="sidebar-list">{snapshot.worktrees.map(tree=><button key={tree.path} className={`sidebar-item ${samePath(tree.path,snapshot.repository.root)?'is-current':''}`} title={`${tree.path}\n${tree.branch||'Detached HEAD'}${tree.locked?' · Locked':''}`} onClick={()=>openWorktree(tree.path)} onContextMenu={event=>context(event,{kind:'worktree',worktree:tree})} onKeyDown={event=>keyboard(event,{kind:'worktree',worktree:tree})}><Icon name={tree.locked?'lock':'folder'}/><span className="truncate">{tree.branch?.replace(/^refs\/heads\//,'')||'Detached HEAD'} · {tree.path.replace(/\\/g,'/').split('/').at(-1)}</span></button>)}</div>
    </>}
    {!snapshot&&<div className="sidebar-empty">{t('Select a repository to begin.','选择仓库以开始。')}</div>}
  </aside>;
}
