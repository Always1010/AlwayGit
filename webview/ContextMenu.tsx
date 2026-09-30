import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './ui';

export interface MenuItem { label: string; icon?: string; disabled?: boolean; reason?: string; pressed?: boolean; run(): void | Promise<void> }
export function ContextMenu({ x, y, caption, items, close }: { x: number; y: number; caption: string; items: MenuItem[]; close(): void }) {
  const menu = useRef<HTMLDivElement>(null), [position, setPosition] = useState({ x: Math.max(6, x), y: Math.max(6, y) });
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement, element = menu.current!;
    const rect = element.getBoundingClientRect();
    setPosition({ x: Math.max(6, Math.min(x, innerWidth - rect.width - 6)), y: Math.max(6, Math.min(y + rect.height > innerHeight - 6 ? y - rect.height : y, innerHeight - rect.height - 6)) });
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!element.contains(event.target as Node)) close(); };
    const resize = () => close();
    const scroll = (event: Event) => { if (!element.contains(event.target as Node)) close(); };
    window.addEventListener('pointerdown', outside); window.addEventListener('resize', resize); window.addEventListener('scroll', scroll, true);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resize); window.removeEventListener('scroll', scroll, true); if ((element.contains(document.activeElement)||document.activeElement===document.body) && previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [x, y]);
  return <div ref={menu} data-testid="context-menu" className="context-menu" role="menu" aria-label={caption} style={{ left: position.x, top: position.y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape' || event.key === 'Tab') { close(); return; }
    if (!buttons.length || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
  }}><div className="menu-caption">{caption}</div>{items.map(item => <button type="button" role="menuitem" key={item.label} disabled={item.disabled} title={item.reason} onClick={() => { close(); void item.run(); }}><Icon name={item.icon ?? 'circle-small'} /><span>{item.label}</span></button>)}</div>;
}
