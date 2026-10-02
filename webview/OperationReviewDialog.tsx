import { Button, Modal } from './ui';

import { useState } from 'react';
import type { OperationReview } from '../src/protocol/types';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';


export function OperationReviewDialog({ edit }: { edit(path: string): void }) {
  const state = useWorkbench(), pending = state.operationReview!, t = useTranslation();
  const [acknowledged, setAcknowledged] = useState(false);
  const flagged = pending.review.files.filter(file=>file.lines.length||file.skipped), warnings = !!flagged.length;
  const close = () => useWorkbench.setState({ operationReview: undefined });
  const inspect = (path?: string) => {
    close(); state.selectWorking();
    const file = path ?? pending.review.files[0]?.path;
    if (file) state.selectFile({ kind: 'change', area: 'staged', path: file });
    state.setLayout({ diffCollapsed: false });
  };
  const skipped = (reason: OperationReview['files'][number]['skipped']) => ({
    binary: t("operationsReview.binaryFileNotScanned"), large: t("operationsReview.over2MiBNotScanned"),
    encoding: t("operationsReview.unsupportedTextEncodingNotScanned"), submodule: t("operationsReview.submoduleNotScanned"),
    limit: t("operationsReview.inspectionSizeLimitReachedNotScanned"),
  }[reason!]);
  async function confirm() {
    if (state.repoId !== pending.repoId) { close(); return; }
    await state.execute({ ...pending.action, reviewToken: pending.review.token });
  }
  return <Modal title={t("operationsReview.inspectStagedResult")} busy={state.busy} onClose={close} footer={<>
    <Button icon="arrow-left" disabled={state.busy} onClick={()=>inspect()}>{t("operationsReview.returnToReview")}</Button>
    <Button className={warnings?'danger':'primary'} disabled={state.busy||warnings&&!acknowledged} onClick={()=>void confirm()}>{warnings?t("operationsReview.continueAnyway"):t("operationsReview.confirmContinue")}</Button>
  </>}>
    <p>{state.snapshot?.repository.name} · {state.snapshot?.branch} · {pending.review.kind}</p>
    <p>{t("operationsReview.gitWillUseTheStagedContentEditingAFile")}</p>
    <p className={warnings?'warning-text':'muted'} role="status">{warnings?t("operationsReview.possibleConflictMarkersOrFilesThatCouldNotBe"):t("operationsReview.noCommonConflictMarkersFoundInTheStagedChanged")}</p>
    <div className="operation-review-files">{pending.review.files.map(file=><div className="operation-review-file" key={file.path}>
      <div><strong>{file.path}</strong>{file.lines.length>0&&<span className="warning-text">{t("operationsReview.possibleMarkersAtLines")}{file.lines.join(', ')}{file.more&&t("operationsReview.first100Shown")}</span>}{file.skipped&&<span className="warning-text">{skipped(file.skipped)}</span>}</div>
      <Button className="icon-only" icon="diff" disabled={state.busy} title={t("operationsReview.reviewStagedContent")} aria-label={`${t("operationsReview.reviewStagedContent")}: ${file.path}`} onClick={()=>inspect(file.path)}/>
      <Button className="icon-only" icon="edit" disabled={state.busy} title={t("operationsReview.editInVSCodeThenSaveAndStage")} aria-label={`${t("operationsReview.editInVSCode")}: ${file.path}`} onClick={()=>{inspect(file.path);edit(file.path);}}/>
    </div>)}</div>
    {warnings&&<label className="form-checkbox"><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)}/>{t("operationsReview.iReviewedTheseWarningsAndIntendToKeepThis")}</label>}
  </Modal>;
}
