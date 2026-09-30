import { useEffect, useState } from 'react';
import type { Change, DiffTarget } from '../src/protocol/types';
import type { DialogRequest } from './ActionDialog';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { rpc } from './rpc';
import { Button, Empty, Icon } from './ui';

export function Details({ open, edit }: { open(dialog:DialogRequest):void; edit():void }) {
  const state=useWorkbench(),t=useTranslation(),detail=state.details;
  return <section className="details-panel" data-testid="details">
    <div className="pane-heading"><strong>{state.tab==='changes'?t('Working Tree Status','工作区状态'):t('Commit Details','Commit 详情')}</strong></div>
    {state.tab==='changes'?<WorkingTree open={open} edit={edit}/>:!detail?<Empty title={state.detailsLoading?t('Loading details…','正在读取详情…'):t('Select a Commit','选择 Commit')}/>:<>
      <div className="commit-metadata"><strong>{detail.commit.subject}</strong><span className="hash" title={detail.commit.oid}>{detail.commit.oid.slice(0,8)}</span><span>{detail.commit.author} &lt;{detail.commit.email}&gt;</span><span className="muted">{new Date(detail.commit.timestamp*1000).toLocaleString(state.language)}</span><pre>{detail.body||detail.commit.subject}</pre>
        {state.selectedStashOid&&state.stashDetails&&<div className="stash-tabs"><Button onClick={()=>void state.selectCommit(state.selectedStashOid!,undefined,state.selectedStashOid)}>Working Tree</Button>{state.stashDetails.commit.parents[1]&&<Button onClick={()=>void state.selectCommit(state.stashDetails!.commit.parents[1],undefined,state.selectedStashOid)}>Index</Button>}{state.stashDetails.commit.parents[2]&&<Button onClick={()=>void state.selectCommit(state.stashDetails!.commit.parents[2],undefined,state.selectedStashOid)}>{t('Untracked Files','未跟踪文件')}</Button>}</div>}
      </div>
      <div className="pane-heading"><strong>{t('Changed Files','变更文件')} · {detail.files.length}</strong>{detail.commit.parents.length>1&&<select aria-label="Compare parent" value={detail.parent??detail.commit.parents[0]} onChange={event=>void state.selectCommit(detail.commit.oid,event.target.value,state.selectedStashOid)}>{detail.commit.parents.map((parent,i)=><option key={parent} value={parent}>Parent {i+1} · {parent.slice(0,8)}</option>)}</select>}</div>
      <div className="detail-files">{detail.files.map(file=><button key={file.path} className={`file-item ${state.selectedFile===file.path?'selected':''}`} title={file.previousPath?`${file.previousPath} → ${file.path}`:file.path} onClick={()=>state.selectFile({kind:'commit',oid:detail.commit.oid,parent:detail.parent,path:file.path,previousPath:file.previousPath})} onDoubleClick={edit}><span className={`file-status status-${file.status[0]}`}>{file.status}</span><Icon name="file-code"/><span className="truncate">{file.path}</span></button>)}{!detail.files.length&&<Empty title={t('No changed files','没有变更文件')}/>}</div>
    </>}
  </section>;
}

