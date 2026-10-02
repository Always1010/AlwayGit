import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { Change, CommitDetails, CommitFile, DiffTarget } from '../src/protocol/types';
import type { DialogRequest } from './ActionDialog';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { rpc } from './rpc';
import { Button, Empty, Icon, Modal } from './ui';
import { filePathLabel, fileSelectionForClick, filterFilesByPath, reconcileFileSelection, type FileSelection } from './fileSelection';
import { handleSelectionKeyboard } from './selectionKeyboard';
import type { ContextHandler } from './Sidebar';

function FileLabel({ path }: { path: string }) {
  const label = filePathLabel(path);
  return <span className="file-label"><span className="file-basename">{label.name}</span><span className="file-parent-path">{label.parent}</span></span>;
}

function fileStatusLabel(status: string, t: ReturnType<typeof useTranslation>) {
  const labels: Record<string, [string, string]> = {
    '?': ['Untracked', '未跟踪'], A: ['Added', '新增'], M: ['Modified', '已修改'], D: ['Deleted', '已删除'],
    R: ['Renamed', '已重命名'], C: ['Copied', '已复制'], U: ['Conflict', '冲突'], T: ['Type changed', '类型已更改'],
  };
  return t(...(labels[status[0] || 'M'] ?? ['Changed', '已更改']));
}

function FileStatus({ status }: { status: string }) {
  const t = useTranslation(), key = status[0] || 'M', label = fileStatusLabel(status, t);
  return <span className={`file-status status-${key}`} title={label} role="img" aria-label={label}><Icon name="file-code"/><span className="file-status-badge" aria-hidden="true">{key === 'U' ? '!' : key}</span></span>;
}

function useFileSelection(scope: string, order: string[]) {
  const [saved, setSaved] = useState<{ scope: string; selection: FileSelection }>({ scope, selection: { paths: [] } });
  const signature = JSON.stringify(order), selection = reconcileFileSelection(order, saved.scope === scope ? saved.selection : { paths: [] });
  useEffect(() => { setSaved(old => ({ scope, selection: reconcileFileSelection(order, old.scope === scope ? old.selection : { paths: [] }) })); }, [scope, signature]);
  const update = (change: (current: FileSelection) => FileSelection) => setSaved(old => ({ scope, selection: change(reconcileFileSelection(order, old.scope === scope ? old.selection : { paths: [] })) }));
  const click = (path: string, event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>, replace = false) => update(current => fileSelectionForClick(order, current, path, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey, replace }));
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    handleSelectionKeyboard(event, () => update(() => ({ paths: [...order] })), () => update(() => ({ paths: [] })));
  };
  return { selection, click, keyDown };
}

function FileSelectionHint({ count, clickSelect = false }: { count: number; clickSelect?: boolean }) {
  const t = useTranslation();
  return <div className="file-selection-hint"><span title={t('Ctrl/Cmd+click toggles · Shift+click selects range · Esc clears', 'Ctrl/Cmd+单击切换选择 · Shift+单击范围选择 · Esc 清空')}>{clickSelect?t('Click selects · Ctrl+A selects all files','单击选择 · Ctrl+A 全选文件'):t('Click to preview · Ctrl+A selects files', '单击预览 · Ctrl+A 全选文件')}</span><strong aria-live="polite">{t(`${count} selected`, `已选 ${count} 个`)}</strong></div>;
}

