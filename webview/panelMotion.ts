import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Animate snaps only; ordinary resizing takes over the current visible width immediately. */
export function usePanelMotion(value: number, collapsed: boolean) {
  const [width, setWidth] = useState(collapsed ? 0 : value);
  const visible = useRef(width), target = useRef({ value, collapsed }), frame = useRef<number | undefined>(undefined);
  const stop = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
  }, []);
  const show = useCallback((next: number) => { visible.current = next; setWidth(next); }, []);
  const animate = useCallback((next: number) => {
    stop();
    const start = visible.current;
    if (Math.abs(next - start) < 0.5 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { show(next); return; }
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - started) / 140));
      show(start + (next - start) * (1 - (1 - progress) ** 3));
      if (progress < 1) frame.current = requestAnimationFrame(tick);
      else { frame.current = undefined; show(next); }
    };
    frame.current = requestAnimationFrame(tick);
  }, [show, stop]);
  const change = useCallback((next: number, folded: boolean) => {
    const wasCollapsed = target.current.collapsed;
    target.current = { value: next, collapsed: folded };
    if (folded !== wasCollapsed) animate(folded ? 0 : next);
    else if (!folded) { stop(); show(next); }
  }, [animate, show, stop]);
  // Also handle Restore Layout, viewport bounds, and restored sessions.
  useLayoutEffect(() => {
    if (target.current.value !== value || target.current.collapsed !== collapsed) change(value, collapsed);
  }, [value, collapsed, change]);
  useLayoutEffect(() => stop, [stop]);
  const settle = useCallback(() => animate(target.current.collapsed ? 0 : target.current.value), [animate]);
  return { width, hidden: collapsed && width === 0, change, stop, settle };
}
