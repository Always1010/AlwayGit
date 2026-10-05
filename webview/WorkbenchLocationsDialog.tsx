import { useEffect, useRef, useState } from 'react';
import { translator, type Language } from '../src/i18n';
import type { WorkbenchLocation, WorkbenchLocations } from '../src/protocol/workbench-host';
import './workbench-locations.css';

/** Shared by the lightweight launch page and the complete workbench. */
export function WorkbenchLocationsDialog({ locations, language, onApply, onClose }: {
  locations: WorkbenchLocations; language: Language;
  onApply(locations: WorkbenchLocations): Promise<unknown>; onClose(): void;
}) {
  const t = translator(language), panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [draft, setDraft] = useState<WorkbenchLocations>(() => ({ enabled: [...locations.enabled], default: locations.default }));
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const order: WorkbenchLocation[] = ['editor', 'sidebar', 'auxiliary', 'panel'];
  const label = (location: WorkbenchLocation) => t(location === 'editor' ? 'workbenchEntry.editorMode' : location === 'sidebar' ? 'workbenchEntry.sidebarMode' : location === 'auxiliary' ? 'workbenchEntry.auxiliaryMode' : 'workbenchEntry.panelMode');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLInputElement>('input')?.focus();
    const key = (event: KeyboardEvent) => {
      const layers = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (layers[layers.length - 1] !== panel.current) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (panel.current?.getAttribute('aria-busy') !== 'true') close.current();
      } else if (event.key === 'Tab') {
        const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)') ?? [])];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, []);
  function toggle(location: WorkbenchLocation) {
    setError(undefined);
    setDraft(current => {
      const enabled = order.filter(item => item === location ? !current.enabled.includes(item) : current.enabled.includes(item));
      return { enabled, default: enabled.includes(current.default) ? current.default : enabled[0] ?? current.default };
    });
  }
  async function apply() {
    if (busy || !draft.enabled.length) return;
    setBusy(true); setError(undefined);
    try { await onApply(draft); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); setBusy(false); }
  }
  return <div className="locations-backdrop">
    <div ref={panel} className="locations-dialog" role="dialog" aria-modal="true" aria-label={t('workbenchEntry.openModeSettings')} aria-busy={busy}>
      <div className="locations-heading"><h2>{t('workbenchEntry.openModeSettings')}</h2><button type="button" title={t('common.close')} aria-label={t('common.close')} disabled={busy} onClick={onClose}>×</button></div>
      <div className="locations-body">
        <p>{t('workbenchEntry.locationsDescription')}</p>
        <div className="locations-checkboxes">{order.map(location => <label key={location}><input type="checkbox" checked={draft.enabled.includes(location)} disabled={busy} onChange={() => toggle(location)}/>{label(location)}</label>)}</div>
        <label className="locations-default">{t('workbenchEntry.defaultLocation')}<select value={draft.enabled.length ? draft.default : ''} disabled={busy || !draft.enabled.length} onChange={event => { setError(undefined); setDraft(current => ({ ...current, default: event.target.value as WorkbenchLocation })); }}>
          {!draft.enabled.length && <option value=""/>}{order.filter(location => draft.enabled.includes(location)).map(location => <option key={location} value={location}>{label(location)}</option>)}
        </select></label>
        <p>{t('workbenchEntry.defaultLocationHelp')}<br/>{t('workbenchEntry.independentLocationsHelp')}</p>
        {!draft.enabled.length && <p className="locations-error" role="alert">{t('workbenchEntry.atLeastOneLocation')}</p>}
        {error && <p className="locations-error" role="alert">{error}</p>}
      </div>
      <div className="locations-footer"><button type="button" disabled={busy} onClick={onClose}>{t('common.cancel')}</button><button type="button" className="locations-primary" disabled={busy || !draft.enabled.length} onClick={() => void apply()}>{t('common.apply')}</button></div>
    </div>
  </div>;
}
