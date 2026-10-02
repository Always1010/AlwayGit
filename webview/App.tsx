import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { Repository, RpcRequest } from '../src/protocol/types';
import { connected, demoMode, rpc } from './rpc';
import { useWorkbench } from './store';
import { useWorkbenchFields } from './subscriptions';
import { diffRowHeight, effectiveRowHeight, fileRowHeight, isLightTheme, textColorForBackground, useResolvedTheme } from './appearance';
import { SettingsDialog } from './SettingsDialog';
import { useTranslation } from './i18n';
import { ActionDialog } from './ActionDialog';
import type { DialogRequest } from './ActionDialog';
import { ContextMenu } from './ContextMenu';
import { RepositoryDialog } from './RepositoryDialog';
import { RepositoryRemoveDialog } from './RepositoryRemoveDialog';
import { menuFor } from './menus';
import type { MenuApi, MenuTarget } from './menus';
import type { RepositoryGroup } from '../src/protocol/repositories';
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
import { useShortcuts, useWorkbenchKeyboard } from './shortcuts';

const HelpDialog = lazy(() => import('./HelpDialog'));

export function App() {
  const state=useWorkbenchFields('repoId','language','operationSettings','appearance','layout','snapshot','loading','repositories','busy','diffTarget','notice','error','actionFeedback','checkoutFailure','stashApplyFailure','operationReview','settingsBaseline','locateHead','refresh','execute','selectWorking','restoreLayout','beginSettings','setLayout'),t=useTranslation(),[dialog,setDialog]=useState<DialogRequest>(),[repositoryDialog,setRepositoryDialog]=useState(false),[repositoryRemoval,setRepositoryRemoval]=useState<RepositoryGroup[]>(),[repositoryFetch,setRepositoryFetch]=useState<Repository[]>(),[context,setContext]=useState<{x:number;y:number;target:MenuTarget;anchor:HTMLElement}>();
  const mainPanel=useRef<HTMLElement>(null),[mainPanelHeight,setMainPanelHeight]=useState(0);
  const [helpOpen,setHelpOpen]=useState(false);
  const showHelp=useCallback(()=>{setContext(undefined);setHelpOpen(true);},[]);
  const theme=useResolvedTheme(state.appearance.theme),lightTheme=isLightTheme(theme);
  const paletteColors=lightTheme?state.appearance.colors.light:state.appearance.colors.dark;
  useEffect(()=>{if(connected)void useWorkbench.getState().initialize();},[]);
  useEffect(()=>{setDialog(undefined);setContext(undefined);},[state.repoId,state.language]);
  const closeMenu=useCallback(()=>setContext(undefined),[]);
  const host=useCallback(async(method:RpcRequest['method'],payload?:unknown,repoId?:string)=>{
    const current=useWorkbench.getState();try{await rpc(method,repoId??current.repoId,payload);if(demoMode&&method!=='copyText')useWorkbench.setState({notice:current.language==='zh-CN'?'模拟原生 VS Code 操作；未修改实际文件。':'Demo: native VS Code command preview.'});if(method==='copyText')useWorkbench.setState({notice:current.language==='zh-CN'?'已复制。':'Copied.'});}catch(error){current.report(error);}
  },[]);
  const addRepository=useCallback(async()=>{setContext(undefined);setRepositoryDialog(true);},[]);
  const open=useCallback((request:DialogRequest)=>{setContext(undefined);useWorkbench.setState({error:undefined,checkoutFailure:undefined,stashApplyFailure:undefined});setDialog(request);},[]);
  const showContext:ContextHandler=useCallback((event,target)=>{
    event.preventDefault();event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();
    const point='clientX' in event&&event.clientX!==0?{x:event.clientX,y:event.clientY}:{x:rect.left+Math.min(40,rect.width/2),y:rect.bottom};
    setContext({...point,target,anchor:event.currentTarget as HTMLElement});
  },[]);
  const checkoutBranch=useCallback(async(name:string,remote=false)=>{const state=useWorkbench.getState();if(state.busy||!remote&&name===state.snapshot?.branch)return;if(remote){const ref=state.snapshot?.refs.find(ref=>ref.fullName===name);if(ref&&!ref.symbolicTarget&&(ref.targetType===undefined||ref.targetType==='commit'))open({type:'branch.track',target:name,checkout:true});return;}setDialog(undefined);const repoId=state.repoId;if(await state.execute({type:'branch.checkout',name})&&useWorkbench.getState().repoId===repoId){const head=useWorkbench.getState().snapshot?.head;if(head)void state.selectCommit(head);}},[open]);
  const checkout=useCallback((oid:string)=>{
    const state=useWorkbench.getState();
    const candidates=state.snapshot?.refs.filter(r=>r.kind==='local'&&r.oid===oid)??[];
    if(candidates.length===1)void checkoutBranch(candidates[0].name);
    else if(candidates.length>1)open({type:'branch.checkout',target:candidates[0].name,candidates:candidates.map(r=>r.name)});
    else open({type:'branch.create',target:oid,checkout:true,requireCheckout:true});
  },[checkoutBranch,open]);
  const edit=useCallback(async(target=useWorkbench.getState().diffTarget)=>{const current=useWorkbench.getState();if(!target)return;if(target.kind==='comparison'){await host('diff',target,current.repoId);return;}try{await rpc('openFile',current.repoId,{path:target.path});if(demoMode)useWorkbench.setState({notice:current.language==='zh-CN'?'模拟：在 VS Code 中编辑。':'Demo: edit in VS Code.'});}catch(error){if(target.kind==='commit')await host('diff',target,current.repoId);else current.report(error);}},[host]);
  const editSelected=useCallback(()=>void edit(),[edit]);
  const native=useCallback(()=>{const state=useWorkbench.getState();if(state.diffTarget)void host('diff',state.diffTarget);},[host]);
  const openWorktree=useCallback((path:string)=>void host('openWorktree',{path,newWindow:false}),[host]);
  const startCommit=useCallback(()=>{const current=useWorkbench.getState(),repoId=current.repoId;current.selectWorking();requestAnimationFrame(()=>{if(useWorkbench.getState().repoId===repoId)document.getElementById('ag-commit-message')?.focus();});},[]);
  const showSettings=useCallback(()=>{setContext(undefined);useWorkbench.getState().beginSettings();},[]);
  const openRepository=useCallback(()=>void host('openProject'),[host]);
  useWorkbenchKeyboard(!!(dialog||repositoryDialog||repositoryRemoval||repositoryFetch||context||helpOpen||state.settingsBaseline||state.checkoutFailure||state.operationReview));
  useLayoutEffect(()=>{const element=mainPanel.current;if(!element)return;const measure=()=>setMainPanelHeight(element.clientHeight);measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();},[]);
  const snapshot=state.snapshot,layout=state.layout,unpushed=snapshot?.unpushed??snapshot?.ahead??0,repositoryState=repositoryViewState(snapshot,!!state.repoId,state.loading),hasRepositories=state.repositories.length>0;
  const canOperate=!!snapshot&&!state.busy,canPush=canOperate&&!!snapshot?.branch,canStash=canOperate&&!!snapshot?.changes.length&&!snapshot?.operation.kind;
  useShortcuts({
    refresh:{enabled:canOperate,run:()=>void state.refresh()},
    fetch:{enabled:canOperate,run:()=>void state.execute({type:'fetch'})},
    pull:{enabled:canOperate,run:()=>open({type:'pull'})},
    push:{enabled:canPush,run:()=>open({type:'push'})},
    commit:{enabled:canOperate,run:startCommit},
    stash:{enabled:canStash,run:()=>open({type:'stash.create'})},
    working:{enabled:!!snapshot,run:state.selectWorking},
    head:{enabled:!!snapshot?.head,run:state.locateHead},
    repository:{enabled:!!snapshot,run:openRepository},
    settings:{enabled:true,run:showSettings},help:{enabled:true,run:showHelp},
  });
  const branchLabel=repositoryState==='branch'?snapshot!.branch!:repositoryState==='detached'?snapshot?.head?.slice(0,8)??'Detached':repositoryState==='opening'?t('Opening…','正在打开…'):repositoryState==='unavailable'?t('Unavailable','不可用'):'—';
  const branchState=repositoryState==='branch'?t(`Current branch: ${snapshot!.branch}`,`当前分支：${snapshot!.branch}`):repositoryState==='detached'?'Detached HEAD':repositoryState==='opening'?t('Opening repository…','正在打开仓库…'):repositoryState==='unavailable'?t('Repository unavailable','仓库不可用'):t('No repository selected','尚未选择仓库');
  const branchTitle=snapshot?[snapshot.repository.name,branchState,snapshot.upstream?t(`Upstream: ${snapshot.upstream}`,`上游分支：${snapshot.upstream}`):undefined].filter(Boolean).join('\n'):branchState;
  const maxDiffHeight=Math.max(130,(mainPanelHeight||576)-126),diffHeight=Math.min(layout.diff,maxDiffHeight);
  const menuApi=useMemo<MenuApi>(()=>({open,checkout,openDiff:target=>void host('diff',target),editFile:target=>void edit(target),host,addRepository,removeRepositories:groups=>{setContext(undefined);setRepositoryRemoval(groups);},fetchRepositories:repositories=>setRepositoryFetch(repositories)}),[open,checkout,host,edit,addRepository]);
  const sidebarActions=useCallback((target:MenuTarget)=>menuFor(target,menuApi).items,[menuApi]);
  const menu=context?menuFor(context.target,menuApi):undefined;
  if(!connected)return <div className="connection-screen"><Icon name="git-branch"/><h1>AlwayGit</h1><p>{t('Your Git workbench, inside VS Code.','VS Code 中的 Git 工作台。')}</p><a className="button primary" href="?demo=1">{t('Explore Demo','查看示例')}</a></div>;
  return <div className="workbench layout-workbench" data-testid="workbench" data-theme={theme} tabIndex={-1} onContextMenu={event=>{if(event.defaultPrevented)return;const target=event.target as HTMLElement,editable=!!target.closest('input:not([type=checkbox]),textarea,[contenteditable]:not([contenteditable="false"])'),selection=window.getSelection();if(!editable&&(!selection||selection.isCollapsed))event.preventDefault();}} style={{'--sidebar-width':`${layout.sidebar}px`,'--details-width':`${layout.details}px`,'--diff-height':`${layout.diff}px`,'--workbench-font':`${layout.font}px`,'--row-height':`${effectiveRowHeight(layout)}px`,'--file-row-height':`${fileRowHeight(layout.font,state.appearance.fileSpacing)}px`,'--file-row-padding':`${state.appearance.fileSpacing}px`,'--control-height':`${Math.max(24,Math.round(layout.font*1.35)+6)}px`,'--diff-font':`${state.appearance.codeFont}px`,'--diff-row-height':`${diffRowHeight(state.appearance.codeFont,state.appearance.codeRowHeight)}px`,'--notification-badge':state.appearance.badgeColor,'--notification-badge-fg':textColorForBackground(state.appearance.badgeColor),'--graph-main':lightTheme?state.appearance.mainColors.light:state.appearance.mainColors.dark,...Object.fromEntries(paletteColors.map((color,index)=>[`--graph-lane-${index}`,color]))} as React.CSSProperties}>
    <header className="app-chrome"><strong className="brand"><Icon name="git-branch"/>AlwayGit</strong><span className="workbench-tab">{t('Git Workbench','Git 工作台')}</span>{demoMode&&<span className="muted">{t('Demo Repository','模拟仓库')}</span>}<div className="toolbar-spacer"/><Button className="icon-only" icon="split-horizontal" title={t('New Workbench Tab','新建 Workbench 标签页')} aria-label={t('New Workbench Tab','新建 Workbench 标签页')} onClick={()=>void host('openWorkbench',{newTab:true})}/><Button className="icon-only" icon="window" title={t('Open Workbench in New Window','在新窗口打开 Workbench')} aria-label={t('Open Workbench in New Window','在新窗口打开 Workbench')} onClick={()=>void host('openWorkbench',{newWindow:true})}/><Button className="icon-only" icon="layout" title={t('Restore Layout','恢复布局')} aria-label={t('Restore Layout','恢复布局')} onClick={state.restoreLayout}/><Button className="icon-only help-trigger" icon="question" shortcut="help" title={t('Help & Guide','帮助与指南')} aria-label={t('Help & Guide','帮助与指南')} onClick={showHelp}/><Button className="icon-only settings-trigger" icon="settings-gear" shortcut="settings" title={t('Settings','设置')} aria-label={t('Settings','设置')} onClick={showSettings}/></header>
    <div className="toolbar">
      <span className="branch-identity toolbar-branch" title={branchTitle}><Icon name="git-branch"/><strong data-testid="current-branch">{branchLabel}</strong></span><span className="toolbar-divider"/>
      <Button icon="cloud-download" shortcut="fetch" disabled={!canOperate} onClick={()=>void state.execute({type:'fetch'})}>Fetch</Button><Button icon="arrow-down" shortcut="pull" title="Pull" disabled={!canOperate} onClick={()=>open({type:'pull'})}>Pull{snapshot?.behind?` (${snapshot.behind})`:''}</Button><Button icon="arrow-up" shortcut="push" disabled={!canPush} aria-label={unpushed?t(`Push, ${unpushed} unpushed commits`,`Push，${unpushed} 个未推送提交`):'Push'} title={!snapshot?.branch?t('Push requires a local branch.','Push 需要当前处于本地分支。'):snapshot&&!(snapshot.remotes?.length)?t('Add a remote before Push.','Push 前需要先添加远端。'):undefined} onClick={()=>open({type:'push'})}>Push{unpushed?<span className="notification-badge" aria-hidden="true">{unpushed>99?'99+':unpushed}</span>:null}</Button><Button icon="refresh" shortcut="refresh" title={t('Refresh current repository status and history','刷新当前仓库状态和提交历史')} aria-label={t('Refresh current repository status and history','刷新当前仓库状态和提交历史')} disabled={!canOperate} onClick={()=>void state.refresh()}/><span className="toolbar-divider"/>
      <Button className="commit-trigger" icon="git-commit" shortcut="commit" disabled={!canOperate} onClick={startCommit}>Commit</Button><span className="toolbar-divider"/>
      <Button icon="archive" shortcut="stash" disabled={!canStash} onClick={()=>open({type:'stash.create'})}>Stash All Changes…</Button>
      <div className="toolbar-spacer"/><div className="toolbar-repository-actions"><Button className="icon-only toolbar-special" icon="location" shortcut="head" title={t('Locate the current commit (HEAD)','定位当前提交（HEAD）')} aria-label={t('Locate HEAD','定位 HEAD')} disabled={!snapshot?.head} onClick={state.locateHead}/><Button className="icon-only toolbar-special open-repository" shortcut="repository" data-testid="open-project" title={snapshot?`${t('Open Repository Folder','打开当前仓库文件夹')}\n${t('Switches to its VS Code window when already open.','如果已经打开，则切换到对应的 VS Code 窗口。')}\n${snapshot.repository.root}`:t('Select a repository first','请先选择仓库')} aria-label={t('Open Repository Folder','打开当前仓库文件夹')} disabled={!snapshot} onClick={openRepository}><OpenRepositoryFolderIcon/></Button></div>
    </div>
    <OperationNotice abort={()=>open({type:'operation.abort'})}/>
    <ActionFeedbackBar showLog={()=>void host('showLog')}/>
    {state.notice&&!state.busy&&!state.actionFeedback&&<div className="banner notice" role="status"><Icon name="info"/><span>{state.notice}</span><Button className="icon-only" icon="close" title={t('Dismiss notification','关闭提醒')} aria-label={t('Dismiss notification','关闭提醒')} onClick={()=>useWorkbench.setState({notice:undefined})}/></div>}
    {state.error&&state.error!==state.actionFeedback?.error&&!state.checkoutFailure&&!state.stashApplyFailure&&<div className="banner error" role="alert"><Icon name="error"/><span>{state.error}</span><Button onClick={()=>void host('showLog')}>{t('Show Log','查看日志')}</Button><Button icon="close" aria-label="Dismiss error" onClick={()=>useWorkbench.setState({error:undefined})}/></div>}
    <div className="workspace"><Sidebar context={showContext} actions={sidebarActions} checkoutBranch={checkoutBranch} openWorktree={openWorktree}/><ResizeHandle axis="x" label="Resize repository sidebar" value={layout.sidebar} min={160} max={360} onChange={sidebar=>state.setLayout({sidebar})}/><main ref={mainPanel} className={`main-panel${layout.diffCollapsed?' diff-collapsed':''}`} style={{'--diff-height':`${diffHeight}px`} as React.CSSProperties}>
      {!snapshot?<Empty title={repositoryState==='opening'?t('Opening repository…','正在打开仓库…'):repositoryState==='unavailable'?t('Repository unavailable','仓库不可用'):hasRepositories?t('No repository selected','尚未选择仓库'):t('No repositories added','尚未添加仓库')}>{repositoryState!=='opening'&&<>{repositoryState==='unavailable'?<span>{t('The repository folder no longer exists or cannot be accessed. Choose another repository from the Workbench sidebar.','仓库目录不存在或暂时无法访问。请从 Workbench 左侧选择其他仓库。')}</span>:hasRepositories?<span>{t('Choose a repository from the Workbench sidebar to begin.','请从 Workbench 左侧选择一个仓库开始。')}</span>:<span>{t('Scan a folder and choose which Git repositories AlwayGit should manage. Scanning does not add them automatically.','扫描文件夹并选择要由 AlwayGit 管理的 Git 仓库。扫描不会自动添加。')}</span>}<Button className={!hasRepositories?'primary':''} icon="folder-opened" onClick={()=>void addRepository()}>{hasRepositories?t('Add Repositories…','添加仓库…'):t('Find and Add Repositories…','查找并添加仓库…')}</Button><Button icon="question" onClick={showHelp}>{t('Quick start','快速开始')}</Button></>}</Empty>:<>
        <div className="top-panels"><History context={showContext} checkout={checkout} checkoutBranch={checkoutBranch}/><ResizeHandle axis="x" label="Resize details panel" value={layout.details} min={230} max={480} reverse onChange={details=>state.setLayout({details})}/><Details open={open} edit={editSelected} context={showContext}/></div>
        {!layout.diffCollapsed&&<ResizeHandle axis="y" label="Resize Diff panel" value={diffHeight} min={130} max={maxDiffHeight} reverse onChange={diff=>state.setLayout({diff})}/>}<DiffPreview native={native} edit={editSelected}/>
      </>}
    </main></div>
    {dialog&&snapshot&&!state.checkoutFailure&&!state.operationReview&&<ActionDialog key={`${state.repoId}-${dialog.type}-${dialog.target}-${dialog.sources?.join('|')}-${dialog.names?.join('|')}-${dialog.remoteBranches?.join('|')}-${dialog.pop}`} dialog={dialog} onClose={()=>setDialog(undefined)} openAbort={()=>open({type:'operation.abort'})} replaceDialog={setDialog}/>}
    {repositoryDialog&&<RepositoryDialog onClose={()=>setRepositoryDialog(false)}/>}
    {repositoryRemoval&&<RepositoryRemoveDialog groups={repositoryRemoval} onClose={()=>setRepositoryRemoval(undefined)}/>}
    {state.operationReview&&snapshot&&<OperationReviewDialog key={state.operationReview.review.token} edit={path=>void edit({kind:'change',path,area:'staged'})}/>}
    {context&&menu&&<ContextMenu x={context.x} y={context.y} caption={menu.caption} items={menu.items} anchor={context.anchor} close={closeMenu}/>}
    {repositoryFetch&&<RepositoryFetchDialog repositories={repositoryFetch} onClose={()=>setRepositoryFetch(undefined)}/>}
    {state.checkoutFailure&&snapshot&&<CheckoutFailureDialog onClose={()=>{setDialog(undefined);useWorkbench.setState({checkoutFailure:undefined,error:undefined});}} host={host}/>}
    {state.settingsBaseline&&<SettingsDialog theme={theme}/>}
    {helpOpen&&<Suspense fallback={null}><HelpDialog onClose={()=>setHelpOpen(false)}/></Suspense>}
  </div>;
}

