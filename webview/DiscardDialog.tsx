import { useEffect, useState } from 'react';
import type { DiscardPlan } from '../src/protocol/types';
import type { DialogRequest } from './ActionDialog';
import { useWorkbenchFields } from './subscriptions';
import { useWorkbench } from './store';
import { rpc } from './rpc';
import { useTranslation } from './i18n';
import { VirtualFileRows } from './VirtualFileRows';
import { Button, Modal } from './ui';

export function DiscardDialog({ dialog, onClose }: { dialog: DialogRequest; onClose(): void }) {
  const state = useWorkbenchFields('repoId', 'snapshot', 'execute', 'busy', 'error'), t = useTranslation();
  const [plan, setPlan] = useState<DiscardPlan>(), [failure, setFailure] = useState<string>(), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setPlan(undefined); setFailure(undefined); useWorkbench.setState({ error: undefined });
    void rpc<DiscardPlan>('prepareDiscard', state.repoId, dialog.discardScope ? { scope: dialog.discardScope } : { paths: dialog.paths ?? [] })
      .then(value => { if (active) setPlan(value); }, error => { if (active) setFailure(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [state.repoId, dialog, revision]);
  const error = failure ?? state.error;
  return <Modal title={t('actions.discardChanges')} busy={state.busy} onClose={onClose} footer={<>
    <Button onClick={onClose} disabled={state.busy}>{t('common.cancel')}</Button>
    <Button className="danger" disabled={state.busy || !plan?.paths.length || !!error} onClick={async () => { if (plan && await state.execute({ type: 'discard', paths: [], planToken: plan.token })) onClose(); }}>{t('actions.discardChanges')}</Button>
  </>}>
    <p className="muted">{state.snapshot?.repository.name} · {plan?.branch ?? state.snapshot?.branch}</p>
    {!plan && !failure && <p role="status">{t('actions.preparingDiscard')}</p>}
    {plan && <><p>{t('actions.discardCounts', { total: plan.paths.length, tracked: plan.tracked, untracked: plan.untracked })}</p>
      <div className="discard-paths" tabIndex={0}><VirtualFileRows items={plan.paths} getKey={path => path} scrollParent=".discard-paths" estimateSize={22}>{path => <div>{path}</div>}</VirtualFileRows></div>
      <p className="warning-text">{t('actions.discardUnstagedChangesAndSelectedUntrackedFilesStagedChanges')}</p>
      {!plan.paths.length && <p role="status">{t('details.noChanges')}</p>}
    </>}
    {error && <><p role="alert" className="form-error">{error}</p><Button icon="refresh" onClick={() => setRevision(value => value + 1)} disabled={state.busy}>{t('actions.recheckDiscard')}</Button></>}
  </Modal>;
}
