import { Button, Empty, Icon, Modal } from './ui';

import { uiText } from './text';
import { memo, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { VirtualFileRows } from './VirtualFileRows';
import type { Change, CommitDetails, CommitFile, DiffTarget } from '../src/protocol/types';
import type { DialogRequest } from './ActionDialog';

import { useSnapshotFields, useWorkbenchFields } from './subscriptions';
import { useTranslation } from './i18n';
import type { StaticMessageKey } from './i18n';
import { rpc } from './rpc';

import { filePathLabel, fileSelectionForClick, filterFilesByPath, reconcileFileSelection, type FileSelection } from './fileSelection';
import { handleSelectionKeyboard } from './selectionKeyboard';
import { useShortcuts } from './shortcuts';
import type { ContextHandler } from './Sidebar';

function FileLabel({ path }: { path: string }) {
  const label = filePathLabel(path);
  return <span className="file-label"><span className="file-basename">{label.name}</span><span className="file-parent-path">{label.parent}</span></span>;
}

function fileStatusLabel(status: string, t: ReturnType<typeof useTranslation>) {
  const labels: Record<string, StaticMessageKey> = {
    '?': "details.untrackedVariant2", A: "details.added", M: "details.modified", D: "details.deleted",
    R: "details.renamed", C: "details.copied", U: "details.conflict", T: "details.typeChanged",
  };
  return t(labels[status[0] || 'M'] ?? "details.changed");
}

function FileStatus({ status }: { status: string }) {
  const t = useTranslation(), key = status[0] || 'M', label = fileStatusLabel(status, t);
  return <span className={`file-status status-${key}`} title={label} role="img" aria-label={label}><Icon name="file-code"/><span className="file-status-badge" aria-hidden="true">{key === 'U' ? '!' : key}</span></span>;
}

function useFileSelection(scope: string, order: string[]) {
  const [saved, setSaved] = useState<{ scope: string; selection: FileSelection }>({ scope, selection: { paths: [] } });
  const selection = useMemo(() => reconcileFileSelection(order, saved.scope === scope ? saved.selection : { paths: [] }), [scope, order, saved]);
  useEffect(() => { setSaved(old => ({ scope, selection: reconcileFileSelection(order, old.scope === scope ? old.selection : { paths: [] }) })); }, [scope, order]);
  const selected = useMemo(() => new Set(selection.paths), [selection.paths]);
  const update = (change: (current: FileSelection) => FileSelection) => setSaved(old => ({ scope, selection: change(reconcileFileSelection(order, old.scope === scope ? old.selection : { paths: [] })) }));
  const click = (path: string, event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>, replace = false) => update(current => fileSelectionForClick(order, current, path, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey, replace }));
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    handleSelectionKeyboard(event, () => update(() => ({ paths: [...order] })), () => update(() => ({ paths: [] })));
  };
  return { selection, selected, click, keyDown };
}

function FileSelectionHint({ count, clickSelect = false, filtered = false }: { count: number; clickSelect?: boolean; filtered?: boolean }) {
  const t = useTranslation();
  return <div className="file-selection-hint"><span title={t("details.ctrlCmdClickTogglesShiftClickSelectsRangeEsc")}>{filtered?t("details.clickSelectsCtrlASelectsVisibleFiles"):clickSelect?t("details.clickSelectsCtrlASelectsAllFiles"):t("details.clickToPreviewCtrlASelectsFiles")}</span><strong aria-live="polite">{t("details.selected", { count: (count) })}</strong></div>;
}

