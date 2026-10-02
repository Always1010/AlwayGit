import type { OperationKind } from '../src/protocol/types';
import { operationName } from './actionFeedback';
import { useTranslation } from './i18n';
import { useWorkbench } from './store';
import { Button, Icon } from './ui';

export function OperationNotice({ abort }: { abort(): void }) {
  const state = useWorkbench(), t = useTranslation(), operation = state.snapshot?.operation;
  const conflicts = state.snapshot?.changes.filter(file => file.conflict) ?? [];
  const count = Math.max(operation?.conflicts ?? 0, conflicts.length);
  if (!operation?.kind && !count) return null;
  const kind = operation?.kind, ready = !!kind && !count && operation.canContinue;
  const name = kind ? operationName(kind) : 'Git';
  const reason = count ? t('Resolve and Stage conflicting files before Continue.', '请先解决冲突并 Stage 文件，再 Continue。')
    : ready ? t('No unmerged files in Git. Inspect the staged result before Continue; content correctness has not been verified.', 'Git 中已无未标记的冲突文件。继续前请检查暂存结果；内容正确性尚未验证。')
    : t('Review the active operation before continuing.', '请检查当前操作后继续。');
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
    <div className="operation-copy"><div><strong>{kind ? t(`${name} paused`, `${name} 已暂停`) : t('Unresolved conflicts', '存在未解决的冲突')}</strong><span className="operation-count">{count ? t(`${count} conflicts`, `${count} 个冲突`) : t('Awaiting result review', '待检查结果')}</span></div><span className="operation-reason">{reason}</span></div>
    <div className="operation-actions">
      <Button className="primary" icon="files" onClick={viewConflicts}>{count > 0?t('View Conflicts', '查看冲突'):t('Review Staged Result','检查暂存结果')}</Button>
      {kind && <><Button className={ready ? 'primary' : ''} disabled={!operation.canContinue || !!count || state.busy} title={state.busy ? t('Wait for the running action.', '请等待当前操作完成。') : reason} onClick={() => execute('operation.continue', kind)}>Continue</Button>
        {operation.canSkip && <Button disabled={state.busy} title={t('Skip the current commit in this operation', '跳过当前操作中的 Commit')} onClick={() => execute('operation.skip', kind)}>Skip</Button>}
        <Button disabled={!operation.canAbort || state.busy} onClick={abort}>{t(`Abort ${name}…`,`中止本次 ${name}…`)}</Button></>}
    </div>
  </div>;
}
