import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import type { Repository, RpcRequest } from '../src/protocol/types';
import { connected, demoMode, rpc } from './rpc';
import { useWorkbench } from './store';
import { diffRowHeight, effectiveRowHeight, isLightTheme, textColorForBackground, useResolvedTheme } from './appearance';
import { SettingsDialog } from './SettingsDialog';
import { useTranslation } from './i18n';
import { ActionDialog } from './ActionDialog';
import type { DialogRequest } from './ActionDialog';
import { ContextMenu } from './ContextMenu';
import { menuFor } from './menus';
import type { MenuApi, MenuTarget } from './menus';
import { Sidebar } from './Sidebar';
import type { ContextHandler } from './Sidebar';
import { History } from './History';
import { Details } from './Details';
import { DiffPreview } from './DiffPreview';
import { ActionFeedbackBar } from './ActionFeedbackBar';
import { OperationNotice } from './OperationNotice';
import { OperationReviewDialog } from './OperationReviewDialog';
import { Button, Empty, Icon, Modal, ResizeHandle } from './ui';
import { repositoryViewState } from './repositoryState';

export function App() {
  const state=useWorkbench(),t=useTranslation(),[dialog,setDialog]=useState<DialogRequest>(),[repositoryFetch,setRepositoryFetch]=useState<Repository[]>(),[context,setContext]=useState<{x:number;y:number;target:MenuTarget}>();
  const mainPanel=useRef<HTMLElement>(null),[mainPanelHeight,setMainPanelHeight]=useState(0);
  const theme=useResolvedTheme(state.appearance.theme),lightTheme=isLightTheme(theme);
  const paletteColors=lightTheme?state.appearance.colors.light:state.appearance.colors.dark;
  useEffect(()=>{if(connected)void useWorkbench.getState().initialize();},[]);
  useEffect(()=>{setDialog(undefined);setContext(undefined);},[state.repoId,state.language]);
  const closeMenu=useCallback(()=>setContext(undefined),[]);
  const host=useCallback(async(method:RpcRequest['method'],payload?:unknown,repoId?:string)=>{
    const current=useWorkbench.getState();try{await rpc(method,repoId??current.repoId,payload);if(demoMode&&method!=='copyText')useWorkbench.setState({notice:current.language==='zh-CN'?'模拟原生 VS Code 操作；未修改实际文件。':'Demo: native VS Code command preview.'});if(method==='copyText')useWorkbench.setState({notice:current.language==='zh-CN'?'已复制。':'Copied.'});}catch(error){current.report(error);}
  },[]);
  async function addRepository(){try{await rpc('addRepository');await state.initialize();}catch(error){state.report(error);}}
  const open=(request:DialogRequest)=>{setContext(undefined);useWorkbench.setState({error:undefined,checkoutFailure:undefined,stashApplyFailure:undefined});setDialog(request);};
  const showContext:ContextHandler=(event,target)=>{
    event.preventDefault();event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();
    const point='clientX' in event&&event.clientX!==0?{x:event.clientX,y:event.clientY}:{x:rect.left+Math.min(40,rect.width/2),y:rect.bottom};
    setContext({...point,target});
  };
  async function checkoutBranch(name:string,remote=false){if(state.busy||!remote&&name===state.snapshot?.branch)return;if(remote){const ref=state.snapshot?.refs.find(ref=>ref.fullName===name);if(ref&&!ref.symbolicTarget&&(ref.targetType===undefined||ref.targetType==='commit'))open({type:'branch.track',target:name,checkout:true});return;}setDialog(undefined);const repoId=state.repoId;if(await state.execute({type:'branch.checkout',name})&&useWorkbench.getState().repoId===repoId){const head=useWorkbench.getState().snapshot?.head;if(head)void state.selectCommit(head);}}
  function checkout(oid:string){
    const candidates=state.snapshot?.refs.filter(r=>r.kind==='local'&&r.oid===oid)??[];
    if(candidates.length===1)void checkoutBranch(candidates[0].name);
    else if(candidates.length>1)open({type:'branch.checkout',target:candidates[0].name,candidates:candidates.map(r=>r.name)});
    else open({type:'commit.checkout',target:oid});
  }
  async function edit(target=useWorkbench.getState().diffTarget){const current=useWorkbench.getState();if(!target)return;if(target.kind==='comparison'){await host('diff',target,current.repoId);return;}try{await rpc('openFile',current.repoId,{path:target.path});if(demoMode)useWorkbench.setState({notice:t('Demo: edit in VS Code.','模拟：在 VS Code 中编辑。')});}catch(error){if(target.kind==='commit')await host('diff',target,current.repoId);else current.report(error);}}
  const native=()=>{if(state.diffTarget)void host('diff',state.diffTarget);};
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='r'){event.preventDefault();void useWorkbench.getState().refresh();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  useLayoutEffect(()=>{const element=mainPanel.current;if(!element)return;const measure=()=>setMainPanelHeight(element.clientHeight);measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();},[]);
  const snapshot=state.snapshot,layout=state.layout,unpushed=snapshot?.unpushed??snapshot?.ahead??0,repositoryState=repositoryViewState(snapshot,!!state.repoId,state.loading),hasRepositories=state.repositories.length>0;
  const maxDiffHeight=Math.max(130,(mainPanelHeight||576)-126),diffHeight=Math.min(layout.diff,maxDiffHeight);
  const menuApi:MenuApi={open,checkout,openDiff:target=>void host('diff',target),editFile:target=>void edit(target),host,addRepository,createRepositoryCollection:()=>host('createRepositoryCollection'),fetchRepositories:repositories=>setRepositoryFetch(repositories)};
  const menu=context?menuFor(context.target,menuApi):undefined;
  if(!connected)return <div className="connection-screen"><Icon name="git-branch"/><h1>AlwayGit</h1><p>{t('Your Git workbench, inside VS Code.','VS Code 中的 Git 工作台。')}</p><a className="button primary" href="?demo=1">{t('Explore Demo','查看示例')}</a></div>;
  return <div className="workbench layout-workbench" data-testid="workbench" data-theme={theme} onContextMenu={event=>{if(event.defaultPrevented)return;const target=event.target as HTMLElement,editable=!!target.closest('input:not([type=checkbox]),textarea,[contenteditable]:not([contenteditable="false"])'),selection=window.getSelection();if(!editable&&(!selection||selection.isCollapsed))event.preventDefault();}} style={{'--sidebar-width':`${layout.sidebar}px`,'--details-width':`${layout.details}px`,'--diff-height':`${layout.diff}px`,'--workbench-font':`${layout.font}px`,'--row-height':`${effectiveRowHeight(layout)}px`,'--control-height':`${Math.max(24,Math.round(layout.font*1.35)+6)}px`,'--diff-font':`${state.appearance.codeFont}px`,'--diff-row-height':`${diffRowHeight(state.appearance.codeFont)}px`,'--notification-badge':state.appearance.badgeColor,'--notification-badge-fg':textColorForBackground(state.appearance.badgeColor),'--graph-main':lightTheme?state.appearance.mainColors.light:state.appearance.mainColors.dark,...Object.fromEntries(paletteColors.map((color,index)=>[`--graph-lane-${index}`,color]))} as React.CSSProperties}>
    <header className="app-chrome"><strong className="brand"><Icon name="git-branch"/>AlwayGit</strong><span className="workbench-tab">{t('Git Workbench','Git 工作台')}</span>{demoMode&&<span className="muted">{t('Demo Repository','模拟仓库')}</span>}<div className="toolbar-spacer"/><Button className="icon-only" icon="split-horizontal" title={t('New Workbench Tab','新建 Workbench 标签页')} aria-label={t('New Workbench Tab','新建 Workbench 标签页')} onClick={()=>void host('openWorkbench',{newTab:true})}/><Button className="icon-only" icon="window" title={t('Open Workbench in New Window','在新窗口打开 Workbench')} aria-label={t('Open Workbench in New Window','在新窗口打开 Workbench')} onClick={()=>void host('openWorkbench',{newWindow:true})}/><Button className="icon-only" icon="layout" title={t('Restore Layout','恢复布局')} aria-label={t('Restore Layout','恢复布局')} onClick={state.restoreLayout}/><Button className="icon-only settings-trigger" icon="settings-gear" title={t('Interface Settings','界面设置')} aria-label={t('Interface Settings','界面设置')} onClick={()=>{setContext(undefined);state.beginSettings();}}/></header>
    <div className="branch-bar"><span className="branch-identity"><Icon name="git-branch"/><strong data-testid="current-branch">{snapshot?.branch||snapshot?.head?.slice(0,8)||'—'}</strong></span><span className="branch-caption">{repositoryState==='branch'?t('Current Branch','当前分支'):repositoryState==='detached'?'Detached HEAD':repositoryState==='opening'?t('Opening repository…','正在打开仓库…'):repositoryState==='unavailable'?t('Repository unavailable','仓库不可用'):t('No repository selected','尚未选择仓库')}</span>{snapshot&&<span className="muted branch-summary">{snapshot.repository.name} · Staged {snapshot.changes.filter(f=>f.indexStatus!==' '&&!f.untracked&&!f.conflict).length} · Unstaged {snapshot.changes.filter(f=>!f.conflict&&(f.worktreeStatus!==' '||f.untracked)).length}{snapshot.upstream?` · → ${snapshot.upstream}`:''}</span>}<Button icon="location" disabled={!snapshot?.head} onClick={state.locateHead}>Locate HEAD</Button></div>
    <div className="toolbar">
      <Button icon="cloud-download" disabled={!snapshot||state.busy} onClick={()=>void state.execute({type:'fetch'})}>Fetch</Button><Button icon="arrow-down" disabled={!snapshot||state.busy} onClick={()=>open({type:'pull'})}>Pull{snapshot?.behind?` (${snapshot.behind})`:''}</Button><Button icon="arrow-up" disabled={!snapshot?.branch||state.busy} aria-label={unpushed?t(`Push, ${unpushed} unpushed commits`,`Push，${unpushed} 个未推送提交`):'Push'} title={!snapshot?.branch?t('Push requires a local branch.','Push 需要当前处于本地分支。'):undefined} onClick={()=>open({type:'push'})}>Push{unpushed?<span className="notification-badge" aria-hidden="true">{unpushed>99?'99+':unpushed}</span>:null}</Button><Button icon="refresh" aria-label="Refresh" disabled={!snapshot||state.busy} onClick={()=>void state.refresh()}/><span className="toolbar-divider"/>
      <Button className="commit-trigger" icon="git-commit" disabled={!snapshot} onClick={()=>{state.selectWorking();setTimeout(()=>document.getElementById('ag-commit-message')?.focus(),0);}}>Commit</Button><span className="toolbar-divider"/>
      <Button icon="archive" disabled={!snapshot?.changes.length||state.busy||!!snapshot?.operation.kind} onClick={()=>open({type:'stash.create'})}>Stash Changes…</Button>
      <div className="toolbar-spacer"/><Button icon="vscode" data-testid="open-project" title={snapshot?.repository.root??t('Select a repository first','请先选择仓库')} disabled={!snapshot} onClick={()=>void host('openProject')}>{t('Open in VS Code','在 VS Code 中打开项目')}</Button>
    </div>
    <OperationNotice abort={()=>open({type:'operation.abort'})}/>
    <ActionFeedbackBar showLog={()=>void host('showLog')}/>
    {state.error&&state.error!==state.actionFeedback?.error&&!state.checkoutFailure&&!state.stashApplyFailure&&<div className="banner error" role="alert"><Icon name="error"/><span>{state.error}</span><Button onClick={()=>void host('showLog')}>{t('Show Log','查看日志')}</Button><Button icon="close" aria-label="Dismiss error" onClick={()=>useWorkbench.setState({error:undefined})}/></div>}
    <div className="workspace"><Sidebar context={showContext} actions={target=>menuFor(target,menuApi).items} checkoutBranch={(name,remote)=>void checkoutBranch(name,remote)} openWorktree={path=>void host('openWorktree',{path,newWindow:false})}/><ResizeHandle axis="x" label="Resize repository sidebar" value={layout.sidebar} min={160} max={360} onChange={sidebar=>state.setLayout({sidebar})}/><main ref={mainPanel} className={`main-panel${layout.diffCollapsed?' diff-collapsed':''}`} style={{'--diff-height':`${diffHeight}px`} as React.CSSProperties}>
      {!snapshot?<Empty title={repositoryState==='opening'?t('Opening repository…','正在打开仓库…'):repositoryState==='unavailable'?t('Repository unavailable','仓库不可用'):hasRepositories?t('No repository selected','尚未选择仓库'):t('No repositories added','尚未添加仓库')}>{repositoryState!=='opening'&&<>{repositoryState==='unavailable'?<span>{t('The repository folder no longer exists or cannot be accessed. Choose another repository from the Workbench sidebar.','仓库目录不存在或暂时无法访问。请从 Workbench 左侧选择其他仓库。')}</span>:hasRepositories?<span>{t('Choose a repository from the Workbench sidebar to begin.','请从 Workbench 左侧选择一个仓库开始。')}</span>:<span>{t('Scan a folder and choose which Git repositories AlwayGit should manage. Scanning does not add them automatically.','扫描文件夹并选择要由 AlwayGit 管理的 Git 仓库。扫描不会自动添加。')}</span>}<Button className={!hasRepositories?'primary':''} icon="folder-opened" onClick={()=>void addRepository()}>{hasRepositories?t('Add Repositories…','添加仓库…'):t('Find and Add Repositories…','查找并添加仓库…')}</Button></>}</Empty>:<>
        <div className="top-panels"><History context={showContext} checkout={checkout} checkoutBranch={(name,remote)=>void checkoutBranch(name,remote)}/><ResizeHandle axis="x" label="Resize details panel" value={layout.details} min={230} max={480} reverse onChange={details=>state.setLayout({details})}/><Details open={open} edit={()=>void edit()} context={showContext}/></div>
        {!layout.diffCollapsed&&<ResizeHandle axis="y" label="Resize Diff panel" value={diffHeight} min={130} max={maxDiffHeight} reverse onChange={diff=>state.setLayout({diff})}/>}<DiffPreview native={native} edit={()=>void edit()}/>
      </>}
    </main></div>
    <footer className="statusbar" role="status"><span>{state.busy?state.activity:state.historyLoading?t('Loading history…','正在读取历史…'):state.notice??t('Ready','就绪')}</span><span>{layout.font}px / {effectiveRowHeight(layout)}px · Workbench</span></footer>
    {dialog&&snapshot&&!state.checkoutFailure&&!state.operationReview&&<ActionDialog key={`${state.repoId}-${dialog.type}-${dialog.target}-${dialog.sources?.join('|')}-${dialog.names?.join('|')}-${dialog.remoteBranches?.join('|')}-${dialog.pop}`} dialog={dialog} onClose={()=>setDialog(undefined)} openAbort={()=>open({type:'operation.abort'})}/>}
    {state.operationReview&&snapshot&&<OperationReviewDialog key={state.operationReview.review.token} edit={path=>void edit({kind:'change',path,area:'staged'})}/>}
    {context&&menu&&<ContextMenu x={context.x} y={context.y} caption={menu.caption} items={menu.items} close={closeMenu}/>}
    {repositoryFetch&&<RepositoryFetchDialog repositories={repositoryFetch} onClose={()=>setRepositoryFetch(undefined)}/>}
    {state.checkoutFailure&&snapshot&&<CheckoutFailureDialog onClose={()=>{setDialog(undefined);useWorkbench.setState({checkoutFailure:undefined,error:undefined});}} host={host}/>}
    {state.settingsBaseline&&<SettingsDialog theme={theme}/>}
  </div>;
}

