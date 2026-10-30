import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { PreviewRowMetrics } from './preview-row-metrics';

const MAX_SCROLL_HEIGHT = 8_000_000;
type Anchor = ReturnType<PreviewRowMetrics['anchor']>;

/** Measure only visible text; paged, unvisited rows retain their base-height estimate. */
export function useDiffVirtualizer(
  count: number,
  rowHeight: number,
  viewport: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  options = { contentKey: '', layoutKey: '', wrap: false },
) {
  const [view, setView] = useState({ top: 0, height: 0 }),
    [, render] = useState(0),
    model = useRef({
      contentKey: options.contentKey,
      layoutKey: options.layoutKey,
      metrics: new PreviewRowMetrics(count, rowHeight),
    }),
    previousScale = useRef(1),
    programmedTop = useRef<number | undefined>(undefined),
    pendingAnchor = useRef<Anchor | undefined>(undefined),
    destination = useRef<{ start: number; end: number } | undefined>(undefined);
  const previous = model.current;
  if (
    previous.contentKey !== options.contentKey ||
    previous.layoutKey !== options.layoutKey ||
    previous.metrics.count !== count ||
    previous.metrics.rowHeight !== rowHeight
  ) {
    pendingAnchor.current =
      previous.contentKey === options.contentKey
        ? previous.metrics.anchor(
            (viewport.current?.scrollTop ?? view.top) / (previousScale.current || 1),
          )
        : undefined;
    destination.current = undefined;
    model.current = {
      contentKey: options.contentKey,
      layoutKey: options.layoutKey,
      metrics: new PreviewRowMetrics(count, rowHeight),
    };
  }
  const metrics = model.current.metrics,
    total = metrics.offset(count),
    scrollSize = Math.min(total, MAX_SCROLL_HEIGHT),
    scale = total > view.height ? Math.max(0, scrollSize - view.height) / (total - view.height) : 1;
  previousScale.current = scale;
  const logicalOffset = (offset: number) => (scale ? offset / scale : 0);
  const scrollOffset = (offset: number) => offset * scale;
  const measure = () => {
    const element = viewport.current;
    if (element)
      setView((previous) =>
        previous.top === element.scrollTop && previous.height === element.clientHeight
          ? previous
          : { top: element.scrollTop, height: element.clientHeight },
      );
  };
  const scrollToOffset = (offset: number) => {
    programmedTop.current = scrollOffset(Math.max(0, Math.min(offset, total - view.height)));
    viewport.current?.scrollTo({ top: programmedTop.current });
    measure();
  };
  const rangeOffset = (start: number, end: number) => {
    const top = metrics.offset(start),
      bottom = metrics.offset(end + 1);
    return bottom - top >= view.height ? top : (top + bottom - view.height) / 2;
  };
  useLayoutEffect(() => {
    if (!enabled || !viewport.current) return;
    if (destination.current)
      scrollToOffset(rangeOffset(destination.current.start, destination.current.end));
    else if (pendingAnchor.current) scrollToOffset(metrics.restore(pendingAnchor.current));
    pendingAnchor.current = undefined;
  });
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !enabled) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const trackScroll = () => {
      if (
        programmedTop.current === undefined ||
        Math.abs(element.scrollTop - programmedTop.current) > 1
      )
        destination.current = undefined;
      measure();
    };
    element.addEventListener('scroll', trackScroll);
    const cancelDestination = () => {
      destination.current = undefined;
    };
    const wheel = (event: WheelEvent) => {
      cancelDestination();
      if (scale >= 1 || !event.deltaY || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? rowHeight : event.deltaMode === 2 ? element.clientHeight : 1);
      element.scrollTop += delta * scale;
      if (event.deltaX) element.scrollLeft += event.deltaX;
    };
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('pointerdown', cancelDestination);
    element.addEventListener('keydown', cancelDestination);
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', trackScroll);
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('pointerdown', cancelDestination);
      element.removeEventListener('keydown', cancelDestination);
    };
  }, [enabled, scale, rowHeight]);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !enabled || !options.wrap) return;
    const measureRows = () => {
      const anchor = metrics.anchor(logicalOffset(element.scrollTop));
      let changed = false;
      for (const row of element.querySelectorAll<HTMLElement>('[data-preview-row]')) {
        if (row.dataset.previewLoaded === 'false') continue;
        const height = Math.max(
          rowHeight,
          ...[...row.querySelectorAll<HTMLElement>('[data-preview-code]')].map(
            (code) => code.getBoundingClientRect().height,
          ),
        );
        changed = metrics.measure(Number(row.dataset.previewRow), height) || changed;
      }
      if (changed) {
        pendingAnchor.current = anchor;
        render((value) => value + 1);
      }
    };
    measureRows();
    const observer = new ResizeObserver(measureRows);
    for (const code of element.querySelectorAll('[data-preview-code]')) observer.observe(code);
    return () => observer.disconnect();
  });
  const top = logicalOffset(view.top),
    first = Math.max(0, metrics.rowAt(top) - 8),
    end = Math.min(count, metrics.rowAt(top + view.height) + 9);
  const items: { index: number; start: number; size: number }[] = [];
  for (let index = first; index < end; index++)
    items.push({ index, start: view.top + metrics.offset(index) - top, size: metrics.size(index) });
  return {
    scale,
    toLogicalOffset: logicalOffset,
    toScrollOffset: scrollOffset,
    rowAtOffset: (offset: number) => metrics.rowAt(offset),
    offsetAtRow: (index: number) => metrics.offset(index),
    getAnchor: () => metrics.anchor(logicalOffset(viewport.current?.scrollTop ?? view.top)),
    scrollToAnchor: (anchor: Anchor) => {
      destination.current = undefined;
      pendingAnchor.current = anchor;
      scrollToOffset(metrics.restore(anchor));
    },
    measure,
    getTotalSize: () => total,
    getScrollSize: () => scrollSize,
    getVirtualItems: () => items,
    scrollToOffset,
    scrollToRange: (start: number, end: number) => {
      destination.current = { start, end };
      scrollToOffset(rangeOffset(start, end));
    },
  };
}
