import { Button, Modal } from './ui';

import { uiText } from './text';
import { useState } from 'react';
import type { DialogRequest } from './ActionDialog';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';

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
  const labels: Record<string, string> = {name:t("tracking.enterALocalBranchName"),duplicate:t("tracking.duplicateLocalName"),upstream:t("tracking.nameAlreadyExistsWithADifferentUpstream"),prefix:t("tracking.branchNameConflictsWithAnotherBranchPath")};
  const title = batch ? t("tracking.createLocalTrackingBranches") : t("tracking.checkoutAsLocalBranch");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setValidation(undefined);
    if (!sources.length || conflicts.some(Boolean)) { setValidation(t("tracking.resolveTheBranchNameConflictsBeforeContinuing")); return; }
    const existed = sources.map((ref,index) => trackingCandidates(ref,snapshot).some(local => local.name === names[index].trim()));
    const repoId = state.repoId;
    if (await state.execute({type:'branch.track',branches:sources.map((ref,index)=>({source:ref.fullName,name:names[index].trim(),expectedOid:ref.oid})),checkout:!batch&&checkout})) {
      const latest=useWorkbench.getState(); if(latest.repoId!==repoId)return;
      setCompleted(existed.map(value=>value?t("tracking.alreadyTracked"):t("tracking.created")));
      if(!batch&&checkout&&latest.snapshot?.head)void latest.selectCommit(latest.snapshot.head);
    }
  }
  return <Modal title={title} busy={state.busy} onClose={onClose} footer={completed?<Button className="primary" onClick={onClose}>{t("tracking.done")}</Button>:<><Button disabled={state.busy} onClick={onClose}>{t("common.cancel")}</Button><Button type="submit" form="ag-track-form" className="primary" disabled={state.busy||!sources.length||conflicts.some(Boolean)}>{state.busy?t("common.working"):!batch&&checkout?t("tracking.createCheckout"):t("tracking.createLocalBranches")}</Button></>}>
    <form id="ag-track-form" className="action-form" onSubmit={event=>void submit(event)}>
      <p className="muted">{snapshot.repository.name} · {t("tracking.trackingIsEstablishedUsingTheLastFetch")}</p>
      <div className="remote-tracking-list">{sources.map((ref,index)=>{const candidates=trackingCandidates(ref,snapshot),existing=candidates.some(local=>local.name===names[index].trim());return <div className="remote-tracking-row" key={ref.fullName}>
        <span className="remote-tracking-source" title={ref.fullName}>{ref.name}</span><span aria-hidden="true">→</span>
        <label className="form-field"><span>{t("tracking.localBranch")}</span><input aria-label={uiText("tracking.localBranchFor", { name: (ref.name) })} list={`track-candidates-${index}`} required disabled={state.busy||!!completed} value={names[index]} onChange={event=>setNames(old=>old.map((name,i)=>i===index?event.target.value:name))}/><datalist id={`track-candidates-${index}`}>{candidates.map(local=><option key={local.name} value={local.name}/>)}</datalist></label>
        <small role={conflicts[index]&&!completed?'alert':undefined} className={conflicts[index]&&!completed?'warning-text':'muted'}>{completed?.[index]??(conflicts[index]?labels[conflicts[index]!]:existing?t("tracking.alreadyTrackedReuseLocalBranch"):t("tracking.willCreate"))}</small>
        {candidates.length>1&&!completed&&<small className="muted">{t("tracking.multipleLocalBranchesTrackThisSourceChooseOrEnter")}</small>}
      </div>;})}</div>
      {!batch&&!completed&&<label className="form-checkbox"><input type="checkbox" checked={checkout} disabled={state.busy} onChange={event=>setCheckout(event.target.checked)}/>{t("tracking.checkoutLocalBranch")}</label>}
      {batch&&<p>{t("tracking.createOrReuseAllBranchesInThisSelectionKeep")}</p>}
      {completed&&!batch&&checkout&&<p>{t("tracking.checkedOut", { value: (names[0]) })}</p>}
      {validation&&<p className="form-error" role="alert">{validation}</p>}{state.error&&<p className="form-error" role="alert">{state.error}</p>}
    </form>
  </Modal>;
}
