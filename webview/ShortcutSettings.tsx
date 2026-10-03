import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { Button } from './ui';
import { rpc } from './rpc';
import { defaultBindings, bindingConflicts, bindingFromEvent, bindingLabel, bindingsOverlap, effectiveBindings, reservedBinding, shortcutCommands, singleKey, type ShortcutBinding, type ShortcutOverrides, type WorkbenchShortcut } from './shortcutKeys';
import { shortcutCategories, shortcutCategoryLabels, shortcutDefinitions, type ShortcutCategory } from './shortcutDefinitions';

interface Recording { command: WorkbenchShortcut; index?: number; candidate?: ShortcutBinding; reserved?: boolean; reset?: boolean }
export function ShortcutSettings({ onRecordingChange }: { onRecordingChange(recording: boolean): void }) {
  const listMode = useWorkbench(state => state.changeListMode);
  const singleKeys = useWorkbench(state => state.singleKeyShortcuts), overrides = useWorkbench(state => state.shortcutOverrides);
  const preview = useWorkbench(state => state.previewSettings), t = useTranslation();
  const [query, setQuery] = useState(''), [category, setCategory] = useState<ShortcutCategory | ''>(''), [modifiedOnly, setModifiedOnly] = useState(false);
  const [recording, setRecording] = useState<Recording>(), [hostError, setHostError] = useState<string>();
  const field = useRef<HTMLInputElement>(null), recorderPanel = useRef<HTMLDivElement>(null), startButton = useRef<HTMLElement | null>(null);
  const update = (value: ShortcutOverrides) => preview({ shortcutOverrides: value });
  const cancel = () => setRecording(undefined);
  useEffect(() => { onRecordingChange(!!recording); return () => onRecordingChange(false); }, [!!recording, onRecordingChange]);
  useLayoutEffect(() => {
    if (recording) (field.current ?? recorderPanel.current?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
    else startButton.current?.focus();
  }, [recording?.command, recording?.index, recording?.reset]);
  useEffect(() => {
    if (!recording) return;
    let composing = false;
    const start = () => { composing = true; }, end = () => { composing = false; };
    const key = (event: KeyboardEvent) => {
      if (composing || event.isComposing || event.keyCode === 229 || event.repeat) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); return; }
      if (recording.reset || event.target !== field.current || event.key === 'Tab') return;
      event.preventDefault(); event.stopImmediatePropagation();
      const candidate = bindingFromEvent(event, true);
      if (candidate) setRecording(current => current && { ...current, candidate, reserved: reservedBinding(candidate) });
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('compositionstart', start, true); window.addEventListener('compositionend', end, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('compositionstart', start, true); window.removeEventListener('compositionend', end, true); };
  }, [!!recording]);
  const begin = (command: WorkbenchShortcut, index?: number) => {
    startButton.current = document.activeElement as HTMLElement;
    setRecording({ command, index });
  };
  const desired = recording?.reset ? defaultBindings(recording.command) : recording?.candidate ? [recording.candidate] : [];
  const conflicts = [...new Set(desired.flatMap(binding => bindingConflicts(binding, overrides, recording?.command)))];
  const duplicate = !recording?.reset && !!recording?.candidate && effectiveBindings(recording.command, overrides).some((binding, index) => index !== recording.index && bindingsOverlap(binding, recording.candidate!));
  const confirm = (move = false) => {
    if (!recording || !desired.length || recording.reserved || duplicate || conflicts.length && !move) return;
    const next = { ...overrides };
    if (recording.reset) delete next[recording.command];
    else {
      const bindings = [...effectiveBindings(recording.command, next)];
      if (recording.index === undefined) bindings.push(recording.candidate!); else bindings[recording.index] = recording.candidate!;
      if (bindings.length > 2) return;
      next[recording.command] = bindings;
    }
    if (move) for (const command of conflicts) next[command] = effectiveBindings(command, next).filter(binding => !desired.some(candidate => bindingsOverlap(binding, candidate)));
    update(next); cancel();
  };
  const reset = (command: WorkbenchShortcut) => {
    startButton.current = document.activeElement as HTMLElement;
    const next = { ...overrides }; delete next[command];
    if (defaultBindings(command).some(binding => bindingConflicts(binding, next, command).length)) setRecording({ command, reset: true });
    else update(next);
  };
  const rows = shortcutCommands.filter(command => {
    const definition = shortcutDefinitions[command];
    const text = [t(definition.label), ...effectiveBindings(command, overrides).map(bindingLabel)].join(' ').toLocaleLowerCase();
    return (!category || definition.category === category) && (!modifiedOnly || Object.hasOwn(overrides, command)) && text.includes(query.trim().toLocaleLowerCase());
  });
  return <section className="settings-page shortcut-settings" aria-labelledby="keyboard-heading">
    <h3 id="keyboard-heading">{t('settings.keyboardShortcuts')}</h3>
    <label className="form-checkbox"><input type="checkbox" aria-label={t('settings.enableSingleKeyShortcuts')} checked={singleKeys} onChange={event => preview({ singleKeyShortcuts: event.target.checked })}/>{t('settings.enableSingleKeyShortcuts')}</label>
    <p className="settings-page-copy">{t('settings.enabledByDefaultShortcutsWorkThroughoutTheFocusedWorkbench')}</p>
    <p className="settings-note">{t('settings.shortcutSaveHint')}</p>
    <div className="shortcut-filters">
      <input type="search" aria-label={t('settings.shortcutSearch')} placeholder={t('settings.shortcutSearch')} value={query} onChange={event => setQuery(event.target.value)}/>
      <select aria-label={t('settings.shortcutCategory')} value={category} onChange={event => setCategory(event.target.value as ShortcutCategory | '')}><option value="">{t('settings.shortcutAllCategories')}</option>{shortcutCategories.map(value => <option key={value} value={value}>{t(shortcutCategoryLabels[value])}</option>)}</select>
      <label className="form-checkbox"><input type="checkbox" checked={modifiedOnly} onChange={event => setModifiedOnly(event.target.checked)}/>{t('settings.shortcutModifiedOnly')}</label>
      <Button className="icon-only" icon="discard" title={t('settings.shortcutResetAll')} aria-label={t('settings.shortcutResetAll')} disabled={!!recording || !Object.keys(overrides).length} onClick={() => update({})}/>
    </div>
    {recording && <div ref={recorderPanel} className="shortcut-recorder" role="group" aria-label={t('settings.shortcutRecord', { action: t(shortcutDefinitions[recording.command].label) })}>
      {!recording.reset && <><label htmlFor="shortcut-recording">{t('settings.shortcutRecord', { action: t(shortcutDefinitions[recording.command].label) })}</label>
      <input id="shortcut-recording" ref={field} readOnly value={recording.candidate ? bindingLabel(recording.candidate) : ''} placeholder={t('settings.shortcutRecord', { action: t(shortcutDefinitions[recording.command].label) })} aria-describedby="shortcut-recording-hint"/>
      <p id="shortcut-recording-hint" className="settings-note">{t('settings.shortcutRecordHint')}</p></>}{recording.reset && <p>{t('settings.shortcutReset', { action: t(shortcutDefinitions[recording.command].label) })}</p>}
      {recording.reserved ? <p role="alert" className="form-error">{t('settings.shortcutReserved')}</p> : duplicate ? <p role="alert" className="form-error">{t('settings.shortcutDuplicate')}</p> : conflicts.length > 0 && <p role="alert" className="form-error">{t('settings.shortcutConflict', { actions: conflicts.map(command => t(shortcutDefinitions[command].label)).join(', ') })}</p>}
      {recording.candidate && (!singleKey(recording.candidate) || recording.candidate.key.length > 1) && <p className="settings-note">{t('settings.shortcutExternalWarning')}</p>}
      <div className="inline-actions"><Button icon="check" disabled={!desired.length || recording.reserved || duplicate || !!conflicts.length} onClick={() => confirm()}>{recording.reset ? t('settings.shortcutReset', { action: t(shortcutDefinitions[recording.command].label) }) : t('settings.shortcutConfirm')}</Button>{!recording.reserved && !duplicate && conflicts.length > 0 && <Button icon="arrow-right" onClick={() => confirm(true)}>{t('settings.shortcutMove')}</Button>}<Button onClick={cancel}>{t('common.cancel')}</Button></div>
    </div>}
    <div className="shortcut-table-wrap"><table className="shortcut-table"><thead><tr><th>{t('settings.shortcutAction')}</th><th>{t('settings.shortcutBinding')}</th><th>{t('settings.shortcutScope')}</th><th><span className="sr-only">{t('settings.shortcutAction')}</span></th></tr></thead><tbody>{rows.map(command => {
      const definition = shortcutDefinitions[command], action = t(definition.label), bindings = effectiveBindings(command, overrides), modified = Object.hasOwn(overrides, command);
      return <tr key={command} data-shortcut-command={command}><th scope="row">{action}{modified && <small className="shortcut-status">{t('settings.shortcutModified')}</small>}</th><td><div className="shortcut-bindings">{bindings.length ? bindings.map((binding, index) => <div className="shortcut-binding" key={index}><Button className="shortcut-key" title={t('settings.shortcutEdit', { action })} aria-label={t('settings.shortcutEdit', { action })} disabled={!!recording} onClick={() => begin(command, index)}><kbd>{bindingLabel(binding)}</kbd>{!singleKeys && singleKey(binding) && <span className="shortcut-status">{t('settings.shortcutPaused')}</span>}</Button><Button className="icon-only shortcut-remove" icon="close" title={t('settings.shortcutRemove', { action, binding: bindingLabel(binding) })} aria-label={t('settings.shortcutRemove', { action, binding: bindingLabel(binding) })} disabled={!!recording} onClick={() => update({ ...overrides, [command]: bindings.filter((_, candidate) => candidate !== index) })}/></div>) : <span className="muted">{t('settings.shortcutDisabled')}</span>}</div></td><td className="shortcut-scope">{t(listMode === 'unified' && (command === 'stageAll' || command === 'unstageAll') ? 'settings.shortcutWorkbenchScope' : definition.scope)}</td><td><div className="inline-actions">
        <Button className="icon-only" icon="add" title={t('settings.shortcutAdd', { action })} aria-label={t('settings.shortcutAdd', { action })} disabled={!!recording || bindings.length >= 2} onClick={() => begin(command)}/>
        <Button className="icon-only" icon="circle-slash" title={t('settings.shortcutDisable', { action })} aria-label={t('settings.shortcutDisable', { action })} disabled={!!recording || !bindings.length} onClick={() => update({ ...overrides, [command]: [] })}/>
        <Button className="icon-only" icon="discard" title={t('settings.shortcutReset', { action })} aria-label={t('settings.shortcutReset', { action })} disabled={!!recording || !modified} onClick={() => reset(command)}/>
      </div></td></tr>;
    })}</tbody></table>{!rows.length && <p className="settings-note">{t('settings.shortcutEmpty')}</p>}</div>
    <p className="settings-note">{t('settings.hoverOverAnActionToSeeItsKeyHelp')}</p>
    <section className="settings-section"><h3>{t('settings.shortcutHostTitle')}</h3><p className="settings-note">{t('settings.shortcutHostNote')}</p><Button icon="link-external" onClick={() => { setHostError(undefined); void rpc('openKeyboardShortcuts').catch(error => setHostError(error instanceof Error ? error.message : String(error))); }}>{t('settings.shortcutOpenHost')}</Button>{hostError && <p role="alert" className="form-error">{hostError}</p>}</section>
  </section>;
}
