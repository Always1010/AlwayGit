import { useState } from 'react';
import type { DialogRequest } from './ActionDialog';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { Button, Modal } from './ui';
import { remoteBranchName, trackingCandidates, trackingConflict } from './remoteTracking';

export function RemoteTrackingDialog({ dialog, onClose }: { dialog: DialogRequest; onClose(): void }) {
  const state = useWorkbench(), t = useTranslation(), snapshot = state.snapshot!;
  const [sources] = useState(() => snapshot.refs.filter(ref => ref.kind === 'remote' && !ref.symbolicTarget && (dialog.sources ?? [dialog.target]).includes(ref.fullName)));
  const batch = dialog.batch ?? sources.length > 1;
  const [names, setNames] = useState(() => sources.map(ref => trackingCandidates(ref, snapshot)[0]?.name ?? remoteBranchName(ref, snapshot)));
  const [checkout, setCheckout] = useState(dialog.checkout ?? !batch);
  const [completed, setCompleted] = useState<string[]>();
  const [validation, setValidation] = useState<string>();
  const conflicts = sources.map((ref, index) => trackingConflict(ref, names[index].trim(), snapshot, names.map(name => name.trim())));
  const labels: Record<string, string> = {name:t('Enter a local branch name.','请输入本地分支名称。'),duplicate:t('Duplicate local name.','本地名称重复。'),upstream:t('Name already exists with a different upstream.','同名本地分支已有其他 upstream。'),prefix:t('Branch name conflicts with another branch path.','分支名称与另一分支的路径冲突。')};
  const title = batch ? t('Create Local Tracking Branches','创建本地跟踪分支') : t('Checkout as Local Branch','Checkout 到本地分支');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setValidation(undefined);
    if (!sources.length || conflicts.some(Boolean)) { setValidation(t('Resolve the branch name conflicts before continuing.','请先解决分支名称冲突。')); return; }
    const existed = sources.map((ref,index) => trackingCandidates(ref,snapshot).some(local => local.name === names[index].trim()));
    const repoId = state.repoId;
    if (await state.execute({type:'branch.track',branches:sources.map((ref,index)=>({source:ref.fullName,name:names[index].trim(),expectedOid:ref.oid})),checkout:!batch&&checkout})) {
      const latest=useWorkbench.getState(); if(latest.repoId!==repoId)return;
      setCompleted(existed.map(value=>value?t('Already tracked','已跟踪'):t('Created','已创建')));
      if(!batch&&checkout&&latest.snapshot?.head)void latest.selectCommit(latest.snapshot.head);
    }
  }
  return <Modal title={title} busy={state.busy} onClose={onClose} footer={completed?<Button className="primary" onClick={onClose}>{t('Done','完成')}</Button>:<><Button disabled={state.busy} onClick={onClose}>{t('Cancel','取消')}</Button><Button type="submit" form="ag-track-form" className="primary" disabled={state.busy||!sources.length||conflicts.some(Boolean)}>{state.busy?t('Working…','处理中…'):!batch&&checkout?t('Create & Checkout','创建并 Checkout'):t('Create Local Branches','创建本地分支')}</Button></>}>
    <form id="ag-track-form" className="action-form" onSubmit={event=>void submit(event)}>
      <p className="muted">{snapshot.repository.name} · {t('Tracking is established using the last Fetch.','使用最近一次 Fetch 的远程引用建立跟踪关系。')}</p>
      <div className="remote-tracking-list">{sources.map((ref,index)=>{const candidates=trackingCandidates(ref,snapshot),existing=candidates.some(local=>local.name===names[index].trim());return <div className="remote-tracking-row" key={ref.fullName}>
        <span className="remote-tracking-source" title={ref.fullName}>{ref.name}</span><span aria-hidden="true">→</span>
        <label className="form-field"><span>{t('Local Branch','本地分支')}</span><input aria-label={`Local branch for ${ref.name}`} list={`track-candidates-${index}`} required disabled={state.busy||!!completed} value={names[index]} onChange={event=>setNames(old=>old.map((name,i)=>i===index?event.target.value:name))}/><datalist id={`track-candidates-${index}`}>{candidates.map(local=><option key={local.name} value={local.name}/>)}</datalist></label>
        <small role={conflicts[index]&&!completed?'alert':undefined} className={conflicts[index]&&!completed?'warning-text':'muted'}>{completed?.[index]??(conflicts[index]?labels[conflicts[index]!]:existing?t('Already tracked; reuse local branch','已跟踪；使用已有本地分支'):t('Will create','将创建'))}</small>
        {candidates.length>1&&!completed&&<small className="muted">{t('Multiple local branches track this source; choose or enter a name.','多个本地分支跟踪此来源；请选择或输入名称。')}</small>}
      </div>;})}</div>
      {!batch&&!completed&&<label className="form-checkbox"><input type="checkbox" checked={checkout} disabled={state.busy} onChange={event=>setCheckout(event.target.checked)}/>{t('Checkout local branch','Checkout 到本地分支')}</label>}
      {batch&&<p>{t('Create or reuse all branches in this selection; keep the current branch checked out. Symbolic remote references are excluded.','创建或复用所选范围中的全部分支，当前分支保持不变；远端符号引用不参加此操作。')}</p>}
      {completed&&!batch&&checkout&&<p>{t(`Checked out ${names[0]}.`,`已 Checkout 到 ${names[0]}。`)}</p>}
      {validation&&<p className="form-error" role="alert">{validation}</p>}{state.error&&<p className="form-error" role="alert">{state.error}</p>}
    </form>
  </Modal>;
}
