import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { Change, CommitFile, DiffTarget } from '../src/protocol/types';
import type { DialogRequest } from './ActionDialog';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { rpc } from './rpc';
import { Button, Empty, Icon } from './ui';
import { filePathLabel, fileSelectionForClick, fileSelectionKeyboardCommand, fileSelectionTargets, filterFilesByPath, reconcileFileSelection, type FileSelection } from './fileSelection';
import type { ContextHandler } from './Sidebar';

function FileLabel({ path }: { path: string }) {
  const label = filePathLabel(path);
  return <span className="file-label"><span className="file-basename">{label.name}</span><span className="file-parent-path">{label.parent}</span></span>;
}

function useFileSelection(scope: string, order: string[]) {
  const [saved, setSaved] = useState<{ scope: string; selection: FileSelection }>({ scope, selection: { paths: [] } });
  const signature = JSON.stringify(order), selection = reconcileFileSelection(order, saved.scope === scope ? saved.selection : { paths: [] });
  useEffect(() => { setSaved(old => ({ scope, selection: reconcileFileSelection(order, old.scope === scope ? old.selection : { paths: [] }) })); }, [scope, signature]);
  const update = (change: (current: FileSelection) => FileSelection) => setSaved(old => ({ scope, selection: change(reconcileFileSelection(order, old.scope === scope ? old.selection : { paths: [] })) }));
  const click = (path: string, event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>, replace = false) => update(current => fileSelectionForClick(order, current, path, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey, replace }));
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement, input = target.closest('input');
    const editable = !!target.closest('textarea,[contenteditable]:not([contenteditable="false"])') || !!input && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(input.type);
    const command = fileSelectionKeyboardCommand(event.key, event, editable);
    if (!command) return;
    event.preventDefault(); event.stopPropagation();
    update(() => ({ paths: command === 'all' ? [...order] : [] }));
  };
  return { selection, click, keyDown };
}

function FileSelectionHint({ count, clickSelect = false }: { count: number; clickSelect?: boolean }) {
  const t = useTranslation();
  return <div className="file-selection-hint"><span title={t('Ctrl/Cmd+click toggles · Shift+click selects range · Esc clears', 'Ctrl/Cmd+单击切换选择 · Shift+单击范围选择 · Esc 清空')}>{clickSelect?t('Click selects · Ctrl+A selects all files','单击选择 · Ctrl+A 全选文件'):t('Click to preview · Ctrl+A selects files', '单击预览 · Ctrl+A 全选文件')}</span><strong aria-live="polite">{t(`${count} selected`, `已选 ${count} 个`)}</strong></div>;
}

function CommitFiles({ files, scope, filter, onFilterChange, target, empty, edit, context }: { files: CommitFile[]; scope: string; filter: string; onFilterChange(value:string):void; target(file: CommitFile): DiffTarget; empty: string; edit(): void; context:ContextHandler }) {
  const state = useWorkbench(), t = useTranslation(), visibleFiles = filterFilesByPath(files, filter), batch = useFileSelection(`${state.repoId}:${scope}`, visibleFiles.map(file => file.path)), filtering=!!filter.trim();
  return <div className="file-selection-panel" onKeyDown={batch.keyDown}>
    <div className="file-selection-toolbar"><label className="file-path-filter"><Icon name="search"/><input type="search" aria-label={t('Filter changed file paths', '筛选变更文件路径')} placeholder={t('Filter paths…', '筛选相对路径…')} value={filter} onChange={event=>onFilterChange(event.target.value)}/></label>{filtering&&<span className="file-filter-count" aria-live="polite">{visibleFiles.length} / {files.length}</span>}<Button icon="copy" disabled={!batch.selection.paths.length} onClick={() => void rpc('copyText', state.repoId, { text: batch.selection.paths.join('\n') }).catch(state.report)}>{t('Copy Paths', '复制路径')}{batch.selection.paths.length ? ` (${batch.selection.paths.length})` : ''}</Button></div>
    <FileSelectionHint clickSelect count={batch.selection.paths.length}/>
    <div className="detail-files" tabIndex={0} role="listbox" aria-multiselectable="true" aria-label={t('Changed files', '变更文件')}>{visibleFiles.map(file => { const diff = target(file), preview = state.diffTarget?.kind === diff.kind && state.selectedFile === file.path, checked = batch.selection.paths.includes(file.path); return <div key={file.path} role="option" aria-selected={checked} className={`file-item ${preview ? 'selected' : ''} ${checked ? 'batch-selected' : ''}`} onContextMenu={event=>{const paths=checked?batch.selection.paths:[file.path];if(!checked)batch.click(file.path,event,true);state.selectFile(diff);context(event,{kind:'files',primary:{path:file.path,target:diff},files:paths.map(path=>{const item=visibleFiles.find(candidate=>candidate.path===path)!;return {path,target:target(item)};})});}}>
      <span className={`file-status status-${file.status[0]}`}>{file.status}</span><Icon name="file-code"/><button className="file-name" aria-label={file.path} title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path} onClick={event => { batch.click(file.path, event, true); state.selectFile(diff); }} onDoubleClick={edit}><FileLabel path={file.path}/></button>
    </div>; })}{!visibleFiles.length && <Empty title={files.length?t('No files match this path filter','没有符合路径筛选的文件'):empty}/>}</div>
  </div>;
}