function CommitFiles({ files, scope, filter, onFilterChange, target, empty, emptyAction, edit, context }: { files: CommitFile[]; scope: string; filter: string; onFilterChange(value:string):void; target(file: CommitFile): DiffTarget; empty: string; emptyAction?:ReactNode; edit(): void; context:ContextHandler }) {
  const state = useWorkbench(), t = useTranslation(), visibleFiles = filterFilesByPath(files, filter), batch = useFileSelection(`${state.repoId}:${scope}`, visibleFiles.map(file => file.path)), filtering=!!filter.trim();
  return <div className="file-selection-panel" onKeyDownCapture={batch.keyDown}>
    <div className="file-selection-toolbar"><label className="file-path-filter"><Icon name="search"/><input type="search" aria-label={t('Filter changed file paths', '筛选变更文件路径')} placeholder={t('Filter paths…', '筛选相对路径…')} value={filter} onChange={event=>onFilterChange(event.target.value)}/></label>{filtering&&<span className="file-filter-count" aria-live="polite">{visibleFiles.length} / {files.length}</span>}<Button icon="copy" disabled={!batch.selection.paths.length} onClick={() => void rpc('copyText', state.repoId, { text: batch.selection.paths.join('\n') }).catch(state.report)}>{t('Copy Paths', '复制路径')}{batch.selection.paths.length ? ` (${batch.selection.paths.length})` : ''}</Button></div>
    <FileSelectionHint clickSelect count={batch.selection.paths.length}/>
    <div className="detail-files" tabIndex={0} role="listbox" aria-multiselectable="true" aria-label={t('Changed files', '变更文件')}>{visibleFiles.map(file => { const diff = target(file), preview = state.diffTarget?.kind === diff.kind && state.selectedFile === file.path, checked = batch.selection.paths.includes(file.path); return <div key={file.path} role="option" aria-selected={checked} className={`file-item ${preview ? 'selected' : ''} ${checked ? 'batch-selected' : ''}`} onContextMenu={event=>{const paths=checked?batch.selection.paths:[file.path];if(!checked)batch.click(file.path,event,true);state.selectFile(diff);context(event,{kind:'files',primary:{path:file.path,target:diff},files:paths.map(path=>{const item=visibleFiles.find(candidate=>candidate.path===path)!;return {path,target:target(item)};})});}}>
      <FileStatus status={file.status}/><button className="file-name" aria-label={file.path} title={`${file.previousPath ? `${file.previousPath} → ${file.path}` : file.path} · ${fileStatusLabel(file.status, t)}`} onClick={event => { batch.click(file.path, event, true); state.selectFile(diff); }} onDoubleClick={edit}><FileLabel path={file.path}/></button>
    </div>; })}{!visibleFiles.length && <Empty title={files.length?t('No files match this path filter','没有符合路径筛选的文件'):empty}>{!files.length&&emptyAction}</Empty>}</div>
  </div>;
}