function OpenRepositoryFolderIcon() {
  return <span className="open-repository-icon" aria-hidden="true"><Icon name="folder" className="repository-folder-back"/><Icon name="folder" className="repository-folder-front"/><Icon name="vscode" className="repository-folder-vscode"/></span>;
}

function RepositoryFetchDialog({repositories,onClose}:{repositories:Repository[];onClose():void}) {
  const state=useWorkbench(),t=useTranslation(),[busy,setBusy]=useState(false),[failure,setFailure]=useState<string>();
  const run=async()=>{setBusy(true);setFailure(undefined);const results=await Promise.allSettled(repositories.map(repository=>rpc('action',repository.id,{type:'fetch'}))),failed=results.flatMap((result,index)=>result.status==='rejected'?[`${repositories[index].name}: ${result.reason instanceof Error?result.reason.message:String(result.reason)}`]:[]);await state.loadRepositoryStatuses();if(repositories.some(repository=>repository.id===useWorkbench.getState().repoId))await useWorkbench.getState().refresh({background:true});if(failed.length){setFailure(failed.join('\n'));setBusy(false);return;}useWorkbench.setState({notice:t(repositories.length===1?'Fetch completed.':`Fetched ${repositories.length} repositories.`,repositories.length===1?'Fetch 完成。':`已 Fetch ${repositories.length} 个仓库。`)});onClose();};
  return <Modal title={t(repositories.length===1?'Fetch Repository':`Fetch ${repositories.length} Repositories`,repositories.length===1?'Fetch 仓库':`Fetch ${repositories.length} 个仓库`)} busy={busy} onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>{t('Cancel','取消')}</Button><Button className="primary" disabled={busy} onClick={()=>void run()}>{busy?t('Fetching…','正在 Fetch…'):'Fetch'}</Button></>}><p>{t('Fetch the selected repositories without changing the repository open in this tab.','Fetch 所选仓库，不切换当前标签页中打开的仓库。')}</p><div className="repository-batch-list">{repositories.map(repository=><div key={repository.id}><strong>{repository.name}</strong><span>{repository.root}</span></div>)}</div>{failure&&<pre className="warning-text" role="alert">{failure}</pre>}</Modal>;
}

