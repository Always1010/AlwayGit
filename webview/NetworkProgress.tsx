import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ActionFeedback } from './actionFeedback';
import { useTranslation, type StaticMessageKey } from './i18n';
import type { NetworkOperationProgress } from '../src/protocol/types';
import { rpc } from './rpc';
import { useWorkbench } from './store';
import { Button } from './ui';
import { StopOperationButton } from './StopOperation';
import { operationTasks } from './operationTasks';

const labels: Record<NetworkOperationProgress['phase'], StaticMessageKey> = {
  connecting: 'feedback.network.connecting',
  counting: 'feedback.network.counting',
  compressing: 'feedback.network.compressing',
  sending: 'feedback.network.sending',
  receiving: 'feedback.network.receiving',
  resolving: 'feedback.network.resolving',
  waiting: 'feedback.network.waiting',
  updating: 'feedback.network.updating',
  integrating: 'feedback.network.integrating',
  refreshing: 'feedback.network.refreshing',
};

/** Shared by the network dialog, protected Pull dialog and background feedback. */
export function NetworkProgress({
  feedback,
  actions = true,
}: {
  feedback: ActionFeedback;
  actions?: boolean;
}) {
  const t = useTranslation(),
    [now, setNow] = useState(Date.now);
  const tasks = useSyncExternalStore(operationTasks.subscribe, operationTasks.snapshot);
  const stopping = tasks.some(
    (task) =>
      task.stopping &&
      (feedback.requestId
        ? task.id === feedback.requestId
        : task.repoId === feedback.repoId && !!task.action),
  );
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const progress = feedback.networkProgress;
  if (!progress) return null;
  const phase = feedback.phase === 'refreshing' ? 'refreshing' : progress.phase;
  const label = `${progress.remote && phase !== 'refreshing' ? t('feedback.network.remote') + ' · ' : ''}${t(labels[phase])}`;
  const seconds = Math.max(
    0,
    Math.floor((now - (feedback.startedAt ?? progress.startedAt)) / 1000),
  );
  const quiet = Math.max(
    0,
    Math.floor((now - (progress.lastOutputAt ?? progress.startedAt)) / 1000),
  );
  const determinate =
    !['connecting', 'waiting', 'updating', 'integrating', 'refreshing'].includes(phase) &&
    progress.percent !== undefined;
  const hasMetrics =
    (determinate && progress.completed !== undefined && progress.total !== undefined) ||
    progress.transferred ||
    progress.speed;
  return (
    <div className="network-progress" data-testid="network-progress">
      <p role="status" aria-live="polite">
        {stopping ? t('cancellation.stopping') : label}
        {!stopping && determinate ? ` · ${progress.percent}%` : ''}
      </p>
      {!stopping && phase !== 'refreshing' && hasMetrics && (
        <div className="network-progress-metrics">
          {determinate && progress.completed !== undefined && progress.total !== undefined && (
            <span>
              {t('feedback.network.objects', {
                completed: progress.completed,
                total: progress.total,
              })}
            </span>
          )}
          {progress.transferred && (
            <span>{t('feedback.network.transferred', { value: progress.transferred })}</span>
          )}
          {progress.speed && <span>{t('feedback.network.speed', { value: progress.speed })}</span>}
        </div>
      )}
      <div className="network-progress-metrics muted">
        <span>{t('feedback.elapsed', { seconds })}</span>
        <span>{t('feedback.network.lastOutput', { seconds: quiet })}</span>
      </div>
      {!stopping && quiet >= 30 && phase !== 'refreshing' && (
        <p className="muted" role="status">
          {t('feedback.network.quiet', { seconds: quiet })}
        </p>
      )}
      {actions && <NetworkProgressActions feedback={feedback} />}
    </div>
  );
}

/** Kept outside scrolling dialog bodies; inline progress uses the same trailing action row. */
export function NetworkProgressActions({
  feedback,
  children,
}: {
  feedback: ActionFeedback;
  children?: ReactNode;
}) {
  const t = useTranslation();
  return (
    <div className="network-progress-actions">
      <Button
        icon="output"
        className="network-progress-log"
        title={t('feedback.showLog')}
        onClick={() => void rpc('showLog').catch((error) => useWorkbench.getState().report(error))}
      >
        {t('feedback.showLog')}
      </Button>
      <div className="network-progress-controls">
        {children}
        <StopOperationButton requestId={feedback.requestId} repoId={feedback.repoId} />
      </div>
    </div>
  );
}