export function Details({ open, edit, context }: { open(dialog:DialogRequest):void; edit():void; context:ContextHandler }) {
  const state=useWorkbench(),t=useTranslation(),detail=state.details,comparison=state.comparison,[fileFilter,setFileFilter]=useState('');
  useEffect(()=>{setFileFilter('');},[state.repoId,state.tab,state.selectedStashSection]);
  const stash=state.selectedStashOid?state.stashDetails:undefined,metadata=stash??detail,bodyLines=metadata?.body.split('\n')??[],body=(bodyLines[0]===metadata?.commit.subject?bodyLines.slice(1):bodyLines).join('\n').trim();
  const stashSections=stash?(Object.entries(stash.sections) as ['working'|'index'|'untracked',CommitDetails][]).filter((entry):entry is ['working'|'index'|'untracked',CommitDetails]=>!!entry[1]):[];
  const sectionLabel=(section:'working'|'index'|'untracked')=>section==='working'?'Working Tree':section==='index'?'Index':t('Untracked Files','未跟踪文件');
  const jump=stashSections.find(([section,value])=>section!==state.selectedStashSection&&value.files.length>0);
  return <section className="details-panel" data-testid="details">
    <div className="pane-heading"><strong>{state.tab==='changes'?t('Working Tree Status','工作区状态'):comparison?t('Compare Commits','比较 Commit'):t('Commit Details','Commit 详情')}</strong>{comparison&&<Button className="icon-only" icon="arrow-swap" title={t('Swap comparison sides','交换比较方向')} aria-label={t('Swap comparison sides','交换比较方向')} onClick={()=>void state.compareCommits(comparison.right.oid,comparison.left.oid,true)}/>}</div>
    {state.tab==='changes'?<WorkingTree open={open} edit={edit} context={context}/>:comparison?<ComparisonDetails filter={fileFilter} onFilterChange={setFileFilter} edit={edit} context={context}/>:!detail?<Empty title={state.detailsLoading?t('Loading details…','正在读取详情…'):t('Select a Commit','选择 Commit')}/>:<>
      <div className="commit-metadata"><strong>{metadata!.commit.subject}</strong><span className="hash" title={metadata!.commit.oid}>{metadata!.commit.oid.slice(0,8)}</span><span>{metadata!.commit.author} &lt;{metadata!.commit.email}&gt;</span><span className="muted">{new Date(metadata!.commit.timestamp*1000).toLocaleString(state.language)}</span>{body&&<pre>{body}</pre>}
        {stash&&<><div className="stash-summary">{t(`${stash.totalFiles} saved file${stash.totalFiles===1?'':'s'}`,`已保存 ${stash.totalFiles} 个文件`)} · {t(`${stash.sections.untracked?.files.length??0} untracked`,`未跟踪文件 ${stash.sections.untracked?.files.length??0} 个`)}</div><div className="stash-tabs" role="tablist" aria-label={t('Stash file categories','Stash 文件分类')}>{stashSections.map(([section,value])=><Button key={section} role="tab" aria-selected={state.selectedStashSection===section} className={`stash-tab ${state.selectedStashSection===section?'selected':''}`} onClick={()=>state.selectStashSection(section)}>{sectionLabel(section)} <span>{value.files.length}</span></Button>)}</div></>}
      </div>
      <div className="pane-heading"><strong>{t('Changed Files','变更文件')} · {detail.files.length}</strong>{!stash&&detail.commit.parents.length>1&&<select aria-label="Compare parent" value={detail.parent??detail.commit.parents[0]} onChange={event=>void state.selectCommit(detail.commit.oid,event.target.value)}>{detail.commit.parents.map((parent,i)=><option key={parent} value={parent}>Parent {i+1} · {parent.slice(0,8)}</option>)}</select>}</div>
      <CommitFiles files={detail.files} scope={`commit:${detail.commit.oid}:${detail.parent??''}`} filter={fileFilter} onFilterChange={setFileFilter} target={file=>({kind:'commit',oid:detail.commit.oid,parent:detail.parent,path:file.path,previousPath:file.previousPath})} empty={jump?t(`This category has no files; ${sectionLabel(jump[0])} has ${jump[1].files.length}.`,`此分类没有内容；${sectionLabel(jump[0])}中有 ${jump[1].files.length} 个文件。`):t('No changed files','没有变更文件')} emptyAction={jump&&<Button icon="arrow-right" onClick={()=>state.selectStashSection(jump[0])}>{t(`Open ${sectionLabel(jump[0])}`,`打开${sectionLabel(jump[0])}`)}</Button>} edit={edit} context={context}/>
    </>}
  </section>;
}

function ComparisonDetails({filter,onFilterChange,edit,context}:{filter:string;onFilterChange(value:string):void;edit():void;context:ContextHandler}){
  const state=useWorkbench(),t=useTranslation(),comparison=state.comparison!;
  return <><div className="comparison-summary"><div><span className="hash">{comparison.left.oid.slice(0,8)}</span><strong>{comparison.left.subject}</strong></div><Icon name="arrow-right"/><div><span className="hash">{comparison.right.oid.slice(0,8)}</span><strong>{comparison.right.subject}</strong></div></div><div className="pane-heading"><strong>{t('Changed Files','变更文件')} · {comparison.files.length}</strong></div><CommitFiles files={comparison.files} scope={`comparison:${comparison.left.oid}:${comparison.right.oid}`} filter={filter} onFilterChange={onFilterChange} target={file=>({kind:'comparison',left:comparison.left.oid,right:comparison.right.oid,path:file.path,previousPath:file.previousPath})} empty={t('The selected Commits have identical file contents','所选 Commit 的文件内容相同')} edit={edit} context={context}/></>;
}

