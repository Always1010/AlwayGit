import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import type { RpcRequest } from '../src/protocol/types';
import { connected, demoMode, rpc } from './rpc';
import { defaultLayout, useWorkbench } from './store';
import { useTranslation } from './i18n';
import { ActionDialog } from './ActionDialog';
import type { DialogRequest } from './ActionDialog';
import { ContextMenu } from './ContextMenu';
import { menuFor } from './menus';
import type { MenuTarget } from './menus';
import { Sidebar } from './Sidebar';
import type { ContextHandler } from './Sidebar';
import { History } from './History';
import { Details } from './Details';
import { DiffPreview } from './DiffPreview';
import { Button, Empty, Icon, Modal, ResizeHandle } from './ui';

export function App() {
  const state=useWorkbench(),t=useTranslation(),[dialog,setDialog]=useState<DialogRequest>(),[context,setContext]=useState<{x:number;y:number;target:MenuTarget}>();
  useEffect(()=>{if(connected)void useWorkbench.getState().initialize();},[]);
  useEffect(()=>{setDialog(undefined);setContext(undefined);},[state.repoId,state.language]);
  const closeMenu=useCallback(()=>setContext(undefined),[]);
  const host=useCallback(async(method:RpcRequest['method'],payload?:unknown,repoId?:string)=>{
    const current=useWorkbench.getState();try{await rpc(method,repoId??current.repoId,payload);if(demoMode&&method!=='copyText')useWorkbench.setState({notice:current.language==='zh-CN'?'模拟原生 VS Code 操作；未修改实际文件。':'Demo: native VS Code command preview.'});if(method==='copyText')useWorkbench.setState({notice:current.language==='zh-CN'?'已复制。':'Copied.'});}catch(error){current.report(error);}
  },[]);
  async function addRepository(){try{await rpc('addRepository');await state.initialize();}catch(error){state.report(error);}}
  const open=(request:DialogRequest)=>{setContext(undefined);useWorkbench.setState({error:undefined,checkoutFailure:undefined});setDialog(request);};
  const showContext:ContextHandler=(event,target)=>{
    event.preventDefault();event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();
    const point='clientX' in event&&event.clientX!==0?{x:event.clientX,y:event.clientY}:{x:rect.left+Math.min(40,rect.width/2),y:rect.bottom};
    setContext({...point,target});
  };
  async function checkoutBranch(name:string){if(state.busy||name===state.snapshot?.branch)return;setDialog(undefined);const repoId=state.repoId;if(await state.execute({type:'branch.checkout',name})&&useWorkbench.getState().repoId===repoId){const head=useWorkbench.getState().snapshot?.head;if(head)void state.selectCommit(head);}}
  function checkout(oid:string){
    const candidates=state.snapshot?.refs.filter(r=>r.kind==='local'&&r.oid===oid)??[];
    if(candidates.length===1)void checkoutBranch(candidates[0].name);
    else if(candidates.length>1)open({type:'branch.checkout',target:candidates[0].name,candidates:candidates.map(r=>r.name)});
    else open({type:'commit.checkout',target:oid});
  }
  async function edit(){const current=useWorkbench.getState();if(!current.selectedFile)return;if(current.diffTarget?.kind==='comparison'){await host('diff',current.diffTarget,current.repoId);return;}try{await rpc('openFile',current.repoId,{path:current.selectedFile});if(demoMode)useWorkbench.setState({notice:t('Demo: edit in VS Code.','模拟：在 VS Code 中编辑。')});}catch(error){if(current.diffTarget?.kind==='commit')await host('diff',current.diffTarget,current.repoId);else current.report(error);}}
  const native=()=>{if(state.diffTarget)void host('diff',state.diffTarget);};
  useEffect(()=>{if(state.layout.preset==='editor'&&state.diffTarget)void host('diff',state.diffTarget,state.repoId);},[state.layout.preset,state.diffTarget,state.repoId]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='r'){event.preventDefault();void useWorkbench.getState().refresh();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  const snapshot=state.snapshot,layout=state.layout,chosen=snapshot?.changes.find(f=>f.path===state.selectedFile),working=state.tab==='changes';
  const menu=context?menuFor(context.target,{open,checkout,host,addRepository,fetchRepository:async(repoId)=>{await state.selectRepository(repoId);open({type:'fetch'});}}):undefined;
  if(!connected)return <div className="connection-screen"><Icon name="git-branch"/><h1>AlwayGit</h1><p>{t('Your Git workbench, inside VS Code.','VS Code 中的 Git 工作台。')}</p><a className="button primary" href="?demo=1">{t('Explore Demo','查看示例')}</a></div>;
  return <div className={`workbench layout-${layout.preset}`} data-testid="workbench" style={{'--sidebar-width':`${layout.sidebar}px`,'--details-width':`${layout.details}px`,'--diff-height':`${layout.diff}px`,'--workbench-font':`${layout.font}px`,'--row-height':`${layout.row}px`} as React.CSSProperties}>
    <header className="app-chrome"><strong className="brand"><Icon name="git-branch"/>AlwayGit</strong><span className="workbench-tab">{t('Git Workbench','Git 工作台')}</span>{demoMode&&<span className="muted">{t('Demo Repository','模拟仓库')}</span>}<div className="toolbar-spacer"/><select aria-label="Layout" value={layout.preset} onChange={event=>state.setLayout({preset:event.target.value as 'workbench'|'editor'})}><option value="workbench">Workbench</option><option value="editor">Editor Focus</option></select><Button icon="layout" onClick={()=>state.setLayout(defaultLayout)}>{t('Restore Layout','恢复布局')}</Button><select aria-label="Language" value={state.language} onChange={event=>state.setLanguage(event.target.value as 'en'|'zh-CN')}><option value="en">English</option><option value="zh-CN">简体中文</option></select></header>
    <div className="branch-bar"><span className="current-marker">{snapshot?.branch?t('Current Branch','当前分支'):'Detached HEAD'}</span><strong data-testid="current-branch">{snapshot?.branch||snapshot?.head?.slice(0,8)||'—'}</strong><Button icon="location" disabled={!snapshot?.head} onClick={state.locateHead}>Locate HEAD</Button><span className="muted">{snapshot?.repository.name} · Staged {snapshot?.changes.filter(f=>f.indexStatus!==' '&&!f.untracked).length??0} · Unstaged {snapshot?.changes.filter(f=>f.worktreeStatus!==' '||f.untracked).length??0}{snapshot?.upstream?` · → ${snapshot.upstream}`:''}</span></div>
    <div className="toolbar">
      <Button icon="cloud-download" disabled={!snapshot||state.busy} onClick={()=>void state.execute({type:'fetch'})}>Fetch</Button><Button icon="arrow-down" disabled={!snapshot||state.busy} onClick={()=>open({type:'pull'})}>Pull{snapshot?.behind?` (${snapshot.behind})`:''}</Button><Button icon="arrow-up" disabled={!snapshot?.branch||state.busy} title={!snapshot?.branch?t('Push requires a local branch.','Push 需要当前处于本地分支。'):undefined} onClick={()=>open({type:'push'})}>Push{snapshot?.ahead?` (${snapshot.ahead})`:''}</Button><Button icon="refresh" aria-label="Refresh" disabled={!snapshot||state.busy} onClick={()=>void state.refresh()}/><span className="toolbar-divider"/>
      <Button icon="add" title="Stage Changes" disabled={!working||!chosen||state.busy||state.diffTarget?.kind!=='change'||state.diffTarget.area==='staged'} onClick={()=>void state.execute({type:'stage',paths:[state.selectedFile!]})}>Stage</Button><Button icon="remove" title="Unstage Changes" disabled={!working||!chosen||state.busy||state.diffTarget?.kind!=='change'||state.diffTarget.area!=='staged'} onClick={()=>void state.execute({type:'unstage',paths:[state.selectedFile!]})}>Unstage</Button><Button icon="discard" disabled={!working||!chosen||state.busy||state.diffTarget?.kind!=='change'||state.diffTarget.area!=='unstaged'} onClick={()=>open({type:'discard',paths:[state.selectedFile!]})}>Discard…</Button><Button icon="git-commit" disabled={!snapshot} onClick={()=>{state.selectWorking();setTimeout(()=>document.getElementById('ag-commit-message')?.focus(),0);}}>Commit</Button><span className="toolbar-divider"/>
      <Button icon="archive" disabled={!snapshot?.changes.length||state.busy||!!snapshot?.operation.kind} onClick={()=>open({type:'stash.create'})}>Stash Changes…</Button>
      <div className="toolbar-spacer"/><Button icon="vscode" data-testid="open-project" title={snapshot?.repository.root??t('Select a repository first','请先选择仓库')} disabled={!snapshot} onClick={()=>void host('openProject')}>{t('Open in VS Code','在 VS Code 中打开项目')}</Button>
    </div>
    {state.error&&!state.checkoutFailure&&<div className="banner error" role="alert"><Icon name="error"/><span>{state.error}</span><Button onClick={()=>void host('showLog')}>{t('Show Log','查看日志')}</Button><Button icon="close" aria-label="Dismiss error" onClick={()=>useWorkbench.setState({error:undefined})}/></div>}
    {snapshot?.operation.kind&&<div className="operation-banner"><strong>{snapshot.operation.kind} · {t('in progress','进行中')}</strong><span>{snapshot.operation.conflicts} {t('conflicts','个冲突')}</span><Button disabled={!snapshot.operation.canContinue||state.busy} onClick={()=>void state.execute({type:'operation.continue',kind:snapshot.operation.kind!})}>Continue</Button><Button disabled={!snapshot.operation.canSkip||state.busy} onClick={()=>void state.execute({type:'operation.skip',kind:snapshot.operation.kind!})}>Skip</Button><Button disabled={!snapshot.operation.canAbort||state.busy} onClick={()=>open({type:'operation.abort'})}>Abort…</Button></div>}
    <div className="workspace"><Sidebar context={showContext} checkoutBranch={name=>void checkoutBranch(name)} openWorktree={path=>void host('openWorktree',{path,newWindow:false})}/><ResizeHandle axis="x" label="Resize repository sidebar" value={layout.sidebar} min={160} max={360} onChange={sidebar=>state.setLayout({sidebar})}/><main className="main-panel">
      {!snapshot?<Empty title={state.loading?t('Opening repository…','正在打开仓库…'):t('Add or select a repository','添加或选择仓库')}><Button onClick={()=>void addRepository()}>Add Repository…</Button></Empty>:<>
        <div className="top-panels"><History context={showContext} checkout={checkout} checkoutBranch={name=>void checkoutBranch(name)}/><ResizeHandle axis="x" label="Resize details panel" value={layout.details} min={230} max={480} reverse onChange={details=>state.setLayout({details})}/><Details open={open} edit={()=>void edit()}/></div>
        {layout.preset==='workbench'&&<><ResizeHandle axis="y" label="Resize Diff panel" value={layout.diff} min={130} max={450} reverse onChange={diff=>state.setLayout({diff})}/><DiffPreview native={native} edit={()=>void edit()}/></>}
      </>}
    </main></div>
    <footer className="statusbar" role="status"><span>{state.busy?state.activity:state.historyLoading?t('Loading history…','正在读取历史…'):state.notice??t('Ready','就绪')}</span><span>{layout.font}px / {layout.row}px · {layout.preset==='workbench'?'Workbench':'Editor Focus'}</span></footer>
    {dialog&&snapshot&&!state.checkoutFailure&&<ActionDialog key={`${state.repoId}-${dialog.type}-${dialog.target}-${dialog.pop}`} dialog={dialog} onClose={()=>setDialog(undefined)}/>}
    {context&&menu&&<ContextMenu x={context.x} y={context.y} caption={menu.caption} items={menu.items} close={closeMenu}/>}
    {state.checkoutFailure&&snapshot&&<CheckoutFailureDialog onClose={()=>{setDialog(undefined);useWorkbench.setState({checkoutFailure:undefined,error:undefined});}} host={host}/>}
  </div>;
}

function CheckoutFailureDialog({onClose,host}:{onClose():void;host(method:RpcRequest['method'],payload?:unknown):Promise<void>}) {
  const state=useWorkbench(),failure=state.checkoutFailure!,t=useTranslation(),canStash=failure.reason==='local-changes'&&!failure.stashCreated;
  const reason=failure.reason==='worktree-occupied'?t('The branch is in use by another Worktree.','分支正在被其他 Worktree 使用。'):failure.reason==='conflicts'?t('Resolve conflicts before Checkout.','请先解决冲突，再 Checkout。'):failure.reason==='operation-active'?t('Complete or Abort the active Git operation before Checkout.','请先完成或 Abort 当前 Git 操作。'):failure.stashCreated?t('Stash was saved, but Checkout failed. The Stash is preserved.','Stash 已保存，但 Checkout 失败；保存内容已保留。'):failure.reason==='local-changes'?t('Checkout would overwrite local changes.','Checkout 可能覆盖未提交修改。'):t('Git could not complete Checkout. See the details below.','Git 无法完成 Checkout，请查看下方详情。');
  return <Modal title={t('Checkout Blocked','无法 Checkout')} busy={state.busy} onClose={onClose} footer={<><Button disabled={state.busy} onClick={onClose}>{t('Cancel','取消')}</Button>{canStash&&<Button className="primary" disabled={state.busy} onClick={()=>{const repoId=state.repoId;void state.execute({type:'checkout.stash',target:failure.target,detached:failure.detached,includeUntracked:true}).then(success=>{if(success){const latest=useWorkbench.getState();if(latest.repoId===repoId&&latest.snapshot?.head)void latest.selectCommit(latest.snapshot.head);onClose();}});}}>Stash Changes &amp; Checkout</Button>}</>}>
    <strong>Checkout {failure.target}</strong><p className="warning-text" role="alert">{reason}</p><div className="discard-paths">{failure.paths.map(path=><div key={path}>{path}</div>)}</div>{failure.worktreePath&&<Button onClick={()=>{onClose();void host('openWorktree',{path:failure.worktreePath,newWindow:false});}}>Open Worktree</Button>}{!!failure.paths.length&&<Button onClick={()=>{const path=failure.paths[0];onClose();state.selectWorking();const file=state.snapshot?.changes.find(f=>f.path===path);if(file)state.selectFile({kind:'change',path,area:file.conflict?'conflict':file.untracked||file.worktreeStatus!==' '?'unstaged':'staged'});}}>{t('View Affected Files','查看受影响文件')}</Button>}<p className="muted">{state.error}</p>
  </Modal>;
}