export function Details({ open, edit, context }: { open(dialog:DialogRequest):void; edit():void; context:ContextHandler }) {
  const state=useWorkbench(),t=useTranslation(),detail=state.details,comparison=state.comparison,[fileFilter,setFileFilter]=useState('');
  useEffect(()=>{setFileFilter('');},[state.repoId,state.tab]);
  const bodyLines=detail?.body.split('\n')??[],body=(bodyLines[0]===detail?.commit.subject?bodyLines.slice(1):bodyLines).join('\n').trim();
  return <section className="details-panel" data-testid="details">
    <div className="pane-heading"><strong>{state.tab==='changes'?t('Working Tree Status','工作区状态'):comparison?t('Compare Commits','比较 Commit'):t('Commit Details','Commit 详情')}</strong>{comparison&&<Button className="icon-only" icon="arrow-swap" title={t('Swap comparison sides','交换比较方向')} aria-label={t('Swap comparison sides','交换比较方向')} onClick={()=>void state.compareCommits(comparison.right.oid,comparison.left.oid,true)}/>}</div>
    {state.tab==='changes'?<WorkingTree open={open} edit={edit} context={context}/>:comparison?<ComparisonDetails filter={fileFilter} onFilterChange={setFileFilter} edit={edit} context={context}/>:!detail?<Empty title={state.detailsLoading?t('Loading details…','正在读取详情…'):t('Select a Commit','选择 Commit')}/>:<>
      <div className="commit-metadata"><strong>{detail.commit.subject}</strong><span className="hash" title={detail.commit.oid}>{detail.commit.oid.slice(0,8)}</span><span>{detail.commit.author} &lt;{detail.commit.email}&gt;</span><span className="muted">{new Date(detail.commit.timestamp*1000).toLocaleString(state.language)}</span>{body&&<pre>{body}</pre>}
        {state.selectedStashOid&&state.stashDetails&&<div className="stash-tabs"><Button onClick={()=>void state.selectCommit(state.selectedStashOid!,undefined,state.selectedStashOid)}>Working Tree</Button>{state.stashDetails.commit.parents[1]&&<Button onClick={()=>void state.selectCommit(state.stashDetails!.commit.parents[1],undefined,state.selectedStashOid)}>Index</Button>}{state.stashDetails.commit.parents[2]&&<Button onClick={()=>void state.selectCommit(state.stashDetails!.commit.parents[2],undefined,state.selectedStashOid)}>{t('Untracked Files','未跟踪文件')}</Button>}</div>}
      </div>
      <div className="pane-heading"><strong>{t('Changed Files','变更文件')} · {detail.files.length}</strong>{detail.commit.parents.length>1&&<select aria-label="Compare parent" value={detail.parent??detail.commit.parents[0]} onChange={event=>void state.selectCommit(detail.commit.oid,event.target.value,state.selectedStashOid)}>{detail.commit.parents.map((parent,i)=><option key={parent} value={parent}>Parent {i+1} · {parent.slice(0,8)}</option>)}</select>}</div>
      <CommitFiles files={detail.files} scope={`commit:${detail.commit.oid}:${detail.parent??''}`} filter={fileFilter} onFilterChange={setFileFilter} target={file=>({kind:'commit',oid:detail.commit.oid,parent:detail.parent,path:file.path,previousPath:file.previousPath})} empty={t('No changed files','没有变更文件')} edit={edit} context={context}/>
    </>}
  </section>;
}

