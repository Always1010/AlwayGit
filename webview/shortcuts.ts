import { useEffect, useLayoutEffect, useRef } from 'react';
import { useWorkbench } from './store';
import { selectionTargetIsEditable } from './selectionKeyboard';
import { dispatchShortcut, type ShortcutActions, type WorkbenchShortcut } from './shortcutKeys';

const actions: ShortcutActions = {};
export function useShortcuts(commands: ShortcutActions): void {
  useLayoutEffect(() => {
    Object.assign(actions, commands);
    return () => {
      for (const command of Object.keys(commands) as WorkbenchShortcut[]) if (actions[command] === commands[command]) delete actions[command];
    };
  });
}

function editable(target: EventTarget | null): boolean {
  return selectionTargetIsEditable(target) || target instanceof Element && !!target.closest('select,[role="textbox"],[role="combobox"]');
}

export function useWorkbenchKeyboard(blocked: boolean): void {
  const blockedRef = useRef(blocked);
  useLayoutEffect(() => { blockedRef.current = blocked; }, [blocked]);
  useEffect(() => {
    let composing = false;
    const start = () => { composing = true; }, end = () => { composing = false; };
    const hasOverlay = () => blockedRef.current || !!document.querySelector('[aria-modal="true"],[role="menu"]');
    const key = (event: KeyboardEvent) => dispatchShortcut(event, actions, {
      singleKeys: useWorkbench.getState().singleKeyShortcuts,
      blocked: hasOverlay() || !document.querySelector('[data-testid="workbench"]'),
      editable: editable(event.target) || editable(document.activeElement), composing,
    });
    const pointer = (event: PointerEvent) => {
      if (event.button !== 0 || hasOverlay() || editable(event.target) || !editable(document.activeElement) || !(event.target instanceof Element)) return;
      const root = event.target.closest<HTMLElement>('[data-testid="workbench"]');
      if (!root) return;
      // Separators suppress the browser's focus transfer; blank Diff text is not focusable.
      const target = event.target.closest<HTMLElement>('button:not(:disabled),a[href],[tabindex],input:not(:disabled)');
      (target ?? root).focus({ preventScroll: true });
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('compositionstart', start, true);
    window.addEventListener('compositionend', end, true);
    window.addEventListener('pointerdown', pointer, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('compositionstart', start, true);
      window.removeEventListener('compositionend', end, true);
      window.removeEventListener('pointerdown', pointer, true);
    };
  }, []);
}
