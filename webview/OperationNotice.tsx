import { useEffect, useState } from 'react';
import { Modal } from './ui';
import { Button, Icon } from './ui';

import { uiText } from './text';
import type { OperationKind } from '../src/protocol/types';
import { operationName } from './actionFeedback';
import { useTranslation } from './i18n';
import {
  captureActionContext,
  isActionContextCurrent,
  useWorkbench,
  type RepositoryActionContext,
} from './store';
import { ConflictWorkflow } from './ConflictWorkflow';

type SkipConfirmation = {
  context: RepositoryActionContext;
  kind: OperationKind;
  skipToken: string;
};

export function OperationNotice({ abort }: { abort(): void }) {
  const [confirmSkip, setConfirmSkip] = useState<SkipConfirmation>();
  const [workflow, setWorkflow] = useState(false);
  const state = useWorkbench(),
    t = useTranslation(),
    operation = state.snapshot?.operation;
  const conflicts = state.snapshot?.changes.filter((file) => file.conflict) ?? [];
  const count = Math.max(operation?.conflicts ?? 0, conflicts.length);
  useEffect(() => {
    setWorkflow(false);
  }, [state.repoId]);
  useEffect(() => {
    setConfirmSkip(undefined);
  }, [state.repoId, operation?.skipToken]);
  useEffect(() => {
    if (!operation?.kind && !count) setWorkflow(false);
  }, [operation?.kind, count]);
  if (!operation?.kind && !count) return null;
  const kind = operation?.kind,
    ready = !!kind && !count && operation.canContinue;
  const name = kind ? operationName(kind) : 'Git';
  const reason = count
    ? t('operations.resolveAndStageConflictingFilesBeforeContinue')
    : ready
      ? t('operations.noUnmergedFilesInGitInspectTheStagedResult')
      : t('operations.reviewTheActiveOperationBeforeContinuing');
  function viewConflicts() {
    state.setLayout({ diffCollapsed: false });
    state.selectWorking();
    const file =
      conflicts[0] ??
      state.snapshot?.changes.find((file) => file.indexStatus !== ' ' && !file.untracked);
    if (file)
      state.selectFile({
        kind: 'change',
        path: file.path,
        area: file.conflict ? 'conflict' : 'staged',
      });
    requestAnimationFrame(() => {
      const list = document.querySelector<HTMLElement>('.change-groups');
      if (list) {
        list.scrollTop = 0;
        list.focus();
      }
    });
  }
  function executeSkip(confirmation: SkipConfirmation) {
    setConfirmSkip(undefined);
    const current = useWorkbench.getState();
    if (
      !isActionContextCurrent(confirmation.context) ||
      current.busy ||
      current.snapshot?.operation.kind !== confirmation.kind ||
      current.snapshot.operation.skipToken !== confirmation.skipToken
    )
      return;
    void current.execute(
      { type: 'operation.skip', kind: confirmation.kind, skipToken: confirmation.skipToken },
      confirmation.context,
    );
  }
  function requestSkip(kind: OperationKind) {
    if (!operation?.skipToken || state.snapshot?.repository.id !== state.repoId) return;
    const confirmation = { context: captureActionContext(), kind, skipToken: operation.skipToken };
    if (kind === 'rebase') setConfirmSkip(confirmation);
    else executeSkip(confirmation);
  }
  const validConfirmation =
    confirmSkip &&
    isActionContextCurrent(confirmSkip.context) &&
    confirmSkip.kind === kind &&
    confirmSkip.skipToken === operation?.skipToken;

  return (
    <div
      className={`operation-notice ${ready ? 'operation-ready' : 'operation-conflict'}`}
      data-testid="operation-notice"
      role={count ? 'alert' : 'status'}
    >
      <Icon name={ready ? 'inspect' : 'warning'} />
      <div className="operation-copy">
        <div>
          <strong>
            {kind ? t('operations.paused', { name: name }) : t('operations.unresolvedConflicts')}
          </strong>
          <span className="operation-count">
            {count
              ? t('operations.conflicts', { count: count })
              : t('operations.awaitingResultReview')}
          </span>
        </div>
        <span className="operation-reason">{reason}</span>
        {operation?.managedRebase && (
          <span>
            {operation.managedRebase.step}/{operation.managedRebase.total} ·{' '}
            {t('interactiveRebase.recovery')}: {operation.managedRebase.backupRef}
            {operation.managedRebase.applied && (
              <span>{t('interactiveRebase.alreadyApplied')}</span>
            )}
            {operation.managedRebase.pause === 'unavailable' && (
              <strong>{t('interactiveRebase.unavailableState')}</strong>
            )}
            {operation.managedRebase.pause === 'empty' && (
              <strong>{t('interactiveRebase.emptyPause')}</strong>
            )}
          </span>
        )}
      </div>
      <div className="operation-actions">
        <Button icon="git-merge" disabled={state.busy} onClick={() => setWorkflow(true)}>
          {t('conflicts.title')}
        </Button>
        <Button className="primary" icon="files" onClick={viewConflicts}>
          {count > 0 ? t('operations.viewConflicts') : t('operations.reviewStagedResult')}
        </Button>
        {kind && (
          <>
            {operation?.managedRebase?.pause === 'empty' && (
              <Button
                disabled={state.busy}
                onClick={() =>
                  void state.execute({ type: 'operation.continue', kind, keepEmpty: true })
                }
              >
                {t('interactiveRebase.keepEmpty')}
              </Button>
            )}
            <Button
              className={ready ? 'primary' : ''}
              disabled={
                !operation.canContinue ||
                !!count ||
                state.busy ||
                operation.managedRebase?.pause === 'empty'
              }
              title={state.busy ? t('operations.waitForTheRunningAction') : reason}
              onClick={() => void state.execute({ type: 'operation.continue', kind })}
            >
              {uiText('operations.continue')}
            </Button>
            {operation.canSkip && (
              <Button
                disabled={state.busy || !operation.skipToken}
                title={t('operations.skipTheCurrentCommitInThisOperation')}
                onClick={() => requestSkip(kind)}
              >
                {uiText('operations.skip')}
              </Button>
            )}
            <Button disabled={!operation.canAbort || state.busy} onClick={abort}>
              {t('operations.abort', { name: name })}
            </Button>
          </>
        )}
      </div>
      {validConfirmation && (
        <Modal title={t('interactiveRebase.skipTitle')} onClose={() => setConfirmSkip(undefined)}>
          <p>{t('interactiveRebase.skipConfirm')}</p>
          <Button disabled={state.busy} onClick={() => executeSkip(confirmSkip)}>
            {t('operations.skip')}
          </Button>
        </Modal>
      )}
      {workflow && <ConflictWorkflow key={state.repoId} onClose={() => setWorkflow(false)} />}
    </div>
  );
}
