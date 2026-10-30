import { useState } from 'react';
import type { TreeExpansionMode, TreeExpansionPreferences } from '../src/protocol/tree-expansion';
import { useTranslation } from './i18n';
import { Button, Icon } from './ui';
import './tree-expansion-memory.css';

export function TreeExpansionMemory({ preferences, directories, indexed, loading, error, reload, remove, setMode, reset }: {
  preferences: TreeExpansionPreferences; directories: Set<string>; indexed: boolean; loading: boolean; error?: string;
  reload(): void; remove(path: string): void; setMode(mode: TreeExpansionMode): void; reset(): void;
}) {
  const t = useTranslation(), [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const entries = Object.entries(preferences.overrides).filter(([path]) => path.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort(([left], [right]) => left.localeCompare(right));
  return <>
    <Button className="icon-only" icon="history" title={t('treeMemory.manage')} aria-label={t('treeMemory.manage')} aria-expanded={open} onClick={() => setOpen(value => !value)}/>
    {error && <span className="tree-memory-error" role="alert">{t('treeMemory.unavailable')} {error}<Button className="icon-only" icon="refresh" title={t('tree.retry')} aria-label={t('tree.retry')} disabled={loading} onClick={reload}/></span>}
    {open && <section className="tree-memory-panel" aria-label={t('treeMemory.manage')}>
      <div className="tree-memory-heading"><strong>{t('treeMemory.manage')}</strong><Button className="icon-only" icon="clear-all" title={t('treeMemory.clear')} aria-label={t('treeMemory.clear')} onClick={reset}/><Button className="icon-only" icon="close" title={t('treeMemory.close')} aria-label={t('treeMemory.close')} onClick={() => setOpen(false)}/></div>
      <p className="muted">{t('treeMemory.scope')}</p>
      <label className="tree-memory-mode">{t('treeMemory.mode')}<select aria-label={t('treeMemory.mode')} value={preferences.mode} onChange={event => setMode(event.target.value as TreeExpansionMode)}>
        <option value="auto">{t('treeMemory.auto')}</option><option value="expanded">{t('treeMemory.expanded')}</option><option value="collapsed">{t('treeMemory.collapsed')}</option>
      </select></label>
      <label className="file-path-filter"><Icon name="search"/><input type="search" value={query} aria-label={t('treeMemory.search')} placeholder={t('treeMemory.search')} onChange={event => setQuery(event.target.value)}/></label>
      {loading && <span role="status">{t('treeMemory.loading')}</span>}
      <ul className="tree-memory-list">{entries.map(([path, expanded]) => <li key={path}>
        <span className="tree-memory-path" title={path}>{path}</span><span>{t(expanded ? 'treeMemory.expanded' : 'treeMemory.collapsed')}</span>
        {!directories.has(path) && <span className="muted">{t(indexed ? 'treeMemory.absent' : 'treeMemory.unchecked')}</span>}
        <Button className="icon-only" icon="trash" title={t('treeMemory.remove', { path })} aria-label={t('treeMemory.remove', { path })} onClick={() => remove(path)}/>
      </li>)}</ul>
      {!entries.length && <p className="muted">{t(query ? 'treeMemory.noMatches' : 'treeMemory.empty')}</p>}
    </section>}
  </>;
}
