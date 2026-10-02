import { useEffect, useRef, useState } from 'react';
import type { CommitDetails } from '../src/protocol/types';
import { useWorkbench } from './store';
import { useSnapshotFields, useWorkbenchFields } from './subscriptions';
import { useTranslation } from './i18n';
import { rpc } from './rpc';
import { Button, Modal } from './ui';

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
    else if (current.repoId === repoId) setFailure(current.error ?? t('Commit did not complete. Your draft is preserved.', 'Commit 未完成，草稿已保留。'));
  }

  return <Modal title="Commit" className="commit-dialog" busy={state.busy} onClose={onClose} footer={<>
    <span className="muted commit-shortcut">{t('Ctrl/Cmd+Enter to commit', 'Ctrl/Cmd+Enter 提交')}</span>
    <Button disabled={state.busy} onClick={onClose}>{t('Cancel', '取消')}</Button>
    <Button type="submit" form="ag-commit-form" className="primary" disabled={!canSubmit}>{amend ? 'Amend Commit' : 'Commit'}</Button>
  </>}>
    <p className="commit-repository">{snapshot.repository.name} · {snapshot.branch || 'Detached HEAD'}</p>
    <p className="muted">{t(`Commit includes all ${staged} Staged files, including files hidden by a path filter.`, `Commit 包含全部 ${staged} 个 Staged 文件，包括被路径筛选隐藏的文件。`)}</p>
    <form id="ag-commit-form" className="commit-form" onSubmit={event => { event.preventDefault(); void submit(); }} onKeyDown={event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        event.preventDefault(); if (!event.repeat && canSubmit) event.currentTarget.requestSubmit();
      }
    }}>
      <label htmlFor="ag-commit-message">{t('Commit Message', 'Commit 信息')}</label>
      <textarea id="ag-commit-message" data-autofocus="true" aria-label="Commit message" placeholder={t('Describe your changes…', '描述这次变更…')} value={draft} maxLength={100000} onChange={event => state.setDraft(event.target.value)} disabled={state.busy}/>
      <label className="form-checkbox commit-amend"><input type="checkbox" checked={amend} disabled={!snapshot.head || state.busy || !!snapshot.operation.kind} onChange={event => { ++amendRequest.current; setAmend(event.target.checked); }}/>{t('Amend last Commit', 'Amend 上一次提交')}</label>
    </form>
    {conflicts > 0 ? <p className="warning-text" role="status">{t(`Resolve all ${conflicts} conflicts before Commit.`, `Commit 前须处理全部 ${conflicts} 个冲突文件。`)}</p> : !staged && !amend ? <p className="muted" role="status">{t('Stage changes before committing, or use Amend to edit the last Commit message.', '先 Stage 所需变更，或使用 Amend 修改上一次提交说明。')}</p> : null}
    <p className="muted commit-draft-note">{t('Drafts save automatically. Cancel, Escape and Close keep your message.', '草稿自动保存，取消、Esc 和关闭均保留 Message。')}</p>
    {failure && <pre className="form-error" role="alert">{failure}</pre>}
  </Modal>;
}
