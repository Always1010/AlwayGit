import { useLayoutEffect, useState, type RefObject } from 'react';

const MAX_SCROLL_HEIGHT = 8_000_000;
/** Fixed rows need no per-row measurement array; cap the browser spacer, not file content. */
export function useDiffVirtualizer(
  count: number,
  rowHeight: number,
  viewport: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  const [view, setView] = useState({ top: 0, height: 0 });
  const total = count * rowHeight,
    scrollSize = Math.min(total, MAX_SCROLL_HEIGHT);
  const scale =
    total > view.height ? Math.max(0, scrollSize - view.height) / (total - view.height) : 1;
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
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !enabled) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener('scroll', measure);
    const wheel = (event: WheelEvent) => {
      if (scale >= 1 || !event.deltaY || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? rowHeight : event.deltaMode === 2 ? element.clientHeight : 1);
      element.scrollTop += delta * scale;
      if (event.deltaX) element.scrollLeft += event.deltaX;
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', measure);
      element.removeEventListener('wheel', wheel);
    };
  }, [enabled, scale, rowHeight]);
  const top = logicalOffset(view.top);
  const first = Math.max(0, Math.floor(top / rowHeight) - 8),
    end = Math.min(count, Math.ceil((top + view.height) / rowHeight) + 8);
  const items: { index: number; start: number }[] = [];
  for (let index = first; index < end; index++)
    items.push({ index, start: view.top + index * rowHeight - top });
  return {
    scale,
    toLogicalOffset: logicalOffset,
    toScrollOffset: scrollOffset,
    measure,
    getTotalSize: () => total,
    getScrollSize: () => scrollSize,
    getVirtualItems: () => items,
    scrollToOffset: (offset: number) => {
      viewport.current?.scrollTo({ top: scrollOffset(offset) });
      measure();
    },
  };
}