function RepositoryFetchDialog({repositories,onClose}:{repositories:Repository[];onClose():void}) {
  const state=useWorkbench(),t=useTranslation(),[busy,setBusy]=useState(false),[failure,setFailure]=useState<string>();
  const run=async()=>{setBusy(true);setFailure(undefined);const results=await Promise.allSettled(repositories.map(repository=>rpc('action',repository.id,{type:'fetch'}))),failed=results.flatMap((result,index)=>result.status==='rejected'?[`${repositories[index].name}: ${result.reason instanceof Error?result.reason.message:String(result.reason)}`]:[]);await state.loadRepositoryStatuses();if(repositories.some(repository=>repository.id===useWorkbench.getState().repoId))await useWorkbench.getState().refresh({background:true});if(failed.length){setFailure(failed.join('\n'));setBusy(false);return;}useWorkbench.setState({notice:t(repositories.length===1?'Fetch completed.':`Fetched ${repositories.length} repositories.`,repositories.length===1?'Fetch 完成。':`已 Fetch ${repositories.length} 个仓库。`)});onClose();};
  return <Modal title={t(repositories.length===1?'Fetch Repository':`Fetch ${repositories.length} Repositories`,repositories.length===1?'Fetch 仓库':`Fetch ${repositories.length} 个仓库`)} busy={busy} onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>{t('Cancel','取消')}</Button><Button className="primary" disabled={busy} onClick={()=>void run()}>{busy?t('Fetching…','正在 Fetch…'):'Fetch'}</Button></>}><p>{t('Fetch the selected repositories without changing the repository open in this tab.','Fetch 所选仓库，不切换当前标签页中打开的仓库。')}</p><div className="repository-batch-list">{repositories.map(repository=><div key={repository.id}><strong>{repository.name}</strong><span>{repository.root}</span></div>)}</div>{failure&&<pre className="warning-text" role="alert">{failure}</pre>}</Modal>;
}

