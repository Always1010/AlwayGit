import { useLayoutEffect, useRef, useState } from 'react';
import { actionName } from './actionFeedback';
import type { ActionFeedback } from './actionFeedback';
import { useTranslation } from './i18n';
import { Icon } from './ui';

/** Separate from confirmation dialogs: no close control and no background interaction. */
export function OperationProgress({ feedback }: { feedback?: ActionFeedback }) {
  const t = useTranslation(), panel = useRef<HTMLDivElement>(null);
  const [openedAt] = useState(Date.now), [now, setNow] = useState(Date.now);
  const seconds = Math.max(0, Math.floor((now - (feedback?.startedAt ?? openedAt)) / 1000));
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = panel.current?.closest('[data-testid="workbench"]');
    const original = new Map<HTMLElement, boolean>();
    const lock = () => {
      for (const node of root?.children ?? []) if (node instanceof HTMLElement && node !== panel.current?.parentElement) {
        if (!original.has(node)) original.set(node, node.inert);
        node.inert = true;
      }
    };
    lock();
    const observer = new MutationObserver(lock);
    if (root) observer.observe(root, { childList: true });
    panel.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      panel.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', key, true);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer); window.removeEventListener('keydown', key, true);
      observer.disconnect(); original.forEach((inert, node) => { node.inert = inert; });
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
    };
  }, []);
  return <div className="modal-backdrop operation-progress-backdrop" data-testid="operation-progress" onContextMenu={event => event.preventDefault()}>
    <div className="modal operation-progress" ref={panel} role="dialog" aria-modal="true" aria-busy="true" aria-labelledby="operation-progress-title" aria-describedby="operation-progress-target" tabIndex={-1}>
      <Icon name="loading" className="feedback-spinner"/>
      <h2 id="operation-progress-title">{t('feedback.inProgress', { name: feedback ? actionName(feedback.action) : t('feedback.gitOperation') })}</h2>
      <p id="operation-progress-target">{feedback?.target}</p>
      <p role="status" aria-live="polite">{feedback?.phase === 'refreshing' ? t('feedback.updatingWorkbench') : t('feedback.waitForOperation')}</p>
      <span className="muted">{t('feedback.elapsed', { seconds })}</span>
      {seconds >= 15 && <p className="muted">{t('feedback.stillRunning')}</p>}
    </div>
  </div>;
}
