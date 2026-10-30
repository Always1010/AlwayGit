import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { DiffPreview } from '../src/protocol/types';
import { rpc } from './rpc';
import { useTranslation } from './i18n';
import { Button, Icon } from './ui';
import { useWorkbenchFields } from './subscriptions';
import { diffRowHeight } from './appearance';
import { useDiffVirtualizer } from './diff-virtualizer';

export function SnapshotTextPreview({ text, contentKey }: { text: string; contentKey: string }) {
  const { appearance } = useWorkbenchFields('appearance'),
    viewport = useRef<HTMLDivElement>(null),
    frame = useRef<HTMLDivElement>(null),
    horizontal = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(0),
    lines = useMemo(() => text.split(/\r?\n/), [text]),
    rowHeight = diffRowHeight(appearance.codeFont, appearance.codeRowHeight),
    wrap = appearance.textWrap !== 'off';
  const virtual = useDiffVirtualizer(lines.length, rowHeight, viewport, true, {
    contentKey,
    layoutKey: JSON.stringify([
      width,
      appearance.codeFont,
      appearance.textWrap,
      appearance.textWrapColumn,
    ]),
    wrap,
  });
  const extent = useRef({ key: '', text, maximum: 0 }),
    extentKey = JSON.stringify([
      contentKey,
      width,
      appearance.codeFont,
      appearance.textWrap,
      appearance.textWrapColumn,
    ]);
  if (extent.current.key !== extentKey || extent.current.text !== text)
    extent.current = { key: extentKey, text, maximum: 0 };
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = viewport.current,
      bar = horizontal.current;
    if (!element || !bar) return;
    let codeWidth = 0;
    for (const row of element.querySelectorAll<HTMLElement>('[data-preview-row]')) {
      const code = row.querySelector<HTMLElement>('[data-preview-code]'),
        cell = row.querySelector<HTMLElement>('.diff-code');
      if (!code || !cell) continue;
      codeWidth = cell.clientWidth;
      extent.current.maximum = Math.max(extent.current.maximum, code.scrollWidth);
    }
    const maximum = Math.max(codeWidth, extent.current.maximum);
    const spacer = bar.firstElementChild as HTMLElement;
    spacer.style.width = `${bar.clientWidth + Math.max(0, maximum - codeWidth)}px`;
    const overflow = maximum > codeWidth;
    bar.style.height = overflow ? '6px' : '0px';
    bar.tabIndex = overflow ? 0 : -1;
    frame.current?.style.setProperty('--diff-scroll-x', `${-bar.scrollLeft}px`);
  });
  const t = useTranslation();
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      const bar = horizontal.current;
      if (!bar || bar.scrollWidth <= bar.clientWidth) return;
      const unit =
        event.deltaMode === 1 ? rowHeight : event.deltaMode === 2 ? element.clientHeight : 1;
      const delta = (event.deltaX || (event.shiftKey ? event.deltaY : 0)) * unit;
      if (!delta) return;
      event.preventDefault();
      bar.scrollLeft += delta;
      frame.current?.style.setProperty('--diff-scroll-x', `${-bar.scrollLeft}px`);
      if (event.deltaY && !event.shiftKey) element.scrollTop += event.deltaY * unit * virtual.scale;
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [rowHeight, virtual.scale]);
  return (
    <div
      className="snapshot-text"
      ref={frame}
      data-text-wrap={appearance.textWrap}
      style={
        {
          '--preview-wrap-width': `${appearance.textWrapColumn}ch`,
          '--diff-line-digits': Math.max(2, String(lines.length).length),
          '--diff-font': `${appearance.codeFont}px`,
          '--diff-row-height': `${rowHeight}px`,
        } as CSSProperties
      }
    >
      <div className="snapshot-content" ref={viewport}>
        <div style={{ height: virtual.getScrollSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map((item) => (
            <div
              className="snapshot-line"
              key={item.index}
              data-preview-row={item.index}
              style={{
                position: 'absolute',
                width: '100%',
                height: item.size,
                transform: `translateY(${item.start}px)`,
              }}
            >
              <span className="line-number">{item.index + 1}</span>
              <span className="diff-code">
                <code data-preview-code>{lines[item.index]}</code>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div
        className="diff-horizontal-scroll"
        ref={horizontal}
        role="region"
        aria-label={t('diff.scrollHorizontally')}
        tabIndex={-1}
        onScroll={(event) =>
          frame.current?.style.setProperty(
            '--diff-scroll-x',
            `${-event.currentTarget.scrollLeft}px`,
          )
        }
      >
        <div />
      </div>
    </div>
  );
}

/** Read a fixed historical side through the existing decoding, images and LFS pipeline. */
export function SnapshotPreview({
  repoId,
  revision,
  path,
  onClose,
}: {
  repoId: string;
  revision: string;
  path: string;
  onClose(): void;
}) {
  const t = useTranslation(),
    [preview, setPreview] = useState<DiffPreview>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    setPreview(undefined);
    setError(undefined);
    void rpc<DiffPreview>(
      'isolatedDiffPreview',
      repoId,
      { kind: 'snapshot', revision, path },
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error.message ?? error));
      });
    return () => controller.abort();
  }, [repoId, revision, path]);
  const open = () =>
    void rpc('openRevision', repoId, { revision, path }).catch((error) => setError(error.message));
  const unavailable =
    preview?.kind === 'binary'
      ? t(
          preview.reason === 'image-too-large'
            ? 'diff.imageExceedsThe4MiBPreviewLimit'
            : preview.reason === 'image-dimensions-too-large'
              ? 'diff.imageDimensionsExceedThePreviewLimit'
              : preview.reason === 'lfs-missing'
                ? 'historicalLfs.missing'
                : preview.reason === 'lfs-too-large'
                  ? 'historicalLfs.tooLarge'
                  : preview.reason === 'lfs-unavailable'
                    ? 'historicalLfs.unavailable'
                    : 'diff.binaryFileTextPreviewUnavailable',
        )
      : t('diff.binaryFileTextPreviewUnavailable');
  return (
    <section className="snapshot-preview">
      <div className="pane-heading">
        <span className="truncate" title={path}>
          {path}
        </span>
        <div className="inline-actions">
          <Button
            className="icon-only"
            icon="go-to-file"
            title={t('tree.openHistoricalFile')}
            aria-label={t('tree.openHistoricalFile')}
            onClick={open}
            disabled={preview?.kind !== 'text'}
          />
          <Button
            className="icon-only"
            icon="close"
            title={t('tree.closePreview')}
            aria-label={t('tree.closePreview')}
            onClick={onClose}
          />
        </div>
      </div>
      {error ? (
        <div className="revision-tree-error" role="alert">
          {error}
        </div>
      ) : !preview ? (
        <div className="revision-tree-loading">
          <Icon name="loading" className="codicon-modifier-spin" /> {t('tree.loading')}
        </div>
      ) : preview.kind === 'text' ? (
        preview.right ? (
          <SnapshotTextPreview
            key={`${repoId}:${revision}:${path}`}
            contentKey={`${repoId}:${revision}:${path}`}
            text={preview.right}
          />
        ) : (
          <div className="revision-tree-loading">{t('tree.emptyFile')}</div>
        )
      ) : preview.kind === 'image' && preview.right ? (
        <div className="snapshot-image">
          <img src={`data:${preview.right.mimeType};base64,${preview.right.data}`} alt={path} />
        </div>
      ) : (
        <div className="revision-tree-loading">{unavailable}</div>
      )}
    </section>
  );
}