function WorkingTree({ open, edit }: { open(dialog:DialogRequest):void; edit():void }) {
  const state=useWorkbench(),snapshot=state.snapshot!,t=useTranslation(),[selected,setSelected]=useState<Record<string,string[]>>({staged:[],unstaged:[],conflict:[]}),[amend,setAmend]=useState(false);
  useEffect(()=>{setSelected({staged:[],unstaged:[],conflict:[]});setAmend(false);},[state.repoId]);
  const staged=snapshot.changes.filter(c=>!c.conflict&&c.indexStatus!==' '&&c.indexStatus!=='?'&&!!c.indexStatus),unstaged=snapshot.changes.filter(c=>!c.conflict&&(c.untracked||c.worktreeStatus!==' '&&!!c.worktreeStatus)),conflicts=snapshot.changes.filter(c=>c.conflict);
  const group=(area:'staged'|'unstaged'|'conflict',files:Change[])=>{
    const selection=selected[area].filter(path=>files.some(f=>f.path===path)),targets=selection.length?selection:files.map(f=>f.path),action=area==='staged'?'unstage':'stage';
    return <div className="change-group" key={area}><div className="change-heading"><label><input type="checkbox" aria-label={`Select all ${area} files`} checked={!!files.length&&selection.length===files.length} disabled={!files.length} onChange={e=>setSelected(old=>({...old,[area]:e.target.checked?files.map(f=>f.path):[]}))}/></label><strong>{area==='staged'?'Staged Changes':area==='unstaged'?'Unstaged Changes':t('Conflicts','冲突')} · {files.length}</strong><Button disabled={!targets.length||state.busy} onClick={()=>void state.execute({type:action,paths:targets})}>{area==='staged'?'Unstage':area==='conflict'?'Mark Resolved':'Stage'}{selection.length?` (${selection.length})`:' All'}</Button>{area==='unstaged'&&<Button icon="discard" title="Discard Changes…" aria-label="Discard Changes…" disabled={!targets.length||state.busy} onClick={()=>open({type:'discard',paths:targets})}/>}</div>
      {files.map(file=>{const target:DiffTarget={kind:'change',area,path:file.path},chosen=state.diffTarget?.kind==='change'&&state.diffTarget.area===area&&state.selectedFile===file.path;return <div key={file.path} className={`change-file ${chosen?'selected':''}`}><input type="checkbox" aria-label={`Select ${file.path} in ${area}`} checked={selection.includes(file.path)} onChange={e=>setSelected(old=>({...old,[area]:e.target.checked?[...selection,file.path]:selection.filter(p=>p!==file.path)}))}/><span className={`file-status status-${file.conflict?'U':file.untracked?'A':area==='staged'?file.indexStatus:file.worktreeStatus}`}>{file.conflict?'U':file.untracked?'?':area==='staged'?file.indexStatus:file.worktreeStatus}</span><button className="file-name truncate" title={file.path} onClick={()=>state.selectFile(target)} onDoubleClick={edit}>{file.path}</button></div>;})}
      {!files.length&&<div className="change-empty">{t('No changes','没有变更')}</div>}
    </div>;
  };
  return <><div className="working-summary"><span>{snapshot.branch||'Detached HEAD'}</span><span className="muted">Staged {staged.length} · Unstaged {unstaged.length}</span></div><div className="change-groups">{!!conflicts.length&&group('conflict',conflicts)}{group('unstaged',unstaged)}{group('staged',staged)}</div>
    <form className="commit-form" onSubmit={event=>{event.preventDefault();const repoId=state.repoId;void state.execute({type:'commit',message:(state.drafts[repoId!]??'').trim(),amend}).then(success=>{if(success&&useWorkbench.getState().repoId===repoId){state.setDraft('');setAmend(false);}});}}>
      <label htmlFor="ag-commit-message">{t('Commit Message','Commit 信息')}</label><textarea id="ag-commit-message" aria-label="Commit message" placeholder={t('Describe your changes…','描述这次变更…')} value={state.drafts[state.repoId!]??''} onChange={event=>state.setDraft(event.target.value)} disabled={state.busy}/>
      <div className="commit-options"><label><input type="checkbox" checked={amend} disabled={!snapshot.head||state.busy} onChange={event=>{setAmend(event.target.checked);if(event.target.checked&&!state.drafts[state.repoId!]){const repoId=state.repoId;void rpc<{body:string;commit:{subject:string}}>('details',repoId,{oid:snapshot.head}).then(detail=>{if(useWorkbench.getState().repoId===repoId&&!useWorkbench.getState().drafts[repoId!])state.setDraft(detail.body||detail.commit.subject);}).catch(state.report);}}}/>Amend</label><span className="muted">{staged.length} Staged</span><Button type="submit" className="primary" disabled={state.busy||!state.drafts[state.repoId!]?.trim()||!!conflicts.length||!amend&&!staged.length}>{amend?'Amend Commit':'Commit'}</Button></div><p className="muted commit-note">{t('Only Staged Changes are committed.','Commit 仅包含 Staged Changes。')}</p>
    </form>
  </>;
}
