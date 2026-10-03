import type { PushResult } from '../src/protocol/types';
import { useTranslation } from './i18n';
import { rpc } from './rpc';
import { useWorkbench } from './store';
import { Button } from './ui';
import { showRemoteRequest } from './RemoteRequestDialog';

export function PushFeedback({ result, repoId }: { result: PushResult; repoId: string }) {
  const t = useTranslation();
  const labels = { published: t('feedback.published'), updated: t('feedback.updated'), 'up-to-date': t('feedback.upToDate'), deleted: t('feedback.deleted'), rejected: t('feedback.rejected') };
  const open = (url: string) => void rpc('openExternal', repoId, { url }).catch(error => useWorkbench.getState().report(error));
  const copy = (url: string) => void rpc('copyText', repoId, { text: url }).catch(error => useWorkbench.getState().report(error));
  return <div className="push-feedback" data-testid="push-result">
    {result.destinations.map((destination, index) => <div className="push-destination" key={index}>
      <div className="push-destination-heading"><strong>{destination.label}</strong>{destination.repository && <Button icon="link-external" title={t('feedback.openRepositoryWebsite')} aria-label={t('feedback.openRepositoryWebsite')} onClick={()=>open(destination.repository!.url)}/>}</div>
      {destination.unconfirmed && <p className="warning-text">{t('feedback.destinationUnconfirmed')}</p>}
      {destination.refs.map(ref => <div className={`push-ref push-ref-${ref.status}`} key={`${ref.kind}-${ref.name}`}>
        <span>{ref.kind === 'tag' ? t('feedback.tag') : t('feedback.branch')}: <strong>{ref.name}</strong></span><span className="muted">{labels[ref.status]}</span>
        {ref.url && <><Button icon="link-external" title={t('feedback.openRemoteRef')} aria-label={t('feedback.openRemoteRef')} onClick={()=>open(ref.url!)}/><Button icon="copy" title={t('feedback.copyRemoteLink')} aria-label={t('feedback.copyRemoteLink')} onClick={()=>copy(ref.url!)}/></>}
        {ref.kind === 'branch' && ref.status !== 'rejected' && ref.status !== 'deleted' && destination.repository?.provider && <Button icon="git-pull-request" onClick={()=>ref.requestUrl ? open(ref.requestUrl) : void showRemoteRequest(repoId, ref.name, destination.repository, result.remote, result.localBranch)}>{ref.requestKind === 'view' ? t('feedback.viewRemoteRequest') : destination.repository.provider === 'gitlab' ? t('feedback.createMR') : t('feedback.createPR')}</Button>}
        {ref.releaseUrl && <Button icon="tag" onClick={()=>open(ref.releaseUrl!)}>{t('feedback.createRelease')}</Button>}
      </div>)}
    </div>)}
    <details className="feedback-details"><summary>{t('feedback.operationDetails')}</summary><pre>{result.output || t('feedback.noOutput')}</pre></details>
  </div>;
}
