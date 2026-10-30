import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalCacheEntry } from '../src/protocol/local-cache';
import { useTranslation } from './i18n';
import { rpc } from './rpc';
import { Button, Icon } from './ui';
import './local-cache-settings.css';

type ClearTarget = { kind: 'repositories'; repoIds: string[] } | { kind: 'all' };

export function LocalCacheSettings({ onBusyChange }: { onBusyChange(busy: boolean): void }) {
  const t = useTranslation();
  const [entries, setEntries] = useState<LocalCacheEntry[]>([]), [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>(), [message, setMessage] = useState<string>();
  const [selected, setSelected] = useState<Set<string>>(new Set()), [target, setTarget] = useState<ClearTarget>();
  const [clearing, setClearing] = useState(false);
  const live = useRef(true), confirmation = useRef<HTMLDivElement>(null);
  const describe = (entry: LocalCacheEntry) => entry.name || t('localCache.unknownRepository');
  const load = useCallback(async () => {
    setLoading(true); setError(undefined);
    try {
      const result = await rpc<LocalCacheEntry[]>('localCacheList');
      if (live.current) { setEntries(result); setSelected(current => new Set([...current].filter(id => result.some(entry => entry.repoId === id)))); }
    } catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (live.current) setLoading(false); }
  }, []);
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; }; }, [load]);
  useEffect(() => { if (target) confirmation.current?.focus(); }, [target]);
  const requestClear = (next: ClearTarget) => { setTarget(next); setMessage(undefined); setError(undefined); };
  const clear = async () => {
    if (!target || clearing) return;
    setClearing(true); onBusyChange(true); setError(undefined);
    try {
      const result = await rpc<LocalCacheEntry[]>('localCacheClear', undefined, target);
      if (live.current) { setEntries(result); setSelected(new Set()); setTarget(undefined); setMessage(t('localCache.cleared')); }
    } catch (cause) {
      const clearError = cause instanceof Error ? cause.message : String(cause);
      if (live.current) { setError(clearError); setTarget(undefined); }
      // A batch may have cleared some entries before one persisted write failed.
      try {
        const remaining = await rpc<LocalCacheEntry[]>('localCacheList');
        if (live.current) { setEntries(remaining); setSelected(current => new Set([...current].filter(id => remaining.some(entry => entry.repoId === id)))); }
      } catch (refreshError) {
        if (live.current) setError(`${clearError} ${t('localCache.refreshFailed', { error: refreshError instanceof Error ? refreshError.message : String(refreshError) })}`);
      }
    }
    finally { if (live.current) setClearing(false); onBusyChange(false); }
  };
  const targets = target ? entries.filter(entry => target.kind === 'all' || target.repoIds.includes(entry.repoId)) : [];
  const busy = loading || clearing;
  const allSelected = entries.length > 0 && entries.every(entry => selected.has(entry.repoId));
  return <section className="settings-page local-cache-settings" aria-label={t('localCache.title')}>
    <div className="local-cache-actions">
      <Button className="icon-only" icon="refresh" title={t('localCache.refresh')} aria-label={t('localCache.refresh')} disabled={busy || !!target} onClick={() => void load()}/>
      <Button disabled={busy || !!target || !entries.some(entry => !entry.registered && !entry.registrationUnknown)} onClick={() => setSelected(new Set(entries.filter(entry => !entry.registered && !entry.registrationUnknown).map(entry => entry.repoId)))}>{t('localCache.selectRemoved')}</Button>
      <Button disabled={busy || !!target || !selected.size} onClick={() => requestClear({ kind: 'repositories', repoIds: [...selected] })}>{t('localCache.clearSelected', { count: selected.size })}</Button>
    </div>
    {loading && <p role="status">{t('localCache.loading')}</p>}
    {message && <p role="status" className="local-cache-result"><Icon name="check"/>{message}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {target && <div className="local-cache-confirm" role="group" aria-labelledby="local-cache-confirm-title" tabIndex={-1} ref={confirmation}>
      <h3 id="local-cache-confirm-title">{t(target.kind === 'all' ? 'localCache.confirmAll' : 'localCache.confirmSelected', { count: targets.length })}</h3>
      <p>{t('localCache.irreversible')}</p>
      <ul>{targets.map(entry => <li key={entry.repoId}><strong>{describe(entry)}</strong><span>{entry.root || entry.repoId}</span></li>)}</ul>
      <div className="local-cache-actions"><Button disabled={clearing} onClick={() => setTarget(undefined)}>{t('common.cancel')}</Button><Button className="danger" disabled={clearing} onClick={() => void clear()}>{t(clearing ? 'localCache.clearing' : 'localCache.confirmClear')}</Button></div>
    </div>}
    {!loading && !entries.length && !error && <p className="local-cache-empty">{t('localCache.empty')}</p>}
    {!!entries.length && <div className="local-cache-table-scroll"><table className="local-cache-table">
      <thead><tr><th className="local-cache-select"><input type="checkbox" aria-label={t('localCache.selectAll')} checked={allSelected} disabled={busy || !!target} onChange={event => setSelected(event.target.checked ? new Set(entries.map(entry => entry.repoId)) : new Set())}/></th><th>{t('localCache.repository')}</th><th>{t('localCache.status')}</th><th>{t('localCache.data')}</th><th><span className="sr-only">{t('localCache.actions')}</span></th></tr></thead>
      <tbody>{entries.map(entry => <tr key={entry.repoId}>
        <td className="local-cache-select"><input type="checkbox" aria-label={t('localCache.selectRepository', { name: describe(entry) })} checked={selected.has(entry.repoId)} disabled={busy || !!target} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(entry.repoId); else next.delete(entry.repoId); return next; })}/></td>
        <td className="local-cache-repository" title={entry.root || entry.repoId}><strong>{describe(entry)}</strong>{entry.root && <span>{entry.root}</span>}</td>
        <td><span className={entry.registered ? '' : 'muted'}>{t(entry.registrationUnknown ? 'localCache.registrationUnknown' : entry.registered ? 'localCache.registered' : 'localCache.removed')}</span></td>
        <td>{entry.invalid ? <span className="muted">{t('localCache.invalid')}</span> : <span className="local-cache-count" tabIndex={0} title={t('localCache.directoryDetails', { mode: t(entry.mode === 'expanded' ? 'localCache.expanded' : entry.mode === 'collapsed' ? 'localCache.collapsed' : 'localCache.automatic'), count: entry.directories })} aria-label={t('localCache.directoryDetails', { mode: t(entry.mode === 'expanded' ? 'localCache.expanded' : entry.mode === 'collapsed' ? 'localCache.collapsed' : 'localCache.automatic'), count: entry.directories })}>{t('localCache.directoryCount', { count: entry.directories })}</span>}</td>
        <td><Button className="icon-only" icon="trash" title={t('localCache.clearRepository', { name: describe(entry) })} aria-label={t('localCache.clearRepository', { name: describe(entry) })} disabled={busy || !!target} onClick={() => requestClear({ kind: 'repositories', repoIds: [entry.repoId] })}/></td>
      </tr>)}</tbody>
    </table></div>}
    {!!entries.length && <div className="local-cache-secondary-actions"><Button disabled={busy || !!target} onClick={() => requestClear({ kind: 'all' })}>{t('localCache.clearAll')}</Button></div>}
  </section>;
}