function CommitFiles({ files, scope, filter, onFilterChange, target, empty, emptyAction, edit, context }: { files: CommitFile[]; scope: string; filter: string; onFilterChange(value:string):void; target(file: CommitFile): DiffTarget; empty: string; emptyAction?:ReactNode; edit(): void; context:ContextHandler }) {
  const state = useWorkbenchFields('diffTarget', 'repoId', 'report', 'selectFile', 'selectedFile'), t = useTranslation(), visibleFiles = useMemo(() => filterFilesByPath(files, filter), [files, filter]), order = useMemo(() => visibleFiles.map(file => file.path), [visibleFiles]), byPath = useMemo(() => new Map(visibleFiles.map(file => [file.path, file])), [visibleFiles]), batch = useFileSelection(`${state.repoId}:${scope}`, order), filtering=!!filter.trim();
  return <div className="file-selection-panel" onKeyDownCapture={batch.keyDown}>
    <div className="file-selection-toolbar"><label className="file-path-filter"><Icon name="search"/><input type="search" aria-label={t("details.filterChangedFilePaths")} placeholder={t("details.filterPaths")} value={filter} onChange={event=>onFilterChange(event.target.value)}/></label>{filtering&&<span className="file-filter-count" aria-live="polite">{visibleFiles.length} / {files.length}</span>}<Button icon="copy" disabled={!batch.selection.paths.length} onClick={() => void rpc('copyText', state.repoId, { text: batch.selection.paths.join('\n') }).catch(state.report)}>{t("details.copyPaths")}{batch.selection.paths.length ? ` (${batch.selection.paths.length})` : ''}</Button></div>
    <FileSelectionHint clickSelect count={batch.selection.paths.length}/>
    {filtering&&state.selectedFile&&files.some(file=>file.path===state.selectedFile)&&!visibleFiles.some(file=>file.path===state.selectedFile)&&<div className="history-caption">{t("details.currentDiffIsOutsideThePathFilter")}{state.selectedFile}</div>}
    <div className="detail-files" tabIndex={0} role="listbox" aria-multiselectable="true" aria-label={t("details.changedFiles")}><VirtualFileRows items={visibleFiles} getKey={file=>file.path} scrollParent=".detail-files">{(file,index) => { const diff = target(file), preview = state.diffTarget?.kind === diff.kind && state.selectedFile === file.path, checked = batch.selected.has(file.path); return <div key={file.path} role="option" aria-setsize={visibleFiles.length} aria-posinset={index+1} aria-selected={checked} className={`file-item ${preview ? 'selected' : ''} ${checked ? 'batch-selected' : ''}`} onContextMenu={event=>{const paths=checked?batch.selection.paths:[file.path];if(!checked)batch.click(file.path,event,true);state.selectFile(diff);context(event,{kind:'files',primary:{path:file.path,target:diff},files:paths.map(path=>({path,target:target(byPath.get(path)!)}))});}}>
      <FileStatus status={file.status}/><button className="file-name" aria-label={file.path} title={`${file.previousPath ? `${file.previousPath} → ${file.path}` : file.path} · ${fileStatusLabel(file.status, t)}`} onClick={event => { batch.click(file.path, event, true); state.selectFile(diff); }} onDoubleClick={edit}><FileLabel path={file.path}/></button>
    </div>; }}</VirtualFileRows>{!visibleFiles.length && <Empty title={files.length?t("details.noFilesMatchThisPathFilter"):empty}>{!files.length&&emptyAction}</Empty>}</div>
  </div>;
}

