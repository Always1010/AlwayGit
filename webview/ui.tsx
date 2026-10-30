import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from './i18n';
import { useWorkbench } from './store';
import { shortcutAria, shortcutTitle, type WorkbenchShortcut } from './shortcutKeys';

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  if (name === 'stage-inbox')
    return (
      <svg
        aria-hidden="true"
        className={`stage-inbox-icon ${className}`}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
      </svg>
    );
  return <i aria-hidden="true" className={`codicon codicon-${name} ${className}`} />;
}
export function Button({
  children,
  icon,
  shortcut,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: string;
  shortcut?: WorkbenchShortcut;
}) {
  const singleKeys = useWorkbench((state) => state.singleKeyShortcuts);
  const overrides = useWorkbench((state) => state.shortcutOverrides);
  const title =
    props.title ?? props['aria-label'] ?? (typeof children === 'string' ? children : undefined);
  return (
    <button
      className={`button ${className}`}
      {...props}
      title={shortcut ? shortcutTitle(title, shortcut, singleKeys, overrides) : props.title}
      aria-keyshortcuts={
        shortcut ? shortcutAria(shortcut, singleKeys, overrides) : props['aria-keyshortcuts']
      }
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}
export function BranchIcon({ remote = false }: { remote?: boolean }) {
  return (
    <span className="branch-icon" aria-hidden="true">
      <Icon name={remote ? 'cloud' : 'git-branch'} />
    </span>
  );
}
export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <Icon name="git-commit" />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function hasOpenInteractionLayer(): boolean {
  return !!document.querySelector('[aria-modal="true"], [role="menu"]');
}

export function ResizeHandle({
  axis,
  label,
  value,
  onChange,
  min,
  max,
  reverse = false,
  className = '',
}: {
  axis: 'x' | 'y';
  label: string;
  value: number;
  onChange(value: number): void;
  min: number;
  max: number;
  reverse?: boolean;
  className?: string;
}) {
  const bound = (next: number) => Math.round(Math.max(min, Math.min(max, next)));
  const listeners = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => listeners.current?.(), []);
  return (
    <button
      type="button"
      role="separator"
      aria-label={label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      className={`resize-handle resize-${axis} ${className}`}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
          return;
        event.preventDefault();
        const positive = ['ArrowRight', 'ArrowDown'].includes(event.key);
        onChange(
          event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : bound(value + (positive ? 8 : -8) * (reverse ? -1 : 1)),
        );
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        listeners.current?.();
        const element = event.currentTarget,
          start = axis === 'x' ? event.clientX : event.clientY;
        element.setPointerCapture(event.pointerId);
        const move = (next: PointerEvent) =>
          onChange(
            bound(
              value + ((axis === 'x' ? next.clientX : next.clientY) - start) * (reverse ? -1 : 1),
            ),
          );
        const up = () => {
          element.removeEventListener('pointermove', move);
          element.removeEventListener('pointerup', up);
          element.removeEventListener('pointercancel', up);
          listeners.current = undefined;
        };
        listeners.current = up;
        element.addEventListener('pointermove', move);
        element.addEventListener('pointerup', up);
        element.addEventListener('pointercancel', up);
      }}
    />
  );
}