function WorkingTree({ open, edit, context }: { open(dialog:DialogRequest):void; edit():void; context:ContextHandler }) {
  const state=useWorkbench(),snapshot=state.snapshot!,t=useTranslation(),[amend,setAmend]=useState(false),[bulkAction,setBulkAction]=useState<{type:'stage'|'unstage';paths:string[]}>();
  const [collapsed, setCollapsed] = useState({ conflict: false, unstaged: false, staged: false });
  useEffect(()=>{if(snapshot.operation.kind)setAmend(false);},[snapshot.operation.kind]);
  useEffect(()=>{setAmend(false);setBulkAction(undefined);setCollapsed({conflict:false,unstaged:false,staged:false});},[state.repoId]);
  const staged=snapshot.changes.filter(c=>!c.conflict&&c.indexStatus!==' '&&c.indexStatus!=='?'&&!!c.indexStatus),unstaged=snapshot.changes.filter(c=>!c.conflict&&(c.untracked||c.worktreeStatus!==' '&&!!c.worktreeStatus)),conflicts=snapshot.changes.filter(c=>c.conflict);
  const fileKey=(area:string,path:string)=>JSON.stringify([area,path]);
  const order=[...(!collapsed.conflict?conflicts.map(file=>fileKey('conflict',file.path)):[]),...(!collapsed.unstaged?unstaged.map(file=>fileKey('unstaged',file.path)):[]),...(!collapsed.staged?staged.map(file=>fileKey('staged',file.path)):[])],batch=useFileSelection(`${state.repoId}:changes`,order);
  const group=(area:'staged'|'unstaged'|'conflict',files:Change[])=>{
    const selection=files.filter(file=>batch.selection.paths.includes(fileKey(area,file.path))).map(file=>file.path),targets=area==='conflict'&&selection.length?selection:files.map(file=>file.path),action=area==='staged'?'unstage':area==='conflict'?'resolve-and-stage':'stage';
    const label=area==='staged'?'Staged':area==='unstaged'?'Unstaged':t('Conflicts','冲突'),verb=area==='staged'?'Unstage':area==='conflict'?t('Manually handled: Mark & Stage','已手动处理，标记并暂存'):'Stage';
    const toggleLabel=collapsed[area]?t(`Expand ${label}`,`展开 ${label}`):t(`Collapse ${label}`,`收起 ${label}`);
    const actionLabel=`${verb}${area==='conflict'&&selection.length?` (${selection.length})`:' All'}`;
    return <div className="change-group" key={area}><div className={`change-heading change-heading-${area}`}><button type="button" className="change-heading-label" title={toggleLabel} aria-label={toggleLabel} aria-expanded={!collapsed[area]} aria-controls={`change-files-${area}`} onClick={()=>setCollapsed(value=>({...value,[area]:!value[area]}))}><Icon name={collapsed[area]?'chevron-right':'chevron-down'}/><strong>{label}</strong><span className="change-count" aria-label={`${files.length} files`}>{files.length}</span></button><div className="change-actions"><Button className={`change-action change-action-${area}${area!=='conflict'?' icon-only':''}`} icon={area==='staged'?'discard':area==='unstaged'?'stage-inbox':undefined} title={actionLabel} aria-label={actionLabel} disabled={!targets.length||state.busy} onClick={()=>{if(area!=='conflict')setBulkAction({type:action as 'stage'|'unstage',paths:targets});else void state.execute({type:action,paths:targets});}}>{area==='conflict'?actionLabel:null}</Button>{area==='unstaged'&&<Button className="icon-only change-discard" icon="trash" title={t('Discard All…','Discard All · 丢弃全部未暂存更改…')} aria-label={t('Discard All…','Discard All · 丢弃全部未暂存更改…')} disabled={!files.length||state.busy} onClick={()=>open({type:'discard',paths:files.map(file=>file.path)})}/>}</div></div>
      <div id={`change-files-${area}`} hidden={collapsed[area]}>
      {files.map(file=>{const target:DiffTarget={kind:'change',area,path:file.path},key=fileKey(area,file.path),chosen=state.diffTarget?.kind==='change'&&state.diffTarget.area===area&&state.selectedFile===file.path,checked=selection.includes(file.path),status=file.conflict?'U':file.untracked?'?':area==='staged'?file.indexStatus:file.worktreeStatus;return <div key={file.path} role="option" aria-selected={checked} className={`change-file ${chosen?'selected':''} ${checked?'batch-selected':''}`} onContextMenu={event=>{const keys=batch.selection.paths.includes(key)?batch.selection.paths:[key];if(!batch.selection.paths.includes(key))batch.click(key,event,true);state.selectFile(target);context(event,{kind:'files',primary:{path:file.path,target},files:keys.map(value=>{const [selectedArea,path]=JSON.parse(value) as ['staged'|'unstaged'|'conflict',string];return {path,target:{kind:'change',area:selectedArea,path} as DiffTarget};})});}}><FileStatus status={status}/><button className="file-name" aria-label={file.path} title={`${file.originalPath?`${file.originalPath} → ${file.path}`:file.path} · ${fileStatusLabel(status,t)} · ${label}`} onClick={event=>{batch.click(key,event,true);state.selectFile(target);}} onDoubleClick={edit}><FileLabel path={file.path}/></button>{area==='conflict'&&<Button className="icon-only" icon="edit" title={t('Edit and save in VS Code, then return to mark and stage','在 VS Code 中编辑保存，再返回这里标记并暂存')} aria-label={t('Edit conflict file in VS Code','在 VS Code 中编辑冲突文件')} disabled={state.busy} onClick={()=>{state.selectFile(target);edit();}}/>}</div>;})}
      {area==='conflict'&&<p className="conflict-instructions">{t('View the conflict, edit and save the file, then mark and stage it. This does not choose the correct content or verify your resolution.','先查看冲突，再编辑保存文件，最后标记并暂存。此操作不会自动选择正确内容，也不验证处理结果。')}</p>}
      {!files.length&&<div className="change-empty">{t('No changes','没有变更')}</div>}
      </div>
    </div>;
  };
  return <><div className="working-summary"><span>{snapshot.branch||'Detached HEAD'}</span><span className="muted">Staged {staged.length} · Unstaged {unstaged.length}</span></div><div className="change-groups" tabIndex={0} role="listbox" aria-multiselectable="true" aria-label={t('Working tree files','工作区文件')} onKeyDownCapture={batch.keyDown}><FileSelectionHint clickSelect count={new Set(batch.selection.paths.map(key=>(JSON.parse(key) as string[])[1])).size}/>{!!conflicts.length&&group('conflict',conflicts)}{group('unstaged',unstaged)}{group('staged',staged)}</div>
    <form className="commit-form" onSubmit={event=>{event.preventDefault();const repoId=state.repoId;void state.execute({type:'commit',message:(state.drafts[repoId!]??'').trim(),amend}).then(success=>{if(success&&useWorkbench.getState().repoId===repoId){state.setDraft('');setAmend(false);}});}}>
      <label htmlFor="ag-commit-message">{t('Commit Message','Commit 信息')}</label><textarea id="ag-commit-message" aria-label="Commit message" placeholder={t('Describe your changes…','描述这次变更…')} value={state.drafts[state.repoId!]??''} onChange={event=>state.setDraft(event.target.value)} disabled={state.busy}/>
      <div className="commit-options"><label><input type="checkbox" checked={amend} disabled={!snapshot.head||state.busy||!!snapshot.operation.kind} onChange={event=>{setAmend(event.target.checked);if(event.target.checked&&!state.drafts[state.repoId!]){const repoId=state.repoId;void rpc<{body:string;commit:{subject:string}}>('details',repoId,{oid:snapshot.head}).then(detail=>{if(useWorkbench.getState().repoId===repoId&&!useWorkbench.getState().drafts[repoId!])state.setDraft(detail.body||detail.commit.subject);}).catch(state.report);}}}/>Amend</label><span className="muted">{staged.length} Staged</span><Button type="submit" className="primary" disabled={state.busy||!state.drafts[state.repoId!]?.trim()||!!conflicts.length||!amend&&!staged.length}>{amend?'Amend Commit':'Commit'}</Button></div><p className="muted commit-note">{t('Only Staged Changes are committed.','Commit 仅包含 Staged Changes。')}</p>
    </form>
    {bulkAction&&<Modal title={bulkAction.type==='stage'?t(`Stage all ${bulkAction.paths.length} file${bulkAction.paths.length===1?'':'s'}?`,`Stage 全部 ${bulkAction.paths.length} 个文件？`):t(`Unstage all ${bulkAction.paths.length} file${bulkAction.paths.length===1?'':'s'}?`,`Unstage 全部 ${bulkAction.paths.length} 个文件？`)} onClose={()=>setBulkAction(undefined)} footer={<><Button onClick={()=>setBulkAction(undefined)}>{t('Cancel','取消')}</Button><Button data-autofocus="true" className="primary" onClick={()=>{const action=bulkAction;setBulkAction(undefined);void state.execute(action);}}>{bulkAction.type==='stage'?'Stage All':'Unstage All'}</Button></>}>{null}</Modal>}
  </>;
}