function CheckoutFailureDialog({onClose,host}:{onClose():void;host(method:RpcRequest['method'],payload?:unknown):Promise<void>}) {
  const state=useWorkbench(),failure=state.checkoutFailure!,t=useTranslation(),canStash=failure.reason==='local-changes'&&!failure.stashCreated;
  const reason=failure.reason==='worktree-occupied'?t('The branch is in use by another Worktree.','分支正在被其他 Worktree 使用。'):failure.reason==='conflicts'?t('Resolve conflicts before Checkout.','请先解决冲突，再 Checkout。'):failure.reason==='operation-active'?t('Complete or Abort the active Git operation before Checkout.','请先完成或 Abort 当前 Git 操作。'):failure.stashCreated?t('Stash was saved, but Checkout failed. The Stash is preserved.','Stash 已保存，但 Checkout 失败；保存内容已保留。'):failure.reason==='local-changes'?t('Checkout would overwrite local changes.','Checkout 可能覆盖未提交修改。'):t('Git could not complete Checkout. See the details below.','Git 无法完成 Checkout，请查看下方详情。');
  return <Modal title={t('Checkout Blocked','无法 Checkout')} busy={state.busy} onClose={onClose} footer={<><Button disabled={state.busy} onClick={onClose}>{t('Cancel','取消')}</Button>{canStash&&<Button className="primary" disabled={state.busy} onClick={()=>{const repoId=state.repoId;void state.execute(failure.trackBranches?{type:'branch.track',branches:failure.trackBranches,checkout:true,stashFirst:true,includeUntracked:true}:{type:'checkout.stash',target:failure.target,detached:failure.detached,includeUntracked:true}).then(success=>{if(success){const latest=useWorkbench.getState();if(latest.repoId===repoId&&latest.snapshot?.head)void latest.selectCommit(latest.snapshot.head);onClose();}});}}>Stash Changes &amp; Checkout</Button>}</>}>
    <strong>Checkout {failure.target}</strong><p className="warning-text" role="alert">{reason}</p><div className="discard-paths">{failure.paths.map(path=><div key={path}>{path}</div>)}</div>{failure.worktreePath&&<Button onClick={()=>{onClose();void host('openWorktree',{path:failure.worktreePath,newWindow:false});}}>Open Worktree</Button>}{!!failure.paths.length&&<Button onClick={()=>{const path=failure.paths[0];onClose();state.selectWorking();const file=state.snapshot?.changes.find(f=>f.path===path);if(file)state.selectFile({kind:'change',path,area:file.conflict?'conflict':file.untracked||file.worktreeStatus!==' '?'unstaged':'staged'});}}>{t('View Affected Files','查看受影响文件')}</Button>}<p className="muted">{state.error}</p>
  </Modal>;
}