export function PanelDivider({
  side,
  collapsed,
  toggleLabel,
  controls,
  onToggle,
  label,
  value,
  renderedValue,
  min,
  max,
  onChange,
  onDragStart,
  onDragEnd,
}: {
  side: 'left' | 'right';
  collapsed: boolean;
  toggleLabel: string;
  controls: string;
  onToggle(): void;
  label: string;
  value: number;
  renderedValue: number;
  min: number;
  max: number;
  onChange(value: number, collapsed: boolean): void;
  onDragStart(): void;
  onDragEnd(): void;
}) {
  const listeners = useRef<(() => void) | undefined>(undefined);
  const current = useRef({ onChange, onDragEnd, min, max });
  current.current = { onChange, onDragEnd, min, max };
  useEffect(() => () => listeners.current?.(), []);
  const bound = (next: number) => Math.round(Math.max(min, Math.min(max, next)));
  return (
    <div className={`panel-divider panel-divider-${side}`} data-collapsed={collapsed}>
      <button
        type="button"
        role="separator"
        aria-label={label}
        title={label}
        aria-controls={controls}
        aria-orientation="vertical"
        aria-valuenow={collapsed ? 0 : value}
        aria-valuemin={0}
        aria-valuemax={max}
        className="resize-handle resize-x"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          const delta = (event.key === 'ArrowRight' ? 8 : -8) * (side === 'right' ? -1 : 1);
          if (event.key === 'Home') onChange(min, false);
          else if (event.key === 'End') onChange(max, false);
          else if (!collapsed || delta > 0)
            onChange(bound(collapsed ? value : value + delta), false);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          listeners.current?.();
          const element = event.currentTarget,
            pointerId = event.pointerId,
            start = event.clientX;
          const initialValue = value,
            initialCollapsed = collapsed,
            origin = renderedValue;
          let folded = collapsed;
          onDragStart();
          element.focus({ preventScroll: true });
          element.setPointerCapture(pointerId);
          element.dataset.dragging = 'true';
          const cleanup = (settle = false) => {
            element.removeEventListener('pointermove', move);
            element.removeEventListener('pointerup', up);
            element.removeEventListener('pointercancel', cancel);
            element.removeEventListener('lostpointercapture', cancel);
            element.removeEventListener('keydown', keydown);
            delete element.dataset.dragging;
            listeners.current = undefined;
            if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
            if (settle) current.current.onDragEnd();
          };
          const move = (next: PointerEvent) => {
            if (next.pointerId !== pointerId) return;
            const { onChange, min, max } = current.current;
            // Use the original pointer origin throughout the gesture, including after a snap.
            const raw = origin + (next.clientX - start) * (side === 'right' ? -1 : 1);
            if (!folded && raw < min) folded = true;
            else if (folded && raw >= min + 16) folded = false;
            onChange(folded ? initialValue : Math.round(Math.max(min, Math.min(max, raw))), folded);
          };
          const up = (next: PointerEvent) => {
            if (next.pointerId === pointerId) cleanup(true);
          };
          const cancel = (next: PointerEvent) => {
            if (next.pointerId !== pointerId) return;
            cleanup();
            current.current.onChange(initialValue, initialCollapsed);
          };
          const keydown = (next: KeyboardEvent) => {
            if (next.key !== 'Escape') return;
            next.preventDefault();
            next.stopPropagation();
            cleanup();
            current.current.onChange(initialValue, initialCollapsed);
          };
          listeners.current = cleanup;
          element.addEventListener('pointermove', move);
          element.addEventListener('pointerup', up);
          element.addEventListener('pointercancel', cancel);
          element.addEventListener('lostpointercapture', cancel);
          element.addEventListener('keydown', keydown);
        }}
      />
      <Button
        className="icon-only panel-toggle"
        icon={(side === 'left') !== collapsed ? 'chevron-left' : 'chevron-right'}
        title={toggleLabel}
        aria-label={toggleLabel}
        aria-expanded={!collapsed}
        aria-controls={controls}
        onClick={onToggle}
      />
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  busy = false,
  footer,
  className = '',
  style,
}: {
  title: string;
  children: React.ReactNode;
  onClose(): void;
  busy?: boolean;
  footer?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const t = useTranslation(),
    panel = useRef<HTMLDivElement>(null),
    callback = useRef(onClose);
  callback.current = onClose;
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement;
    (
      panel.current?.querySelector<HTMLElement>('[data-autofocus="true"]:not(:disabled)') ??
      panel.current?.querySelector<HTMLElement>(
        'input:not([type=checkbox]):not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled)',
      )
    )?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const dialogs = [
          ...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
        ];
        if (dialogs.at(-1) !== panel.current) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (panel.current?.getAttribute('aria-busy') !== 'true') callback.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [
        ...(panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)',
        ) ?? []),
      ];
      const first = controls[0],
        last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={`modal ${className}`.trim()}
        style={style}
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={busy}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <Button
            icon="close"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={onClose}
            disabled={busy}
          />
        </div>
        <div className="modal-body">{children}</div>
        {footer !== null && (
          <div className="modal-footer">
            {footer ?? (
              <Button onClick={onClose} disabled={busy}>
                {t('common.close')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
