import { useEffect, useState } from 'react';
import type { HistoricalLfsPreviewObject } from '../src/protocol/types';
import type { LfsDestinations } from '../src/protocol/lfs';
import { Button, Modal } from './ui';
import { useTranslation } from './i18n';
import { rpc } from './rpc';
import { captureActionContext, isActionContextCurrent, useWorkbench } from './store';
import { useWorkbenchFields } from './subscriptions';

/** Historical previews never download implicitly. Only this reviewed, remote-bound action can fetch. */
export function HistoricalLfsPreview({ objects, repoId, isolated, refreshed }: {
  objects: HistoricalLfsPreviewObject[]; repoId?: string; isolated: boolean; refreshed(): void;
}) {
  const t = useTranslation(), state = useWorkbenchFields('busy', 'repoId');
  const [selected, setSelected] = useState<HistoricalLfsPreviewObject>(), [destinations, setDestinations] = useState<LfsDestinations>();
  const [remote, setRemote] = useState(''), [error, setError] = useState<string>();
  const canDownload = !isolated && repoId === state.repoId && !state.busy;
  useEffect(() => {
    setDestinations(undefined); setRemote(''); setError(undefined);
    if (!selected || !repoId) return;
    const controller = new AbortController();
    void rpc<LfsDestinations>('lfsDestinations', repoId, undefined, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setDestinations(value); setRemote(Object.keys(value)[0] ?? '');
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [selected, repoId]);
  async function download() {
    const context = captureActionContext(), destination = destinations?.[remote];
    if (!selected || !destination || !canDownload || context.repoId !== repoId) return;
    const completed = await useWorkbench.getState().execute({ type: 'lfs.fetchHistorical', revision: selected.revision, path: selected.path,
      oid: selected.oid, remote, expectedDestination: destination.fetch }, context);
    if (completed && isActionContextCurrent(context)) { setSelected(undefined); refreshed(); }
    else if (isActionContextCurrent(context)) setError(useWorkbench.getState().error ?? t('historicalLfs.failed'));
  }
  return <>
    <div className="historical-lfs-metadata" aria-label={t('historicalLfs.metadata')}>
      {objects.map(object => <div className="history-caption" key={`${object.side}:${object.revision}:${object.path}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span>{t('historicalLfs.object', { side: object.side === 'left' ? t('historicalLfs.left') : t('historicalLfs.right'), size: object.size })}</span>
        <code className="truncate" style={{ maxWidth: '18ch' }} title={`sha256:${object.oid}`}>{object.oid}</code>
        <span>{t(object.resolved ? 'historicalLfs.cached' : object.localObject === 'available' ? 'historicalLfs.tooLarge' : 'historicalLfs.notLoaded')}</span>
        {!object.resolved && object.localObject !== 'available' && object.downloadable && <Button icon="cloud-download" disabled={!canDownload} title={isolated ? t('historicalLfs.isolated') : t('historicalLfs.download')} onClick={() => setSelected(object)}>{t('historicalLfs.download')}</Button>}
      </div>)}
    </div>
    {selected && <Modal title={t('historicalLfs.download')} busy={state.busy} onClose={() => setSelected(undefined)} footer={<>
      <Button disabled={state.busy} onClick={() => setSelected(undefined)}>{t('common.cancel')}</Button>
      <Button icon="cloud-download" disabled={!canDownload || !remote || !destinations?.[remote]} onClick={() => void download()}>{t('historicalLfs.confirm')}</Button>
    </>}>
      <p>{t('historicalLfs.confirmHint')}</p><p>{t('historicalLfs.file', { path: selected.path, size: selected.size })}</p>
      <code style={{ overflowWrap: 'anywhere' }}>{selected.revision}<br/>{t('historicalLfs.hash', { oid: selected.oid })}</code>
      <label>{t('historicalLfs.remote')}<select value={remote} disabled={state.busy || !destinations} onChange={event => setRemote(event.target.value)}>
        {Object.keys(destinations ?? {}).map(name => <option key={name} value={name}>{name}</option>)}
      </select></label>
      {destinations && !Object.keys(destinations).length && <p role="status">{t('historicalLfs.noRemote')}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>}
  </>;
}
