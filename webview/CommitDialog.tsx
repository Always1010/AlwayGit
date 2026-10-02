import { Button, Modal } from './ui';

import { uiText } from './text';
import { useEffect, useRef, useState } from 'react';
import type { CommitDetails } from '../src/protocol/types';
import { useWorkbench } from './store';
import { useSnapshotFields, useWorkbenchFields } from './subscriptions';
import { useTranslation } from './i18n';
import { rpc } from './rpc';


export function CommitDialog({ repoId, onClose }: { repoId: string; onClose(): void }) {
  const state = useWorkbenchFields('busy', 'drafts', 'execute', 'setDraft');
  const snapshot = useSnapshotFields('repository', 'branch', 'head', 'changes', 'operation')!;
  const t = useTranslation(), [amend, setAmend] = useState(false), [failure, setFailure] = useState<string>();
  const amendRequest = useRef(0), draft = state.drafts[repoId] ?? '';
  const staged = snapshot.changes.filter(file => !file.conflict && file.indexStatus !== ' ' && file.indexStatus !== '?' && !!file.indexStatus).length;
  const conflicts = Math.max(snapshot.operation.conflicts, snapshot.changes.filter(file => file.conflict).length);
  const canSubmit = !state.busy && !!draft.trim() && !conflicts && (amend ? !!snapshot.head && !snapshot.operation.kind : !!staged);

  useEffect(() => {
    const request = ++amendRequest.current, head = snapshot.head;
    if (!amend || !head || snapshot.operation.kind || useWorkbench.getState().drafts[repoId]) return;
    void rpc<CommitDetails>('details', repoId, { oid: head }).then(detail => {
      const current = useWorkbench.getState();
      if (request === amendRequest.current && current.repoId === repoId && current.snapshot?.head === head && !current.drafts[repoId]) {
        current.setDraft(detail.body || detail.commit.subject);
      }
    }).catch(error => { if (request === amendRequest.current) setFailure(error instanceof Error ? error.message : String(error)); });
    return () => { ++amendRequest.current; };
  }, [amend, repoId, snapshot.head, snapshot.operation.kind]);
  useEffect(() => { if (snapshot.operation.kind) setAmend(false); }, [snapshot.operation.kind]);

  async function submit() {
    if (!canSubmit || useWorkbench.getState().repoId !== repoId) return;
    setFailure(undefined);
    const success = await state.execute({ type: 'commit', message: draft.trim(), amend });
    const current = useWorkbench.getState();
    if (success || current.operationReview?.repoId === repoId) onClose();
    else if (current.repoId === repoId) setFailure(current.error ?? t("commit.commitDidNotCompleteYourDraftIsPreserved"));
  }

  return <Modal title={uiText("commit.commit")} className="commit-dialog" busy={state.busy} onClose={onClose} footer={<>
    <span className="muted commit-shortcut">{t("commit.ctrlCmdEnterToCommit")}</span>
    <Button disabled={state.busy} onClick={onClose}>{t("common.cancel")}</Button>
    <Button type="submit" form="ag-commit-form" className="primary" disabled={!canSubmit}>{amend ? uiText("commit.amendCommit") : uiText("commit.commit")}</Button>
  </>}>
    <p className="commit-repository">{snapshot.repository.name} · {snapshot.branch || uiText("commit.detachedHEAD")}</p>
    <p className="muted">{t("commit.commitIncludesAllStagedFilesIncludingFilesHiddenBy", { staged: (staged) })}</p>
    <form id="ag-commit-form" className="commit-form" onSubmit={event => { event.preventDefault(); void submit(); }} onKeyDown={event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        event.preventDefault(); if (!event.repeat && canSubmit) event.currentTarget.requestSubmit();
      }
    }}>
      <label htmlFor="ag-commit-message">{t("commit.commitMessage")}</label>
      <textarea id="ag-commit-message" data-autofocus="true" aria-label={uiText("commit.commitMessageVariant2")} placeholder={t("commit.describeYourChanges")} value={draft} maxLength={100000} onChange={event => state.setDraft(event.target.value)} disabled={state.busy}/>
      <label className="form-checkbox commit-amend"><input type="checkbox" checked={amend} disabled={!snapshot.head || state.busy || !!snapshot.operation.kind} onChange={event => { ++amendRequest.current; setAmend(event.target.checked); }}/>{t("commit.amendLastCommit")}</label>
    </form>
    {conflicts > 0 ? <p className="warning-text" role="status">{t("commit.resolveAllConflictsBeforeCommit", { conflicts: (conflicts) })}</p> : !staged && !amend ? <p className="muted" role="status">{t("commit.stageChangesBeforeCommittingOrUseAmendToEdit")}</p> : null}
    <p className="muted commit-draft-note">{t("commit.draftsSaveAutomaticallyCancelEscapeAndCloseKeepYour")}</p>
    {failure && <pre className="form-error" role="alert">{failure}</pre>}
  </Modal>;
}