function DetailsPanel({ open, edit, context, startCommit }: { open(dialog:DialogRequest):void; edit():void; context:ContextHandler; startCommit():void }) {
  const state=useWorkbenchFields('compareCommits', 'comparison', 'details', 'detailsLoading', 'language', 'repoId', 'selectCommit', 'selectStashSection', 'selectedStashOid', 'selectedStashSection', 'stashDetails', 'tab'),t=useTranslation(),detail=state.details,comparison=state.comparison,[fileFilter,setFileFilter]=useState('');
  useEffect(()=>{setFileFilter('');},[state.repoId,state.tab,state.selectedStashSection]);
  const stash=state.selectedStashOid?state.stashDetails:undefined,metadata=stash??detail,bodyLines=metadata?.body.split('\n')??[],body=(bodyLines[0]===metadata?.commit.subject?bodyLines.slice(1):bodyLines).join('\n').trim();
  const stashSections=stash?(Object.entries(stash.sections) as ['working'|'index'|'untracked',CommitDetails][]).filter((entry):entry is ['working'|'index'|'untracked',CommitDetails]=>!!entry[1]):[];
  const sectionLabel=(section:'working'|'index'|'untracked')=>section==='working'?uiText("details.workingTree"):section==='index'?uiText("details.index"):t("details.untrackedFiles");
  const jump=stashSections.find(([section,value])=>section!==state.selectedStashSection&&value.files.length>0);
  return <section className="details-panel" data-testid="details">
    <div className="pane-heading"><strong>{state.tab==='changes'?t("details.workingTreeStatus"):comparison?t("details.compareCommits"):t("details.commitDetails")}</strong>{comparison&&<Button className="icon-only" icon="arrow-swap" title={t("details.swapComparisonSides")} aria-label={t("details.swapComparisonSides")} onClick={()=>void state.compareCommits(comparison.right.oid,comparison.left.oid,true)}/>}</div>
    {state.tab==='changes'?<WorkingTree open={open} edit={edit} context={context} startCommit={startCommit}/>:comparison?<ComparisonDetails filter={fileFilter} onFilterChange={setFileFilter} edit={edit} context={context}/>:!detail?<Empty title={state.detailsLoading?t("details.loadingDetails"):t("details.selectACommit")}/>:<>
      <div className="commit-metadata"><strong>{metadata!.commit.subject}</strong><span className="hash" title={metadata!.commit.oid}>{metadata!.commit.oid.slice(0,8)}</span><span>{metadata!.commit.author} &lt;{metadata!.commit.email}&gt;</span><span className="muted">{new Date(metadata!.commit.timestamp*1000).toLocaleString(state.language)}</span>{body&&<pre>{body}</pre>}
        {stash&&<><div className="stash-summary">{t("details.savedFiles", { count: (stash.totalFiles) })} · {t("details.untracked", { value: (stash.sections.untracked?.files.length??0) })}</div><div className="stash-tabs" role="tablist" aria-label={t("details.stashFileCategories")}>{stashSections.map(([section,value])=><Button key={section} role="tab" aria-selected={state.selectedStashSection===section} className={`stash-tab ${state.selectedStashSection===section?'selected':''}`} onClick={()=>state.selectStashSection(section)}>{sectionLabel(section)} <span>{value.files.length}</span></Button>)}</div></>}
      </div>
      <div className="pane-heading"><strong>{t("details.changedFilesVariant2")} · {detail.files.length}</strong>{!stash&&detail.commit.parents.length>1&&<select aria-label={uiText("details.compareParent")} value={detail.parent??detail.commit.parents[0]} onChange={event=>void state.selectCommit(detail.commit.oid,event.target.value)}>{detail.commit.parents.map((parent,i)=><option key={parent} value={parent}>{uiText("details.parent")}{i+1} · {parent.slice(0,8)}</option>)}</select>}</div>
      <CommitFiles files={detail.files} scope={`commit:${detail.commit.oid}:${detail.parent??''}`} filter={fileFilter} onFilterChange={setFileFilter} target={file=>({kind:'commit',oid:detail.commit.oid,parent:detail.parent,path:file.path,previousPath:file.previousPath})} empty={jump?t("details.thisCategoryHasNoFilesHas", { value: (sectionLabel(jump[0])), count: (jump[1].files.length) }):t("details.noChangedFiles")} emptyAction={jump&&<Button icon="arrow-right" onClick={()=>state.selectStashSection(jump[0])}>{t("details.open", { value: (sectionLabel(jump[0])) })}</Button>} edit={edit} context={context}/>
    </>}
  </section>;
}