function CheckoutFailureDialog({onClose,host}:{onClose():void;host(method:RpcRequest['method'],payload?:unknown):Promise<void>}) {
  const state=useWorkbench(),failure=state.checkoutFailure!,t=useTranslation(),canStash=failure.reason==='local-changes'&&!failure.stashCreated&&(!failure.detached||state.operationSettings.allowDetachedHead);
  const reason=failure.reason==='worktree-occupied'?t('The branch is in use by another Worktree.','分支正在被其他 Worktree 使用。'):failure.reason==='conflicts'?t('Resolve conflicts before Checkout.','请先解决冲突，再 Checkout。'):failure.reason==='operation-active'?t('Complete or Abort the active Git operation before Checkout.','请先完成或 Abort 当前 Git 操作。'):failure.stashCreated?t('Stash was saved, but Checkout failed. The Stash is preserved.','Stash 已保存，但 Checkout 失败；保存内容已保留。'):failure.reason==='local-changes'?t('Checkout would overwrite local changes.','Checkout 可能覆盖未提交修改。'):t('Git could not complete Checkout. See the details below.','Git 无法完成 Checkout，请查看下方详情。');
  return <Modal title={t('Checkout Blocked','无法 Checkout')} busy={state.busy} onClose={onClose} footer={<><Button disabled={state.busy} onClick={onClose}>{t('Cancel','取消')}</Button>{canStash&&<Button className="primary" disabled={state.busy} onClick={()=>{const repoId=state.repoId;void state.execute(failure.trackBranches?{type:'branch.track',branches:failure.trackBranches,checkout:true,stashFirst:true,includeUntracked:true}:{type:'checkout.stash',target:failure.target,detached:failure.detached,includeUntracked:true}).then(success=>{if(success){const latest=useWorkbench.getState();if(latest.repoId===repoId&&latest.snapshot?.head)void latest.selectCommit(latest.snapshot.head);onClose();}});}}>Stash Changes &amp; Checkout</Button>}</>}>
    <strong>Checkout {failure.target}</strong>{failure.branchCreated&&<p role="status">{t(`Branch ${failure.target} was created and retained. You have not switched to it.`,`分支 ${failure.target} 已创建并保留，尚未切换到该分支。`)}</p>}<p className="warning-text" role="alert">{reason}</p><div className="discard-paths">{failure.paths.map(path=><div key={path}>{path}</div>)}</div>{failure.worktreePath&&<Button onClick={()=>{onClose();void host('openWorktree',{path:failure.worktreePath,newWindow:false});}}>Open Worktree</Button>}{!!failure.paths.length&&<Button onClick={()=>{const path=failure.paths[0];onClose();state.selectWorking();const file=state.snapshot?.changes.find(f=>f.path===path);if(file)state.selectFile({kind:'change',path,area:file.conflict?'conflict':file.untracked||file.worktreeStatus!==' '?'unstaged':'staged'});}}>{t('View Affected Files','查看受影响文件')}</Button>}<p className="muted">{state.error}</p>
  </Modal>;
}
