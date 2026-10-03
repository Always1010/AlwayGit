import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './ui';

export interface MenuItem { label: string; icon?: string; disabled?: boolean; reason?: string; pressed?: boolean; run(): void | Promise<void> }
export function ContextMenu({ x, y, caption, items, anchor, close, className = '', placement = 'auto' }: { x: number; y: number; caption: string; items: MenuItem[]; anchor: HTMLElement; close(): void; className?: string; placement?: 'auto' | 'above' }) {
  const menu = useRef<HTMLDivElement>(null), [position, setPosition] = useState({ x: Math.max(6, x), y: Math.max(6, y) });
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement, element = menu.current!;
    const rect = element.getBoundingClientRect();
    setPosition({ x: Math.max(6, Math.min(x, innerWidth - rect.width - 6)), y: Math.max(6, Math.min(placement === 'above' || y + rect.height > innerHeight - 6 ? y - rect.height : y, innerHeight - rect.height - 6)) });
    // Opening a menu does not choose an action. Navigation starts on explicit input.
    element.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!element.contains(event.target as Node)) close(); };
    const resize = () => close();
    // Diff positioning and other panels' scrolling do not move this menu's source.
    const scroll = (event: Event) => { if (event.target === document || event.target === window || event.target instanceof Element && event.target.contains(anchor)) close(); };
    window.addEventListener('pointerdown', outside); window.addEventListener('resize', resize); window.addEventListener('scroll', scroll, true);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resize); window.removeEventListener('scroll', scroll, true); if ((element.contains(document.activeElement)||document.activeElement===document.body) && previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [x, y, anchor, close, placement]);
  return <div ref={menu} data-testid="context-menu" className={`context-menu ${className}`.trim()} role="menu" tabIndex={-1} aria-label={caption} style={{ left: position.x, top: position.y }} onContextMenu={event => event.preventDefault()} onPointerMove={event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    (button && !button.disabled ? button : event.currentTarget).focus({ preventScroll: true });
  }} onPointerLeave={event => event.currentTarget.focus({ preventScroll: true })} onKeyDown={event => {
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); close(); return; }
    const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (!buttons.length || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus({ preventScroll: true }); buttons[next].scrollIntoView({ block: 'nearest' });
  }}><div className="menu-caption">{caption}</div>{items.map(item => <button type="button" role="menuitem" tabIndex={-1} key={item.label} disabled={item.disabled} title={item.reason} onClick={() => { close(); void item.run(); }}><Icon name={item.icon ?? 'circle-small'} /><span>{item.label}</span></button>)}</div>;
}
