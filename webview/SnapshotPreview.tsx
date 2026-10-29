import { useEffect, useState } from 'react';
import type { DiffPreview } from '../src/protocol/types';
import { rpc } from './rpc';
import { useTranslation } from './i18n';
import { Button, Icon } from './ui';

/** Read a fixed historical side through the existing decoding, images and LFS pipeline. */
export function SnapshotPreview({ repoId, revision, path, onClose }: { repoId: string; revision: string; path: string; onClose(): void }) {
  const t = useTranslation(), [preview, setPreview] = useState<DiffPreview>(), [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController(); setPreview(undefined); setError(undefined);
    void rpc<DiffPreview>('isolatedDiffPreview', repoId, { kind: 'snapshot', revision, path }, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setPreview(value); }).catch(error => { if (!controller.signal.aborted) setError(String(error.message ?? error)); });
    return () => controller.abort();
  }, [repoId, revision, path]);
  const open = () => void rpc('openRevision', repoId, { revision, path }).catch(error => setError(error.message));
  const unavailable = preview?.kind === 'binary' ? t(preview.reason === 'image-too-large' ? 'diff.imageExceedsThe4MiBPreviewLimit' : preview.reason === 'image-dimensions-too-large' ? 'diff.imageDimensionsExceedThePreviewLimit' : preview.reason === 'lfs-missing' ? 'historicalLfs.missing' : preview.reason === 'lfs-too-large' ? 'historicalLfs.tooLarge' : preview.reason === 'lfs-unavailable' ? 'historicalLfs.unavailable' : 'diff.binaryFileTextPreviewUnavailable') : t('diff.binaryFileTextPreviewUnavailable');
  return <section className="snapshot-preview">
    <div className="pane-heading"><span className="truncate" title={path}>{path}</span><div className="inline-actions"><Button className="icon-only" icon="go-to-file" title={t('tree.openHistoricalFile')} aria-label={t('tree.openHistoricalFile')} onClick={open} disabled={preview?.kind !== 'text'}/><Button className="icon-only" icon="close" title={t('tree.closePreview')} aria-label={t('tree.closePreview')} onClick={onClose}/></div></div>
    {error ? <div className="revision-tree-error" role="alert">{error}</div> : !preview ? <div className="revision-tree-loading"><Icon name="loading" className="codicon-modifier-spin"/> {t('tree.loading')}</div> : preview.kind === 'text' ? <pre className="snapshot-content">{preview.right || t('tree.emptyFile')}</pre> : preview.kind === 'image' && preview.right ? <div className="snapshot-image"><img src={`data:${preview.right.mimeType};base64,${preview.right.data}`} alt={path}/></div> : <div className="revision-tree-loading">{unavailable}</div>}
  </section>;
}
