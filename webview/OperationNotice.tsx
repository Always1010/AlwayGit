import { Button, Icon } from './ui';

import { uiText } from './text';
import type { OperationKind } from '../src/protocol/types';
import { operationName } from './actionFeedback';
import { useTranslation } from './i18n';
import { useWorkbench } from './store';


export function OperationNotice({ abort }: { abort(): void }) {
  const state = useWorkbench(), t = useTranslation(), operation = state.snapshot?.operation;
  const conflicts = state.snapshot?.changes.filter(file => file.conflict) ?? [];
  const count = Math.max(operation?.conflicts ?? 0, conflicts.length);
  if (!operation?.kind && !count) return null;
  const kind = operation?.kind, ready = !!kind && !count && operation.canContinue;
  const name = kind ? operationName(kind) : 'Git';
  const reason = count ? t("operations.resolveAndStageConflictingFilesBeforeContinue")
    : ready ? t("operations.noUnmergedFilesInGitInspectTheStagedResult")
    : t("operations.reviewTheActiveOperationBeforeContinuing");
  function viewConflicts() {
    state.setLayout({diffCollapsed:false});
    state.selectWorking();
    const file = conflicts[0] ?? state.snapshot?.changes.find(file=>file.indexStatus!==' '&&!file.untracked);
    if (file) state.selectFile({ kind: 'change', path: file.path, area: file.conflict?'conflict':'staged' });
    requestAnimationFrame(() => {
      const list = document.querySelector<HTMLElement>('.change-groups');
      if (list) { list.scrollTop = 0; list.focus(); }
    });
  }
  function execute(type: 'operation.continue' | 'operation.skip', kind: OperationKind) { void state.execute({ type, kind }); }
  return <div className={`operation-notice ${ready ? 'operation-ready' : 'operation-conflict'}`} data-testid="operation-notice" role={count ? 'alert' : 'status'}>
    <Icon name={ready ? 'inspect' : 'warning'}/>
    <div className="operation-copy"><div><strong>{kind ? t("operations.paused", { name: (name) }) : t("operations.unresolvedConflicts")}</strong><span className="operation-count">{count ? t("operations.conflicts", { count: (count) }) : t("operations.awaitingResultReview")}</span></div><span className="operation-reason">{reason}</span></div>
    <div className="operation-actions">
      <Button className="primary" icon="files" onClick={viewConflicts}>{count > 0?t("operations.viewConflicts"):t("operations.reviewStagedResult")}</Button>
      {kind && <><Button className={ready ? 'primary' : ''} disabled={!operation.canContinue || !!count || state.busy} title={state.busy ? t("operations.waitForTheRunningAction") : reason} onClick={() => execute('operation.continue', kind)}>{uiText("operations.continue")}</Button>
        {operation.canSkip && <Button disabled={state.busy} title={t("operations.skipTheCurrentCommitInThisOperation")} onClick={() => execute('operation.skip', kind)}>{uiText("operations.skip")}</Button>}
        <Button disabled={!operation.canAbort || state.busy} onClick={abort}>{t("operations.abort", { name: (name) })}</Button></>}
    </div>
  </div>;
}
