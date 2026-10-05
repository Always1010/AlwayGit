import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isStaged, isUnstaged } from './changeEntries';
import type { CommitSelection } from '../src/protocol/types';
import { SettingsDialog } from './SettingsDialog';
import { ActionDialog } from './ActionDialog';
import { ContextMenu } from './ContextMenu';
import { RepositoryDialog } from './RepositoryDialog';
import { RepositoryRemoveDialog } from './RepositoryRemoveDialog';
import { Sidebar } from './Sidebar';
import { RepositoryCatalogStatus } from './RepositoryCatalogStatus';
import { History } from './History';
import { Details } from './Details';
import { BottomDock } from './BottomDock';
import { ActionFeedbackBar } from './ActionFeedbackBar';
import { blocksWorkbench } from './actionFeedback';
import { OperationProgress } from './OperationProgress';
import { RemoteRequestDialog } from './RemoteRequestDialog';
import { OperationNotice } from './OperationNotice';
import { OperationReviewDialog } from './OperationReviewDialog';
import { CommitDialog } from './CommitDialog';
import { Button, Empty, Icon, Modal, ResizeHandle } from './ui';

import { translate, uiText } from './text';

import type React from 'react';
import type { OpenProjectResult, Repository, RpcRequest } from '../src/protocol/types';
import { connected, demoMode, flushSession, rpc } from './rpc';
import { useWorkbench } from './store';
import { useWorkbenchFields } from './subscriptions';
import { diffRowHeight, effectiveRowHeight, fileRowHeight, isLightTheme, textColorForBackground, useResolvedTheme } from './appearance';

import { useTranslation } from './i18n';

import type { DialogRequest } from './ActionDialog';

import { menuFor } from './menus';
import { useCherryPickCheck } from './useCherryPickCheck';
import type { MenuApi, MenuTarget } from './menus';
import type { RepositoryGroup } from '../src/protocol/repositories';

import type { ContextHandler } from './Sidebar';

import { repositoryViewState } from './repositoryState';
import { useShortcuts, useWorkbenchKeyboard } from './shortcuts';

const HelpDialog = lazy(() => import('./HelpDialog'));

