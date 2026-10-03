import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface Props<T> {
  items: readonly T[];
  getKey(item: T): string;
  children(item: T, index: number): ReactNode;
  scrollParent: string;
  estimateSize?: number;
  focusSelector?: string;
}

/** Small lists retain their natural DOM; large lists share their existing scroll pane. */
export function VirtualFileRows<T>(props: Props<T>) {
  return props.items.length <= 200
    ? <>{props.items.map((item, index) => <Row key={props.getKey(item)}>{props.children(item, index)}</Row>)}</>
    : <LargeFileRows {...props}/>;
}

function Row({ children }: { children: ReactNode }) { return children; }

function LargeFileRows<T>({ items, getKey, children, scrollParent, estimateSize, focusSelector = '.file-name' }: Props<T>) {
  const spacer = useRef<HTMLDivElement>(null), [margin, setMargin] = useState(0), [focusIndex, setFocusIndex] = useState<number>();
  const viewport = () => spacer.current?.closest<HTMLElement>(scrollParent) ?? null;
  const virtual = useVirtualizer({
    count: items.length, getScrollElement: viewport, getItemKey: index => getKey(items[index]),
    estimateSize: () => { const pane = viewport(); return estimateSize ?? (pane && Number.parseFloat(getComputedStyle(pane).getPropertyValue('--file-row-height')) || 34); },
    overscan: 8, scrollMargin: margin,
  });
  const rows = virtual.getVirtualItems();
  const updateMargin = () => {
    const pane = viewport(), element = spacer.current;
    if (pane && element) setMargin(element.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - pane.clientTop);
  };
  useLayoutEffect(updateMargin);
  useLayoutEffect(() => {
    const pane = viewport(); if (!pane) return;
    let width = pane.clientWidth;
    const observer = new ResizeObserver(() => { updateMargin(); if (pane.clientWidth !== width) { width = pane.clientWidth; virtual.measure(); } });
    observer.observe(pane);
    // Earlier groups can change height after measuring wrapped paths or collapsing.
    for (const element of pane.children) observer.observe(element);
    return () => observer.disconnect();
  }, [scrollParent, items]);
  useLayoutEffect(() => {
    if (focusIndex === undefined) return;
    const control = spacer.current?.querySelector<HTMLElement>(`[data-index="${focusIndex}"] ${focusSelector}`);
    if (control) { control.focus({ preventScroll: true }); setFocusIndex(undefined); }
  }, [rows, focusIndex]);
  return <div className="virtual-file-spacer" ref={spacer} style={{ height: virtual.getTotalSize() }} onKeyDown={event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>('.virtual-file-row');
    if (!row) return;
    event.preventDefault();
    const index = Number(row.dataset.index), next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    virtual.scrollToIndex(next, { align: 'auto' }); setFocusIndex(next);
  }}>{rows.map(row => <div className="virtual-file-row" key={row.key} data-index={row.index} ref={virtual.measureElement} style={{ transform: `translateY(${row.start - margin}px)` }}>{children(items[row.index], row.index)}</div>)}</div>;
}
