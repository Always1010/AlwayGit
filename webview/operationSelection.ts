import { useEffect, useRef } from 'react';

interface SelectionOptions {
  rows: string;
  control: string;
  preserve?: string;
  clear(): void;
}

const interactive = 'button,input,select,textarea,a[href],label,[contenteditable="true"]';
const interactionLayer = '[role="menu"],[aria-modal="true"],.modal-backdrop';

/** Selection is temporary; DOM focus and the displayed repository/Diff have separate lifetimes. */
export function useOperationSelection<T extends HTMLElement = HTMLDivElement>(
  options: SelectionOptions,
) {
  const root = useRef<T>(null),
    latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let dragging = false;
    let lastControl: HTMLElement | undefined;
    const rowFor = (target: Element) => {
      const row = target.closest<HTMLElement>(latest.current.rows);
      if (!row || !element.contains(row)) return;
      const control = row.matches(latest.current.control)
        ? row
        : row.querySelector<HTMLElement>(latest.current.control);
      const action = target.closest(interactive);
      return control && (!action || action === control) ? { row, control } : undefined;
    };
    const preserved = (target: Element) =>
      !!latest.current.preserve && !!target.closest(latest.current.preserve);
    const pointer = (event: PointerEvent) => {
      if (
        dragging ||
        ![0, 2].includes(event.button) ||
        !(event.target instanceof Element) ||
        event.target.closest(interactionLayer)
      )
        return;
      const target = event.target;
      if (element.contains(target)) {
        if (rowFor(target) || preserved(target)) return;
        latest.current.clear();
        if (event.button === 0 && !target.closest(interactive)) {
          // Empty list space clears selection without moving the last row's real focus.
          event.preventDefault();
          if (!element.contains(document.activeElement))
            (lastControl?.isConnected && lastControl.getClientRects().length
              ? lastControl
              : (target.closest<HTMLElement>('[tabindex]') ?? element)
            ).focus({ preventScroll: true });
        }
      } else {
        latest.current.clear();
        // Non-focusable content must also release the old row's focus outline.
        if (element.contains(document.activeElement)) {
          const destination = target.closest<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select,textarea,a[href],[tabindex]',
          );
          (destination ?? element.closest<HTMLElement>('[data-testid="workbench"]'))?.focus({
            preventScroll: true,
          });
        }
      }
    };
    const focus = (event: FocusEvent) => {
      if (!(event.target instanceof Element) || dragging) return;
      const target = event.target;
      if (target.closest(interactionLayer)) return;
      if (!element.contains(target)) {
        latest.current.clear();
        return;
      }
      delete element.dataset.selectionFocusSuspended;
      if (preserved(target)) return;
      const item = rowFor(target);
      if (!item) {
        // Focusing the list itself is navigation, not a request to discard selection.
        if (!target.matches('[role="listbox"],[role="tree"]') && target !== element)
          latest.current.clear();
        return;
      }
      lastControl = item.control;
      const previous = event.relatedTarget;
      if (
        previous instanceof Element &&
        element.contains(previous) &&
        previous.closest('[data-selection-scope]') !== target.closest('[data-selection-scope]')
      )
        latest.current.clear();
    };
    const forwardRowClick = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        !(event.target instanceof Element) ||
        event.target.closest(interactive)
      )
        return;
      const item = rowFor(event.target);
      if (!item) return;
      item.control.focus({ preventScroll: true });
      item.control.dispatchEvent(
        new MouseEvent(event.type, {
          bubbles: true,
          cancelable: true,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          detail: event.detail,
        }),
      );
    };
    const dragStart = () => {
      dragging = true;
    };
    const dragEnd = () => {
      dragging = false;
    };
    const blur = () => {
      element.dataset.selectionFocusSuspended = 'true';
      if (!dragging && !document.querySelector(interactionLayer)) latest.current.clear();
    };
    const resume = () => {
      delete element.dataset.selectionFocusSuspended;
    };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('focusin', focus, true);
    element.addEventListener('click', forwardRowClick);
    element.addEventListener('dblclick', forwardRowClick);
    element.addEventListener('dragstart', dragStart);
    document.addEventListener('dragend', dragEnd);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', resume);
    return () => {
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('focusin', focus, true);
      element.removeEventListener('click', forwardRowClick);
      element.removeEventListener('dblclick', forwardRowClick);
      element.removeEventListener('dragstart', dragStart);
      document.removeEventListener('dragend', dragEnd);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', resume);
    };
  }, []);
  return root;
}