export function App() {
  const state=useWorkbenchFields('repoId','language','changeListMode','operationSettings','appearance','layout','snapshot','loading','catalogState','catalogError','repositories','busy','activity','diffTarget','notice','error','actionFeedback','checkoutFailure','stashApplyFailure','remoteRequest','operationReview','settingsBaseline','locateHead','refresh','execute','selectWorking','restoreLayout','beginSettings','setLayout'),t=useTranslation(),[dialog,setDialog]=useState<DialogRequest>(),[repositoryDialog,setRepositoryDialog]=useState(false),[repositoryRemoval,setRepositoryRemoval]=useState<RepositoryGroup[]>(),[repositoryFetch,setRepositoryFetch]=useState<Repository[]>(),[context,setContext]=useState<{x:number;y:number;target:MenuTarget;anchor:HTMLElement}>();
  const progressFeedback = state.actionFeedback?.status === 'running' ? state.actionFeedback : undefined;
  const blockInteraction = state.busy && state.actionFeedback?.status !== 'error' && blocksWorkbench(progressFeedback?.action ?? state.activity);
  const mainPanel=useRef<HTMLElement>(null),[mainPanelHeight,setMainPanelHeight]=useState(0);
  const root = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [region, setRegion] = useState<'repositories' | 'history' | 'details' | 'diff'>('repositories');
  const docked = window.__ALWAYGIT_HOST__ === 'docked';
  useLayoutEffect(() => {
    const element = root.current; if (!element || !docked) return;
    const measure = () => setCompact(element.clientWidth < 600 || element.clientHeight < 440);
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [docked]);
  const [helpOpen,setHelpOpen]=useState(false);
  const [projectNotice,setProjectNotice]=useState<Extract<OpenProjectResult,{kind:'current-window'}>>();
  const projectRequest=useRef(0);
  useEffect(()=>{projectRequest.current++;setProjectNotice(undefined);return()=>{projectRequest.current++;};},[state.repoId]);
  useEffect(()=>{
    if(!projectNotice)return;
    const timer=setTimeout(()=>setProjectNotice(undefined),3000);
    return()=>clearTimeout(timer);
  },[projectNotice]);
  const [commitRepoId,setCommitRepoId]=useState<string>();
  const [commitFiles,setCommitFiles]=useState<CommitSelection[]>();
  const showHelp=useCallback(()=>{setContext(undefined);setHelpOpen(true);},[]);
  const theme=useResolvedTheme(state.appearance.theme),lightTheme=isLightTheme(theme);
  const paletteColors=lightTheme?state.appearance.colors.light:state.appearance.colors.dark;
  useLayoutEffect(()=>{document.documentElement.lang=state.language;},[state.language]);
  useEffect(()=>{if(connected){if(!demoMode)void rpc('workbenchReady').catch(useWorkbench.getState().report);void useWorkbench.getState().initialize();}},[]);
  useEffect(()=>{setDialog(undefined);setContext(undefined);},[state.repoId,state.language]);
  useEffect(()=>{setCommitRepoId(undefined);},[state.repoId]);
  const closeMenu=useCallback(()=>setContext(undefined),[]);
  const host=useCallback(async(method:RpcRequest['method'],payload?:unknown,repoId?:string)=>{
    const current=useWorkbench.getState();try{await rpc(method,repoId??current.repoId,payload);if(demoMode&&method!=='copyText')useWorkbench.setState({notice:translate(current.language, "workbench.demoNativeVSCodeCommandPreview")});}catch(error){current.report(error);}
  },[]);
  const addRepository=useCallback(async()=>{if(useWorkbench.getState().catalogState!=='ready')return;setContext(undefined);setRepositoryDialog(true);},[]);
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
  const edit=useCallback(async(target=useWorkbench.getState().diffTarget)=>{const current=useWorkbench.getState();if(!target)return;if(target.kind==='comparison'){await host('diff',target,current.repoId);return;}try{await rpc('openFile',current.repoId,{path:target.path});if(demoMode)useWorkbench.setState({notice:translate(current.language, "workbench.demoEditInVSCode")});}catch(error){if(target.kind==='commit')await host('diff',target,current.repoId);else current.report(error);}},[host]);
  const editSelected=useCallback(()=>void edit(),[edit]);
  const native=useCallback(()=>{const state=useWorkbench.getState();if(state.diffTarget)void host('diff',state.diffTarget);},[host]);
  const openWorktree=useCallback((path:string)=>void host('openWorktree',{path,newWindow:false}),[host]);
  const startCommit=useCallback((files?:CommitSelection[])=>{const current=useWorkbench.getState();if(!current.repoId||!current.snapshot||current.busy)return;setContext(undefined);setDialog(undefined);current.selectWorking();setCommitFiles(files);setCommitRepoId(current.repoId);},[]);
  const closeCommit=useCallback((repoId:string)=>{flushSession();setCommitRepoId(current=>current===repoId?undefined:current);},[]);
  const showSettings=useCallback(()=>{setContext(undefined);useWorkbench.getState().beginSettings();},[]);
  const openRepository=useCallback(()=>{
    const current=useWorkbench.getState(),repoId=current.repoId,request=++projectRequest.current;
    setProjectNotice(undefined);
    void rpc<OpenProjectResult|undefined>('openProject',repoId).then(result=>{
      if(request!==projectRequest.current||useWorkbench.getState().repoId!==repoId)return;
      if(result?.kind==='current-window')setProjectNotice(result);
      else if(demoMode)useWorkbench.setState({notice:translate(current.language,"workbench.demoNativeVSCodeCommandPreview")});
    }).catch(error=>{
      if(request===projectRequest.current&&useWorkbench.getState().repoId===repoId)current.report(error);
    });
  },[]);
  useWorkbenchKeyboard(blockInteraction || !!(state.remoteRequest||commitRepoId||dialog||repositoryDialog||repositoryRemoval||repositoryFetch||context||helpOpen||state.settingsBaseline||state.checkoutFailure||state.operationReview));
  useLayoutEffect(()=>{const element=mainPanel.current;if(!element)return;const measure=()=>setMainPanelHeight(element.clientHeight);measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();},[]);
  const snapshot=state.snapshot,layout=state.layout,unpushed=snapshot?.unpushed??snapshot?.ahead??0,repositoryState=repositoryViewState(snapshot,!!state.repoId,state.loading),hasRepositories=state.repositories.length>0;
  const canOperate=!!snapshot&&!state.busy,canPush=canOperate&&!!snapshot?.branch,canStash=canOperate&&!!snapshot?.changes.length&&!snapshot?.operation.kind;
  useShortcuts({
    ...(state.changeListMode==='unified'?{
      stageAll:{enabled:canOperate&&snapshot!.changes.some(isUnstaged),run:()=>open({type:'stage',paths:snapshot!.changes.filter(isUnstaged).map(file=>file.path)})},
      unstageAll:{enabled:canOperate&&snapshot!.changes.some(isStaged),run:()=>open({type:'unstage',paths:snapshot!.changes.filter(isStaged).map(file=>file.path)})},
    }:{}),
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
  const branchLabel=repositoryState==='branch'?snapshot!.branch!:repositoryState==='detached'?snapshot?.head?.slice(0,8)??uiText("workbench.detached"):repositoryState==='opening'?t("workbench.opening"):repositoryState==='unavailable'?t("workbench.unavailable"):'—';
  const branchState=repositoryState==='branch'?t("workbench.currentBranch", { branch: (snapshot!.branch) }):repositoryState==='detached'?uiText("workbench.detachedHEAD"):repositoryState==='opening'?t("workbench.openingRepository"):repositoryState==='unavailable'?t("workbench.repositoryUnavailable"):t("workbench.noRepositorySelected");
  const branchTitle=snapshot?[snapshot.repository.name,branchState,snapshot.upstream?t("workbench.upstream", { upstream: (snapshot.upstream) }):undefined].filter(Boolean).join('\n'):branchState;
  const maxDiffHeight=Math.max(130,(mainPanelHeight||576)-126),diffHeight=Math.min(layout.diff,maxDiffHeight);
  const menuApi=useMemo<MenuApi>(()=>({open,checkout,startCommit,openDiff:target=>void host('diff',target),editFile:target=>void edit(target),host,addRepository,removeRepositories:groups=>{setContext(undefined);setRepositoryRemoval(groups);},fetchRepositories:repositories=>setRepositoryFetch(repositories)}),[open,checkout,startCommit,host,edit,addRepository]);
  const sidebarActions=useCallback((target:MenuTarget)=>menuFor(target,menuApi).items,[menuApi]);
  const cherryPickCheck=useCherryPickCheck(state.repoId,state.snapshot?.head,state.snapshot?.branch,context?.target);
  const menu=context?menuFor(context.target,menuApi,cherryPickCheck):undefined;
  if(!connected)return <div className="connection-screen"><Icon name="git-branch"/><h1>{uiText("workbench.alwayGit")}</h1><p>{t("workbench.yourGitWorkbenchInsideVSCode")}</p><a className="button primary" href="?demo=1">{t("workbench.exploreDemo")}</a></div>;
  return <div ref={root} className="workbench layout-workbench" data-host={docked ? 'docked' : 'editor'} data-compact={compact} data-region={region} data-testid="workbench" data-theme={theme} tabIndex={-1} onContextMenu={event=>{if(event.defaultPrevented)return;const target=event.target as HTMLElement,editable=!!target.closest('input:not([type=checkbox]),textarea,[contenteditable]:not([contenteditable="false"])'),selection=window.getSelection();if(!editable&&(!selection||selection.isCollapsed))event.preventDefault();}} style={{'--sidebar-width':`${layout.sidebar}px`,'--details-width':`${layout.details}px`,'--diff-height':`${layout.diff}px`,'--workbench-font':`${layout.font}px`,'--row-height':`${effectiveRowHeight(layout)}px`,'--file-row-height':`${fileRowHeight(layout.font,state.appearance.fileSpacing)}px`,'--file-row-padding':`${state.appearance.fileSpacing}px`,'--control-height':uiText("workbench.px", { value: (Math.max(24,Math.round(layout.font*1.35)+6)) }),'--diff-font':`${state.appearance.codeFont}px`,'--diff-row-height':`${diffRowHeight(state.appearance.codeFont,state.appearance.codeRowHeight)}px`,'--notification-badge':state.appearance.badgeColor,'--notification-badge-fg':textColorForBackground(state.appearance.badgeColor),'--graph-main':lightTheme?state.appearance.mainColors.light:state.appearance.mainColors.dark,...Object.fromEntries(paletteColors.map((color,index)=>[`--graph-lane-${index}`,color]))} as React.CSSProperties}>
    <header className="app-chrome"><strong className="brand"><Icon name="git-branch"/>{uiText("workbench.alwayGit")}</strong><span className="workbench-tab">{t("workbench.gitWorkbench")}</span>{demoMode&&<span className="muted">{t("workbench.demoRepository")}</span>}<div className="toolbar-spacer"/><Button className="icon-only" icon="split-horizontal" title={t("workbench.newWorkbenchTab")} aria-label={t("workbench.newWorkbenchTab")} onClick={()=>void host('openWorkbench',{newTab:true})}/><Button className="icon-only" icon="window" title={t("workbench.openWorkbenchInNewWindow")} aria-label={t("workbench.openWorkbenchInNewWindow")} onClick={()=>void host('openWorkbench',{newWindow:true})}/><Button className="icon-only" icon="layout-sidebar-right" title={t("workbenchEntry.openModeSettings")} aria-label={t("workbenchEntry.openModeSettings")} onClick={()=>void host('workbenchOpenModeSettings')}/><Button className="icon-only" icon="layout" title={t("workbench.restoreLayout")} aria-label={t("workbench.restoreLayout")} onClick={state.restoreLayout}/><Button className="icon-only help-trigger" icon="question" shortcut="help" title={t("workbench.helpGuide")} aria-label={t("workbench.helpGuide")} onClick={showHelp}/><Button className="icon-only settings-trigger" icon="settings-gear" shortcut="settings" title={t("common.settings")} aria-label={t("common.settings")} onClick={showSettings}/></header>
    <div className="toolbar">
      <span className="branch-identity toolbar-branch" title={branchTitle}><Icon name="git-branch"/><strong data-testid="current-branch">{branchLabel}</strong></span><span className="toolbar-divider"/>
      <Button icon="cloud-download" shortcut="fetch" disabled={!canOperate} onClick={()=>void state.execute({type:'fetch'})}>{uiText("workbench.fetch")}</Button><Button icon="arrow-down" shortcut="pull" aria-label={snapshot?.behind?t("workbench.pullIncomingCommits", { behind: snapshot.behind }):uiText("workbench.pull")} disabled={!canOperate} onClick={()=>open({type:'pull'})}>{uiText("workbench.pull")}{snapshot?.behind?<span className="notification-badge" aria-hidden="true">{snapshot.behind>99?'99+':snapshot.behind}</span>:null}</Button><Button icon="arrow-up" shortcut="push" disabled={!canPush} aria-label={unpushed?t("workbench.pushUnpushedCommits", { unpushed: (unpushed) }):uiText("workbench.push")} title={!snapshot?.branch?t("workbench.pushRequiresALocalBranch"):snapshot&&!(snapshot.remotes?.length)?t("workbench.addARemoteBeforePush"):undefined} onClick={()=>open({type:'push'})}>{uiText("workbench.push")}{unpushed?<span className="notification-badge" aria-hidden="true">{unpushed>99?'99+':unpushed}</span>:null}</Button><span className="toolbar-divider"/>
      {state.changeListMode==='unified'&&<><Button icon="stage-inbox" shortcut="stageAll" title={t('changes.stageAllScope')} disabled={!canOperate||!snapshot!.changes.some(isUnstaged)} onClick={()=>open({type:'stage',paths:snapshot!.changes.filter(isUnstaged).map(file=>file.path)})}>{uiText('details.stageAll')}</Button><Button icon="discard" shortcut="unstageAll" title={t('changes.unstageAllScope')} disabled={!canOperate||!snapshot!.changes.some(isStaged)} onClick={()=>open({type:'unstage',paths:snapshot!.changes.filter(isStaged).map(file=>file.path)})}>{uiText('details.unstageAll')}</Button><Button icon="trash" title={t('changes.discardAllScope')} disabled={!canOperate||!snapshot!.changes.some(isUnstaged)} onClick={()=>open({type:'discard',discardScope:'unstaged'})}>{uiText('details.discardAll')}</Button><span className="toolbar-divider"/></>}
      <Button className="commit-trigger" icon="git-commit" shortcut="commit" disabled={!canOperate} onClick={()=>startCommit()}>{uiText("workbench.commit")}</Button><span className="toolbar-divider"/>
      <Button icon="archive" shortcut="stash" disabled={!canStash} onClick={()=>open({type:'stash.create'})}>{uiText("workbench.stashAllChanges")}</Button>
      <div className="toolbar-spacer"/><Button icon="refresh" shortcut="refresh" title={t("workbench.refreshCurrentRepositoryStatusAndHistory")} aria-label={t("workbench.refreshCurrentRepositoryStatusAndHistory")} disabled={!canOperate} onClick={()=>void state.refresh()}/><div className="toolbar-repository-actions"><Button className="icon-only toolbar-special" icon="location" shortcut="head" title={t("workbench.locateTheCurrentCommitHEAD")} aria-label={t("workbench.locateHEAD")} disabled={!snapshot?.head} onClick={state.locateHead}/><Button className="icon-only toolbar-special open-repository" shortcut="repository" data-testid="open-project" title={snapshot?`${t("workbench.openRepositoryFolder")}\n${t("workbench.switchesToItsVSCodeWindowWhenAlreadyOpen")}\n${snapshot.repository.root}`:t("workbench.selectARepositoryFirst")} aria-label={t("workbench.openRepositoryFolder")} disabled={!snapshot} onClick={openRepository}><OpenRepositoryFolderIcon/></Button></div>
    </div>
    {projectNotice&&<div className="project-open-notice" role="status" aria-live="polite" aria-atomic="true"><Icon name="info"/><div><span>{projectNotice.exactRoot?t("workbench.currentRepositoryExplorerShown"):t("workbench.workspaceRepositoryExplorerShown")}</span><div className="project-open-notice-path">{projectNotice.root}</div></div></div>}
    <OperationNotice abort={()=>open({type:'operation.abort'})}/>
    {!blockInteraction&&<ActionFeedbackBar showLog={()=>void host('showLog')} openAction={open}/>}
    {state.notice&&!state.busy&&!state.actionFeedback&&<div className="banner notice" role="status"><Icon name="info"/><span>{state.notice}</span><Button className="icon-only" icon="close" title={t("workbench.dismissNotification")} aria-label={t("workbench.dismissNotification")} onClick={()=>useWorkbench.setState({notice:undefined})}/></div>}
    {state.error&&state.error!==state.actionFeedback?.error&&!state.checkoutFailure&&!state.stashApplyFailure&&<div className="banner error" role="alert"><Icon name="error"/><span>{state.error}</span><Button onClick={()=>void host('showLog')}>{t("workbench.showLog")}</Button><Button icon="close" aria-label={uiText("workbench.dismissError")} onClick={()=>useWorkbench.setState({error:undefined})}/></div>}
    {compact && <nav className="compact-regions" aria-label={t('workbenchEntry.compactNavigation')}>
      {([{ id: 'repositories', icon: 'repo', label: 'workbenchEntry.repositoriesTab' }, { id: 'history', icon: 'git-commit', label: 'workbenchEntry.historyTab' }, { id: 'details', icon: 'files', label: 'workbenchEntry.detailsTab' }, { id: 'diff', icon: 'terminal', label: 'workbenchEntry.diffTab' }] as const).map(item => <button type="button" key={item.id} aria-pressed={region === item.id} onClick={() => setRegion(item.id)}><Icon name={item.icon}/><span>{t(item.label)}</span></button>)}
    </nav>}
    <div className="workspace"><Sidebar context={showContext} actions={sidebarActions} checkoutBranch={checkoutBranch} openWorktree={openWorktree}/><ResizeHandle axis="x" label={uiText("workbench.resizeRepositorySidebar")} value={layout.sidebar} min={160} max={360} onChange={sidebar=>state.setLayout({sidebar})}/><main ref={mainPanel} className={`main-panel${layout.diffCollapsed?' diff-collapsed':''}`} style={{'--diff-height':`${diffHeight}px`} as React.CSSProperties}>
      {!snapshot&&state.catalogState!=='ready'?<RepositoryCatalogStatus phase={state.catalogState} error={state.catalogError} retry={()=>void useWorkbench.getState().initialize()} showLog={()=>void host('showLog')}/>:!snapshot?<Empty title={repositoryState==='opening'?t("workbench.openingRepository"):repositoryState==='unavailable'?t("workbench.repositoryUnavailable"):hasRepositories?t("workbench.noRepositorySelected"):t("workbench.noRepositoriesAdded")}>{repositoryState!=='opening'&&<>{repositoryState==='unavailable'?<span>{t("workbench.theRepositoryFolderNoLongerExistsOrCannotBe")}</span>:hasRepositories?<span>{t("workbench.chooseARepositoryFromTheWorkbenchSidebarToBegin")}</span>:<span>{t("workbench.scanAFolderAndChooseWhichGitRepositoriesAlwayGit")}</span>}<Button className={!hasRepositories?'primary':''} icon="folder-opened" onClick={()=>void addRepository()}>{hasRepositories?t("workbench.addRepositories"):t("workbench.findAndAddRepositories")}</Button><Button icon="question" onClick={showHelp}>{t("workbench.quickStart")}</Button></>}</Empty>:<>
        <div className="top-panels"><History context={showContext} checkout={checkout} checkoutBranch={checkoutBranch}/><ResizeHandle axis="x" label={uiText("workbench.resizeDetailsPanel")} value={layout.details} min={230} max={480} reverse onChange={details=>state.setLayout({details})}/><Details open={open} edit={editSelected} context={showContext} startCommit={()=>startCommit()}/></div>
      </>}
      {!layout.diffCollapsed&&<ResizeHandle axis="y" label={uiText("workbench.resizeDiffPanel")} value={diffHeight} min={130} max={maxDiffHeight} reverse onChange={diff=>state.setLayout({diff})}/>}<BottomDock native={native} edit={editSelected}/>
    </main></div>
    {dialog&&snapshot&&!state.checkoutFailure&&!state.operationReview&&<ActionDialog key={`${state.repoId}-${dialog.type}-${dialog.target}-${dialog.sources?.join('|')}-${dialog.names?.join('|')}-${dialog.remoteBranches?.join('|')}-${dialog.pop}`} dialog={dialog} onClose={()=>setDialog(undefined)} openAbort={()=>open({type:'operation.abort'})} replaceDialog={setDialog}/>}
    {repositoryDialog&&<RepositoryDialog onClose={()=>setRepositoryDialog(false)}/>}
    {repositoryRemoval&&<RepositoryRemoveDialog groups={repositoryRemoval} onClose={()=>setRepositoryRemoval(undefined)}/>}
    {commitRepoId===state.repoId&&commitRepoId&&snapshot&&!state.operationReview&&<CommitDialog key={commitRepoId} repoId={commitRepoId} files={commitFiles} onClose={()=>closeCommit(commitRepoId)}/>}
    {state.operationReview&&snapshot&&<OperationReviewDialog key={state.operationReview.review.token} edit={path=>void edit({kind:'change',path,area:'staged'})}/>}
    {context&&menu&&<ContextMenu x={context.x} y={context.y} caption={menu.caption} items={menu.items} anchor={context.anchor} close={closeMenu}/>}
    {repositoryFetch&&<RepositoryFetchDialog repositories={repositoryFetch} onClose={()=>setRepositoryFetch(undefined)}/>}
    {state.checkoutFailure&&snapshot&&<CheckoutFailureDialog onClose={()=>{setDialog(undefined);useWorkbench.setState({checkoutFailure:undefined,error:undefined});}} host={host}/>}
    {state.settingsBaseline&&<SettingsDialog theme={theme}/>}
    {helpOpen&&<Suspense fallback={null}><HelpDialog onClose={()=>setHelpOpen(false)}/></Suspense>}
    {state.remoteRequest&&<RemoteRequestDialog key={state.remoteRequest.identity}/>}
    {blockInteraction&&<OperationProgress key={`${state.repoId}-${progressFeedback?.id ?? 'host'}`} feedback={progressFeedback}/>}
  </div>;
}

function OpenRepositoryFolderIcon() {
  return <span className="open-repository-icon" aria-hidden="true">
    <svg className="repository-folder-outline" viewBox="0 0 32 28" fill="none">
      <path className="repository-folder-shell" d="M3.25 20.75V7.25a3 3 0 0 1 3-3h6.35L16 7.75h9.15a3.6 3.6 0 0 1 3.6 3.6v5.15"/>
      <path className="repository-folder-base" d="M25.7 23.75H6.25a3 3 0 0 1-3-3"/>
      <path className="repository-folder-fold" d="m12.15 5.65 2.55 2.65"/>
    </svg>
    <Icon name="vscode" className="repository-folder-vscode"/>
  </span>;
}

function RepositoryFetchDialog({repositories,onClose}:{repositories:Repository[];onClose():void}) {
  const state=useWorkbench(),t=useTranslation(),[busy,setBusy]=useState(false),[failure,setFailure]=useState<string>();
  const run=async()=>{setBusy(true);setFailure(undefined);const results=await Promise.allSettled(repositories.map(repository=>rpc('action',repository.id,{type:'fetch'}))),failed=results.flatMap((result,index)=>result.status==='rejected'?[`${repositories[index].name}: ${result.reason instanceof Error?result.reason.message:String(result.reason)}`]:[]);await state.loadRepositoryStatuses();if(repositories.some(repository=>repository.id===useWorkbench.getState().repoId))await useWorkbench.getState().refresh({background:true});if(failed.length){setFailure(failed.join('\n'));setBusy(false);return;}useWorkbench.setState({notice:repositories.length===1 ? t("workbench.fetchCompleted") : t("workbench.fetchedRepositories", { count: (repositories.length) })});onClose();};
  return <Modal title={repositories.length===1 ? t("workbench.fetchRepository") : t("workbench.fetchRepositories", { count: (repositories.length) })} busy={busy} onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>{t("common.cancel")}</Button><Button className="primary" disabled={busy} onClick={()=>void run()}>{busy?t("workbench.fetching"):uiText("workbench.fetch")}</Button></>}><p>{t("workbench.fetchTheSelectedRepositoriesWithoutChangingTheRepositoryOpen")}</p><div className="repository-batch-list">{repositories.map(repository=><div key={repository.id}><strong>{repository.name}</strong><span>{repository.root}</span></div>)}</div>{failure&&<pre className="warning-text" role="alert">{failure}</pre>}</Modal>;
}

function CheckoutFailureDialog({onClose,host}:{onClose():void;host(method:RpcRequest['method'],payload?:unknown):Promise<void>}) {
  const state=useWorkbench(),failure=state.checkoutFailure!,t=useTranslation(),canStash=failure.reason==='local-changes'&&!failure.stashCreated&&(!failure.detached||state.operationSettings.allowDetachedHead);
  const reason=failure.reason==='worktree-occupied'?t("workbench.theBranchIsInUseByAnotherWorktree"):failure.reason==='conflicts'?t("workbench.resolveConflictsBeforeCheckout"):failure.reason==='operation-active'?t("workbench.completeOrAbortTheActiveGitOperationBeforeCheckout"):failure.stashCreated?t("workbench.stashWasSavedButCheckoutFailedTheStashIs"):failure.reason==='local-changes'?t("workbench.checkoutWouldOverwriteLocalChanges"):t("workbench.gitCouldNotCompleteCheckoutSeeTheDetailsBelow");
  return <Modal title={t("workbench.checkoutBlocked")} busy={state.busy} onClose={onClose} footer={<><Button disabled={state.busy} onClick={onClose}>{t("common.cancel")}</Button>{canStash&&<Button className="primary" disabled={state.busy} onClick={()=>{const repoId=state.repoId;void state.execute(failure.trackBranches?{type:'branch.track',branches:failure.trackBranches,checkout:true,stashFirst:true,includeUntracked:true}:{type:'checkout.stash',target:failure.target,detached:failure.detached,includeUntracked:true}).then(success=>{if(success){const latest=useWorkbench.getState();if(latest.repoId===repoId&&latest.snapshot?.head)void latest.selectCommit(latest.snapshot.head);onClose();}});}}>{uiText("workbench.stashChangesCheckout")}</Button>}</>}>
    <strong>{uiText("workbench.checkout")}{failure.target}</strong>{failure.branchCreated&&<p role="status">{t("workbench.branchWasCreatedAndRetainedYouHaveNotSwitched", { target: (failure.target) })}</p>}<p className="warning-text" role="alert">{reason}</p><div className="discard-paths">{failure.paths.map(path=><div key={path}>{path}</div>)}</div>{failure.worktreePath&&<Button onClick={()=>{onClose();void host('openWorktree',{path:failure.worktreePath,newWindow:false});}}>{uiText("workbench.openWorktree")}</Button>}{!!failure.paths.length&&<Button onClick={()=>{const path=failure.paths[0];onClose();state.selectWorking();const file=state.snapshot?.changes.find(f=>f.path===path);if(file)state.selectFile({kind:'change',path,area:file.conflict?'conflict':file.untracked||file.worktreeStatus!==' '?'unstaged':'staged'});}}>{t("workbench.viewAffectedFiles")}</Button>}<p className="muted">{state.error}</p>
  </Modal>;
}
