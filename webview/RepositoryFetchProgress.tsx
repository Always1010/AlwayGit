import { fetchRepositories, useRepositoryFetch } from './repositoryFetch';
import { useTranslation } from './i18n';
import { StopOperationButton } from './StopOperation';
import { Button, Icon } from './ui';

export function RepositoryFetchProgress() {
  const { entries, running, taskId } = useRepositoryFetch();
  const t = useTranslation();
  if (!entries.length) return null;
  const failed = entries.filter((entry) => entry.status === 'error');
  const completed = entries.filter((entry) => entry.status === 'success').length;
  const skipped = entries.filter((entry) => entry.status === 'skipped').length;
  const settled = entries.filter((entry) => !['pending', 'running'].includes(entry.status)).length;
  return (
    <div className={`banner repository-fetch-progress${failed.length ? ' warning' : ' notice'}`}>
      <Icon name={running ? 'sync' : failed.length ? 'warning' : 'cloud-download'} />
      <div className="repository-fetch-summary">
        <span role="status" aria-live="polite">
          {running
            ? t('workbench.batchFetchProgress', { completed: settled, total: entries.length })
            : t('workbench.batchFetchResult', { completed, failed: failed.length, skipped })}
        </span>
        {failed.length > 0 && (
          <details>
            <summary>{t('workbench.batchFetchFailures', { count: failed.length })}</summary>
            {failed.map((entry) => (
              <div key={entry.repository.id}>
                <strong>{entry.repository.name}</strong>: {entry.error}
              </div>
            ))}
          </details>
        )}
      </div>
      {running ? (
        <StopOperationButton requestId={taskId} />
      ) : (
        <>
          {failed.length > 0 && (
            <Button
              className="icon-only"
              icon="refresh"
              title={t('workbench.retryFailedFetches')}
              aria-label={t('workbench.retryFailedFetches')}
              onClick={() => void fetchRepositories(failed.map((entry) => entry.repository))}
            />
          )}
          <Button
            className="icon-only"
            icon="close"
            title={t('workbench.dismissNotification')}
            aria-label={t('workbench.dismissNotification')}
            onClick={() => useRepositoryFetch.setState({ entries: [] })}
          />
        </>
      )}
    </div>
  );
}