function ComparisonDetails({filter,onFilterChange,edit,context}:{filter:string;onFilterChange(value:string):void;edit():void;context:ContextHandler}){
  const state=useWorkbench(),t=useTranslation(),comparison=state.comparison!;
  return <><div className="comparison-summary"><div><span className="hash">{comparison.left.oid.slice(0,8)}</span><strong>{comparison.left.subject}</strong></div><Icon name="arrow-right"/><div><span className="hash">{comparison.right.oid.slice(0,8)}</span><strong>{comparison.right.subject}</strong></div></div><div className="pane-heading"><strong>{t('Changed Files','变更文件')} · {comparison.files.length}</strong></div><CommitFiles files={comparison.files} scope={`comparison:${comparison.left.oid}:${comparison.right.oid}`} filter={filter} onFilterChange={onFilterChange} target={file=>({kind:'comparison',left:comparison.left.oid,right:comparison.right.oid,path:file.path,previousPath:file.previousPath})} empty={t('The selected Commits have identical file contents','所选 Commit 的文件内容相同')} edit={edit} context={context}/></>;
}

function WorkingTree({ open, edit, context }: { open(dialog:DialogRequest):void; edit():void; context:ContextHandler }) {
  const state=useWorkbench(),snapshot=state.snapshot!,t=useTranslation(),[amend,setAmend]=useState(false);
  useEffect(()=>{setAmend(false);},[state.repoId]);
  const staged=snapshot.changes.filter(c=>!c.conflict&&c.indexStatus!==' '&&c.indexStatus!=='?'&&!!c.indexStatus),unstaged=snapshot.changes.filter(c=>!c.conflict&&(c.untracked||c.worktreeStatus!==' '&&!!c.worktreeStatus)),conflicts=snapshot.changes.filter(c=>c.conflict);
  const fileKey=(area:string,path:string)=>JSON.stringify([area,path]);
  const order=[...conflicts.map(file=>fileKey('conflict',file.path)),...unstaged.map(file=>fileKey('unstaged',file.path)),...staged.map(file=>fileKey('staged',file.path))],batch=useFileSelection(`${state.repoId}:changes`,order);
  const group=(area:'staged'|'unstaged'|'conflict',files:Change[])=>{
    const selection=files.filter(file=>batch.selection.paths.includes(fileKey(area,file.path))).map(file=>file.path),targets=fileSelectionTargets(files.map(file=>file.path),{paths:selection},true),action=area==='staged'?'unstage':'stage';
    const label=area==='staged'?'Staged':area==='unstaged'?'Unstaged':t('Conflicts','冲突'),verb=area==='staged'?'Unstage':area==='conflict'?'Mark Resolved':'Stage';
    return <div className="change-group" key={area}><div className={`change-heading change-heading-${area}`}><div className="change-heading-label"><strong title={label}>{label}</strong><span className="change-count" aria-label={`${files.length} files`}>{files.length}</span></div><div className="change-actions"><Button className={`change-action change-action-${area}`} disabled={!targets.length||state.busy} onClick={()=>void state.execute({type:action,paths:targets})}>{verb}{selection.length?` (${selection.length})`:' All'}</Button>{area==='unstaged'&&<Button className="icon-only change-discard" icon="discard" title={t('Discard selected files…','丢弃所选文件…')} aria-label={t('Discard selected files…','丢弃所选文件…')} disabled={!selection.length||state.busy} onClick={()=>open({type:'discard',paths:selection})}/>}</div></div>
      {files.map(file=>{const target:DiffTarget={kind:'change',area,path:file.path},key=fileKey(area,file.path),chosen=state.diffTarget?.kind==='change'&&state.diffTarget.area===area&&state.selectedFile===file.path,checked=selection.includes(file.path);return <div key={file.path} role="option" aria-selected={checked} className={`change-file ${chosen?'selected':''} ${checked?'batch-selected':''}`} onContextMenu={event=>{const keys=batch.selection.paths.includes(key)?batch.selection.paths:[key];if(!batch.selection.paths.includes(key))batch.click(key,event,true);state.selectFile(target);context(event,{kind:'files',primary:{path:file.path,target},files:keys.map(value=>{const [selectedArea,path]=JSON.parse(value) as ['staged'|'unstaged'|'conflict',string];return {path,target:{kind:'change',area:selectedArea,path} as DiffTarget};})});}}><span className={`file-status status-${file.conflict?'U':file.untracked?'A':area==='staged'?file.indexStatus:file.worktreeStatus}`}>{file.conflict?'U':file.untracked?'?':area==='staged'?file.indexStatus:file.worktreeStatus}</span><button className="file-name" aria-label={file.path} title={file.originalPath?`${file.originalPath} → ${file.path}`:file.path} onClick={event=>{batch.click(key,event,true);state.selectFile(target);}} onDoubleClick={edit}><FileLabel path={file.path}/></button></div>;})}
      {!files.length&&<div className="change-empty">{t('No changes','没有变更')}</div>}
    </div>;
  };
  return <><div className="working-summary"><span>{snapshot.branch||'Detached HEAD'}</span><span className="muted">Staged {staged.length} · Unstaged {unstaged.length}</span></div><div className="change-groups" tabIndex={0} role="listbox" aria-multiselectable="true" aria-label={t('Working tree files','工作区文件')} onKeyDown={batch.keyDown}><FileSelectionHint clickSelect count={new Set(batch.selection.paths.map(key=>(JSON.parse(key) as string[])[1])).size}/>{!!conflicts.length&&group('conflict',conflicts)}{group('unstaged',unstaged)}{group('staged',staged)}</div>
    <form className="commit-form" onSubmit={event=>{event.preventDefault();const repoId=state.repoId;void state.execute({type:'commit',message:(state.drafts[repoId!]??'').trim(),amend}).then(success=>{if(success&&useWorkbench.getState().repoId===repoId){state.setDraft('');setAmend(false);}});}}>
      <label htmlFor="ag-commit-message">{t('Commit Message','Commit 信息')}</label><textarea id="ag-commit-message" aria-label="Commit message" placeholder={t('Describe your changes…','描述这次变更…')} value={state.drafts[state.repoId!]??''} onChange={event=>state.setDraft(event.target.value)} disabled={state.busy}/>
      <div className="commit-options"><label><input type="checkbox" checked={amend} disabled={!snapshot.head||state.busy} onChange={event=>{setAmend(event.target.checked);if(event.target.checked&&!state.drafts[state.repoId!]){const repoId=state.repoId;void rpc<{body:string;commit:{subject:string}}>('details',repoId,{oid:snapshot.head}).then(detail=>{if(useWorkbench.getState().repoId===repoId&&!useWorkbench.getState().drafts[repoId!])state.setDraft(detail.body||detail.commit.subject);}).catch(state.report);}}}/>Amend</label><span className="muted">{staged.length} Staged</span><Button type="submit" className="primary" disabled={state.busy||!state.drafts[state.repoId!]?.trim()||!!conflicts.length||!amend&&!staged.length}>{amend?'Amend Commit':'Commit'}</Button></div><p className="muted commit-note">{t('Only Staged Changes are committed.','Commit 仅包含 Staged Changes。')}</p>
    </form>
  </>;
}
