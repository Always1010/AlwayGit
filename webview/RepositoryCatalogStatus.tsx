import React, { useEffect, useState } from 'react';
import { Button, Icon } from './ui';
import { useTranslation } from './i18n';

export function RepositoryCatalogStatus({ phase, error, retry, showLog }: {
  phase: 'loading' | 'error'; error?: string; retry(): void; showLog(): void;
}) {
  const t = useTranslation(), [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (phase !== 'loading') return;
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, [phase]);
  return <div className="empty repository-catalog-status" role={phase === 'loading' ? 'status' : 'alert'} aria-busy={phase === 'loading'}>
    <Icon name={phase === 'loading' ? 'loading' : 'error'} className={phase === 'loading' ? 'feedback-spinner' : ''}/>
    <strong>{phase === 'loading' ? t('workbench.loadingRepositories') : t('workbench.repositoryLoadingFailed')}</strong>
    <p>
      {phase === 'loading' ? <><span>{t('workbench.restoringRepositories')}</span>{slow && <span>{t('workbench.repositoryLoadingSlow')}</span>}</> : <><span>{error}</span><Button icon="refresh" onClick={retry}>{t('workbench.retryRepositories')}</Button></>}
      {(slow || phase === 'error') && <Button icon="output" onClick={showLog}>{t('workbench.showLog')}</Button>}
    </p>
  </div>;
}
