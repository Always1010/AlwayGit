import { useSyncExternalStore } from 'react';
import { cancellationRisk } from '../src/protocol/operation-cancellation';
import { actionName } from './actionFeedback';
import { useTranslation } from './i18n';
import { operationTasks } from './operationTasks';
import { rpc } from './rpc';
import { useWorkbench } from './store';
import { Button, Modal } from './ui';

export function StopOperationButton({
  requestId,
  repoId,
  refresh = false,
  repositories,
}: {
  requestId?: string;
  repoId?: string;
  refresh?: boolean;
  repositories?: string[];
}) {
  const t = useTranslation();
  const tasks = useSyncExternalStore(operationTasks.subscribe, operationTasks.snapshot);
  const matching = tasks.filter((task) =>
    repositories
      ? repositories.includes(task.repoId) && task.action?.type === 'fetch'
      : requestId
        ? task.id === requestId
        : task.repoId === repoId && (refresh ? !task.action : !!task.action),
  );
  if (!matching.length) return null;
  const stopping = matching.every((task) => task.stopping);
  const name =
    matching.length > 1
      ? t('cancellation.batch')
      : matching[0].action
        ? actionName(matching[0].action)
        : t('cancellation.refresh');
  const title = stopping ? t('cancellation.stopping') : t('cancellation.stopNamed', { name });
  return (
    <>
      <Button
        icon="debug-stop"
        title={title}
        aria-label={title}
        disabled={stopping}
        onClick={() =>
          operationTasks.confirm(matching.filter((task) => !task.stopping).map((task) => task.id))
        }
      />
      {stopping && <span role="status">{t('cancellation.stopping')}</span>}
    </>
  );
}

/** One confirmation outside the progress mask, shared by all operation entry points. */
export function StopOperationConfirmation() {
  const t = useTranslation();
  const tasks = useSyncExternalStore(operationTasks.subscribe, operationTasks.snapshot);
  const selected = useSyncExternalStore(operationTasks.subscribe, operationTasks.confirmation);
  const matching = tasks.filter((task) => selected.includes(task.id) && !task.stopping);
  if (!matching.length) return null;
  const close = () => operationTasks.confirm([]);
  const name =
    matching.length > 1
      ? t('cancellation.batch')
      : matching[0].action
        ? actionName(matching[0].action)
        : t('cancellation.refresh');
  const stop = async () => {
    close();
    await Promise.all(
      matching.map(async (task) => {
        // Completion or a new request while the confirmation was open invalidates this target.
        if (
          !operationTasks.snapshot().some((current) => current.id === task.id && !current.stopping)
        )
          return;
        operationTasks.stopping(task.id);
        try {
          if (task.cancel) task.cancel();
          else await rpc('cancelOperation', task.repoId, { requestId: task.id });
        } catch (error) {
          // Keep the original request and repository protection until the host settles it.
          operationTasks.retry(task.id);
          useWorkbench.getState().report(error);
        }
      }),
    );
  };
  return (
    <div data-operation-stop="true" className="stop-operation-layer">
      <Modal
        title={t('cancellation.titleNamed', { name })}
        onClose={close}
        footer={
          <>
            <Button data-autofocus="true" onClick={close}>
              {t('cancellation.keep')}
            </Button>
            <Button icon="debug-stop" className="danger" onClick={() => void stop()}>
              {t('cancellation.stopNamed', { name })}
            </Button>
          </>
        }
      >
        {matching.map((task) => (
          <p key={task.id}>
            <strong>
              {useWorkbench.getState().repositories.find((repo) => repo.id === task.repoId)?.name ??
                task.repoId}
            </strong>
            {' · '}
            {task.action ? actionName(task.action) : t('cancellation.refresh')}
          </p>
        ))}
        {[...new Set(matching.map((task) => cancellationRisk(task.action)))].map((risk) => (
          <p key={risk} className="warning-text">
            {t(risk)}
          </p>
        ))}
        {matching.length > 1 && <p>{t('cancellation.batchRisk')}</p>}
        <p className="muted">{t('cancellation.confirmationRunning')}</p>
      </Modal>
    </div>
  );
}
