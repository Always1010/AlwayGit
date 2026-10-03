import { Button, Modal } from './ui';

import { uiText } from './text';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { VirtualFileRows } from './VirtualFileRows';
import type { CommitDetails, CommitSelection } from '../src/protocol/types';
import { isStaged, isUnstaged } from './changeEntries';
import { useWorkbench } from './store';
import { useSnapshotFields, useWorkbenchFields } from './subscriptions';
import { useTranslation } from './i18n';
import { rpc } from './rpc';


export function CommitDialog({ repoId, files, onClose }: { repoId: string; files?: CommitSelection[]; onClose(): void }) {
  const state = useWorkbenchFields('busy', 'drafts', 'execute', 'setDraft');
  const snapshot = useSnapshotFields('repository', 'branch', 'head', 'changes', 'operation')!;
  const t = useTranslation(), [amend, setAmend] = useState(false), [failure, setFailure] = useState<string>();
  const amendRequest = useRef(0), draft = state.drafts[repoId] ?? '';
  const [initial] = useState(() => {
    const unique = new Map<string, CommitSelection>();
    for (const file of files ?? snapshot.changes.filter(isStaged).map(file => ({ path: file.path, area: 'staged' as const }))) {
      if (unique.get(file.path)?.area !== 'unstaged') unique.set(file.path, file);
    }
    return { files: [...unique.values()], head: snapshot.head ?? '', branch: snapshot.branch };
  });
  const [checked, setChecked] = useState(() => new Set(initial.files.map(file => file.path)));
  const selected = initial.files.filter(file => checked.has(file.path));
  const byPath = new Map(snapshot.changes.map(file => [file.path, file]));
  const combined = (file: CommitSelection) => file.area === 'unstaged' && !!byPath.get(file.path) && isStaged(byPath.get(file.path)!);
  const stale = initial.head !== (snapshot.head ?? '') || initial.branch !== snapshot.branch || selected.some(file => {
    const change = byPath.get(file.path); return !change || !(file.area === 'staged' ? isStaged(change) : isUnstaged(change));
  });
  const conflicts = Math.max(snapshot.operation.conflicts, snapshot.changes.filter(file => file.conflict).length);
  const canSubmit = !state.busy && !!draft.trim() && !conflicts && !stale && (!files || !snapshot.operation.kind) && (amend ? !!snapshot.head && !snapshot.operation.kind : !!selected.length);

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
    const success = await state.execute({ type: 'commit', message: draft.trim(), amend,
      ...(!snapshot.operation.kind ? {files:selected,expectedHead:initial.head,expectedBranch:initial.branch} : {}) });
    const current = useWorkbench.getState();
    if (success || current.operationReview?.repoId === repoId) onClose();
    else if (current.repoId === repoId) setFailure(current.error ?? t("commit.commitDidNotCompleteYourDraftIsPreserved"));
  }
  function submitShortcut(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
      event.preventDefault(); if (!event.repeat && canSubmit) void submit();
    }
  }

  return <Modal title={uiText("commit.commit")} className="commit-dialog" busy={state.busy} onClose={onClose} footer={<>
    <span className="muted commit-shortcut">{t("commit.ctrlCmdEnterToCommit")}</span>
    <Button disabled={state.busy} onClick={onClose}>{t("common.cancel")}</Button>
    <Button type="submit" form="ag-commit-form" className="primary" disabled={!canSubmit}>{amend ? uiText("commit.amendCommit") : uiText("commit.commit")}</Button>
  </>}>
    <p className="commit-repository">{snapshot.repository.name} · {snapshot.branch || uiText("commit.detachedHEAD")}</p>
    <div className="commit-files-heading"><strong>{t('commit.filesToCommit', { count: selected.length })}</strong><span className="muted">{files ? t('commit.selectedFilesOnly') : t('commit.stagedFilesDefault')}</span></div>
    {selected.some(combined) && <p className="commit-combined-note warning-text" role="status">{t('commit.combinedNotice')}</p>}
    <div className="commit-files" aria-label={t('commit.filesToCommit', {count:selected.length})} onKeyDown={submitShortcut}>
      <VirtualFileRows items={initial.files} getKey={file=>file.path} scrollParent=".commit-files" estimateSize={30} focusSelector="input[type=checkbox]">{file => <label className="commit-file" title={file.path}>
        <input type="checkbox" aria-label={file.path} checked={checked.has(file.path)} disabled={state.busy || !!snapshot.operation.kind} onChange={event => setChecked(current => { const next = new Set(current); if(event.target.checked) next.add(file.path); else next.delete(file.path); return next; })}/>
        <span className="commit-file-path">{file.path}</span>
        <span className={`commit-file-source${combined(file) ? ' combined' : ''}`}>{combined(file) ? t('commit.combined') : t(file.area === 'staged' ? 'changes.staged' : 'changes.unstaged')}</span>
      </label>}</VirtualFileRows>
      {!initial.files.length && <p className="muted">{t('commit.noFiles')}</p>}
    </div>
    <form id="ag-commit-form" className="commit-form" onSubmit={event => { event.preventDefault(); void submit(); }} onKeyDown={submitShortcut}>
      <label htmlFor="ag-commit-message">{t("commit.commitMessage")}</label>
      <textarea id="ag-commit-message" data-autofocus="true" aria-label={uiText("commit.commitMessageVariant2")} placeholder={t("commit.describeYourChanges")} value={draft} maxLength={100000} onChange={event => state.setDraft(event.target.value)} disabled={state.busy}/>
      <label className="form-checkbox commit-amend"><input type="checkbox" checked={amend} disabled={!snapshot.head || state.busy || !!snapshot.operation.kind} onChange={event => { ++amendRequest.current; setAmend(event.target.checked); }}/>{t("commit.amendLastCommit")}</label>
    </form>
    {stale ? <p className="warning-text" role="status">{t('commit.selectionChanged')}</p> : conflicts > 0 ? <p className="warning-text" role="status">{t("commit.resolveAllConflictsBeforeCommit", { conflicts: (conflicts) })}</p> : !selected.length && !amend ? <p className="muted" role="status">{initial.files.length ? t('commit.chooseFiles') : t("commit.stageChangesBeforeCommittingOrUseAmendToEdit")}</p> : null}
    <p className="muted commit-draft-note">{t("commit.draftsSaveAutomaticallyCancelEscapeAndCloseKeepYour")}</p>
    {failure && <pre className="form-error" role="alert">{failure}</pre>}
  </Modal>;
}