function ComparisonDetails({filter,onFilterChange,edit,context}:{filter:string;onFilterChange(value:string):void;edit():void;context:ContextHandler}){
  const state=useWorkbenchFields('comparison'),t=useTranslation(),comparison=state.comparison!;
  return <><div className="comparison-summary"><div><span className="hash">{comparison.left.oid.slice(0,8)}</span><strong>{comparison.left.subject}</strong></div><Icon name="arrow-right"/><div><span className="hash">{comparison.right.oid.slice(0,8)}</span><strong>{comparison.right.subject}</strong></div></div><div className="pane-heading"><strong>{t("details.changedFilesVariant2")} · {comparison.files.length}</strong></div><CommitFiles files={comparison.files} scope={`comparison:${comparison.left.oid}:${comparison.right.oid}`} filter={filter} onFilterChange={onFilterChange} target={file=>({kind:'comparison',left:comparison.left.oid,right:comparison.right.oid,path:file.path,previousPath:file.previousPath})} empty={t("details.theSelectedCommitsHaveIdenticalFileContents")} edit={edit} context={context}/></>;
}

function WorkingTree({ open, edit, context, startCommit }: { open(dialog:DialogRequest):void; edit():void; context:ContextHandler; startCommit():void }) {
  const state={ ...useWorkbenchFields('busy', 'diffTarget', 'drafts', 'execute', 'repoId', 'selectFile', 'selectedFile', 'workingFilters', 'setWorkingFilter'), snapshot: useSnapshotFields('branch', 'changes') },snapshot=state.snapshot!,t=useTranslation(),[bulkAction,setBulkAction]=useState<{type:'stage'|'unstage';paths:string[];filtered?:boolean}>();
  const [collapsed, setCollapsed] = useState({ conflict: false, unstaged: false, staged: false });
  useEffect(()=>{setBulkAction(undefined);setCollapsed({conflict:false,unstaged:false,staged:false});},[state.repoId]);
  const {staged,unstaged,conflicts}=useMemo(()=>({staged:snapshot.changes.filter(c=>!c.conflict&&c.indexStatus!==' '&&c.indexStatus!=='?'&&!!c.indexStatus),unstaged:snapshot.changes.filter(c=>!c.conflict&&(c.untracked||c.worktreeStatus!==' '&&!!c.worktreeStatus)),conflicts:snapshot.changes.filter(c=>c.conflict)}),[snapshot.changes]);
  const filter=state.workingFilters[state.repoId!]??'',filtering=!!filter.trim(),visibleStaged=useMemo(()=>filterFilesByPath(staged,filter),[staged,filter]),visibleUnstaged=useMemo(()=>filterFilesByPath(unstaged,filter),[unstaged,filter]),visibleConflicts=useMemo(()=>filterFilesByPath(conflicts,filter),[conflicts,filter]),matchingFiles=useMemo(()=>filterFilesByPath(snapshot.changes,filter),[snapshot.changes,filter]),matchingCount=matchingFiles.length;
  const stageAll=()=>setBulkAction({type:'stage',paths:visibleUnstaged.map(file=>file.path),filtered:filtering}),unstageAll=()=>setBulkAction({type:'unstage',paths:visibleStaged.map(file=>file.path),filtered:filtering});
  useShortcuts({stageAll:{enabled:!!visibleUnstaged.length&&!state.busy,run:stageAll},unstageAll:{enabled:!!visibleStaged.length&&!state.busy,run:unstageAll}});
  const fileKey=(area:string,path:string)=>JSON.stringify([area,path]);
  const order=useMemo(()=>[...(!collapsed.conflict?visibleConflicts.map(file=>fileKey('conflict',file.path)):[]),...(!collapsed.unstaged?visibleUnstaged.map(file=>fileKey('unstaged',file.path)):[]),...(!collapsed.staged?visibleStaged.map(file=>fileKey('staged',file.path)):[])],[collapsed,visibleConflicts,visibleUnstaged,visibleStaged]),batch=useFileSelection(`${state.repoId}:changes`,order);
  const group=(area:'staged'|'unstaged'|'conflict',allFiles:Change[])=>{
    const files=area==='staged'?visibleStaged:area==='unstaged'?visibleUnstaged:visibleConflicts;
    const selection=area==='conflict'?files.filter(file=>batch.selected.has(fileKey(area,file.path))).map(file=>file.path):[],targets=area==='conflict'&&selection.length?selection:files.map(file=>file.path),action=area==='staged'?'unstage':area==='conflict'?'resolve-and-stage':'stage';
    const label=area==='staged'?uiText("details.staged"):area==='unstaged'?uiText("details.unstaged"):t("details.conflicts"),verb=area==='staged'?uiText("details.unstage"):area==='conflict'?t("details.manuallyHandledMarkStage"):uiText("details.stage");
    const toggleLabel=collapsed[area]?t("details.expand", { label: (label) }):t("details.collapse", { label: (label) });
    const actionLabel=`${verb}${area==='conflict'&&selection.length?` (${selection.length})`:filtering?` ${t("details.matching")} (${targets.length})`:' All'}`;
    const discardLabel=filtering?t("details.discardMatching", { count: (files.length) }):t("details.discardAll");
    return <div className="change-group" key={area}><div className={`change-heading change-heading-${area}`}>
      <button type="button" className="change-heading-label" title={toggleLabel} aria-label={toggleLabel} aria-expanded={!collapsed[area]} aria-controls={`change-files-${area}`} onClick={()=>setCollapsed(value=>({...value,[area]:!value[area]}))}><Icon name={collapsed[area]?'chevron-right':'chevron-down'}/><strong>{label}</strong><span className="change-count" aria-label={t("details.ofFiles", { count: (files.length), count2: (allFiles.length) })}>{filtering?`${files.length}/${allFiles.length}`:files.length}</span></button>
      <div className="change-actions"><Button className={`change-action change-action-${area}${area!=='conflict'?' icon-only':''}`} icon={area==='staged'?'discard':area==='unstaged'?'stage-inbox':undefined} shortcut={area==='unstaged'?'stageAll':area==='staged'?'unstageAll':undefined} title={actionLabel} aria-label={actionLabel} disabled={!targets.length||state.busy} onClick={()=>{if(area==='unstaged')stageAll();else if(area==='staged')unstageAll();else void state.execute({type:action,paths:targets});}}>{area==='conflict'?actionLabel:null}</Button>
        {area==='unstaged'&&<Button className="icon-only change-discard" icon="trash" title={discardLabel} aria-label={discardLabel} disabled={!files.length||state.busy} onClick={()=>open({type:'discard',paths:files.map(file=>file.path)})}/>}
        {area==='staged'&&<Button className="primary change-commit-trigger" icon="git-commit" shortcut="commit" aria-label={uiText("details.commit")} title={state.drafts[state.repoId!]?t("details.openCommitSavedDraftAvailable"):t("details.openCommit")} disabled={state.busy} onClick={startCommit}>{uiText("details.commit")}{state.drafts[state.repoId!]&&<span className="commit-draft-dot" aria-hidden="true"/>}</Button>}
      </div></div>
      <div id={`change-files-${area}`} hidden={collapsed[area]}>
      {!collapsed[area]&&<VirtualFileRows items={files} getKey={file=>file.path} scrollParent=".change-groups">{(file,index)=>{const target:DiffTarget={kind:'change',area,path:file.path},key=fileKey(area,file.path),chosen=state.diffTarget?.kind==='change'&&state.diffTarget.area===area&&state.selectedFile===file.path,checked=batch.selected.has(key),status=file.conflict?'U':file.untracked?'?':area==='staged'?file.indexStatus:file.worktreeStatus;return <div key={file.path} role="option" aria-setsize={files.length} aria-posinset={index+1} aria-selected={checked} className={`change-file ${chosen?'selected':''} ${checked?'batch-selected':''}`} onContextMenu={event=>{const keys=checked?batch.selection.paths:[key];if(!checked)batch.click(key,event,true);state.selectFile(target);context(event,{kind:'files',primary:{path:file.path,target},files:keys.map(value=>{const [selectedArea,path]=JSON.parse(value) as ['staged'|'unstaged'|'conflict',string];return {path,target:{kind:'change',area:selectedArea,path} as DiffTarget};})});}}><FileStatus status={status}/><button className="file-name" aria-label={file.path} title={`${file.originalPath?`${file.originalPath} → ${file.path}`:file.path} · ${fileStatusLabel(status,t)} · ${label}`} onClick={event=>{batch.click(key,event,true);state.selectFile(target);}} onDoubleClick={edit}><FileLabel path={file.path}/></button>{area==='conflict'&&<Button className="icon-only" icon="edit" title={t("details.editAndSaveInVSCodeThenReturnTo")} aria-label={t("details.editConflictFileInVSCode")} disabled={state.busy} onClick={()=>{state.selectFile(target);edit();}}/>}</div>;}}</VirtualFileRows>}
      {area==='conflict'&&<p className="conflict-instructions">{t("details.viewTheConflictEditAndSaveTheFileThen")}</p>}
      {!files.length&&<div className="change-empty">{allFiles.length?t("details.noMatchingFiles"):t("details.noChanges")}</div>}
      </div>
    </div>;
  };
  return <><div className="working-summary"><span>{snapshot.branch||uiText("details.detachedHEAD")}</span><span className="muted">{uiText("details.stagedVariant2")}{staged.length}{uiText("details.unstagedVariant2")}{unstaged.length}</span></div>
    <div className="file-selection-toolbar working-file-toolbar"><label className="file-path-filter"><Icon name="search"/><input type="search" aria-label={t("details.filterWorkingTreeFilePaths")} placeholder={t("details.filterFilesOrPaths")} value={filter} onChange={event=>state.setWorkingFilter(event.target.value)}/></label>{filtering&&<><span className="file-filter-count" aria-live="polite">{matchingCount} / {snapshot.changes.length}</span><Button className="icon-only" icon="close" title={t("details.clearFileFilter")} aria-label={t("details.clearFileFilter")} onClick={()=>state.setWorkingFilter('')}/></>}</div>
    {filtering&&conflicts.length>visibleConflicts.length&&<p className="working-filter-warning" role="status">{t("details.conflictsAreHiddenByTheFilterResolveAllConflicts", { count: (conflicts.length-visibleConflicts.length) })}</p>}
    {filtering&&state.diffTarget?.kind==='change'&&!matchingFiles.some(file=>file.path===state.selectedFile)&&state.selectedFile&&<div className="history-caption">{t("details.currentDiffIsOutsideThePathFilter")}{state.selectedFile}</div>}
    <div className="change-groups" tabIndex={0} role="listbox" aria-multiselectable="true" aria-label={t("details.workingTreeFiles")} onKeyDownCapture={batch.keyDown}><FileSelectionHint clickSelect filtered={filtering} count={new Set(batch.selection.paths.map(key=>(JSON.parse(key) as string[])[1])).size}/>{!!conflicts.length&&group('conflict',conflicts)}{group('unstaged',unstaged)}{group('staged',staged)}</div>
    {bulkAction&&<Modal title={t("details.files", { value: (bulkAction.type==='stage'?uiText("details.stage"):uiText("details.unstage")), value2: (bulkAction.filtered ? t("details.text") : t("details.all")), count: (bulkAction.paths.length), value3: (bulkAction.filtered?'matching ':'') })} onClose={()=>setBulkAction(undefined)} footer={<><Button onClick={()=>setBulkAction(undefined)}>{t("common.cancel")}</Button><Button data-autofocus="true" className="primary" onClick={()=>{const {type,paths}=bulkAction;setBulkAction(undefined);void state.execute({type,paths});}}>{bulkAction.filtered?`${bulkAction.type==='stage'?uiText("details.stage"):uiText("details.unstage")} ${t("details.matching")}`:bulkAction.type==='stage'?uiText("details.stageAll"):uiText("details.unstageAll")}</Button></>}>{null}</Modal>}
  </>;
}

export const Details = memo(DetailsPanel);
