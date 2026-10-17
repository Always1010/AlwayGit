import { useCallback, useEffect, useRef, useState } from 'react';
import type { Repository, WorktreeOverviewEntry } from '../src/protocol/types';
import type { TerminalSession } from '../src/protocol/terminal';
import { useTranslation } from './i18n';
import { rpc, subscribe } from './rpc';
import { Button, Icon } from './ui';
import { useDock } from './dock-store';
import { useWorkbench } from './store';
import './worktree-overview.css';

export function WorktreeOverview({ repository, close, terminalOpened }: { repository: Repository; close(): void; terminalOpened(): void }) {
  const t = useTranslation(), [entries, setEntries] = useState<WorktreeOverviewEntry[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const stateLabels = { ready: t('overview.ready'), pending: t('overview.pending'), missing: t('overview.missing'), error: t('overview.error'), bare: t('overview.bare') };
  const operationLabels = { merge: t('overview.merge'), rebase: t('overview.rebase'), 'cherry-pick': t('overview.cherryPick'), revert: t('overview.revert'), sequencer: t('overview.sequencer') };
  const actionLabels = { select: t('overview.select'), project: t('overview.project'), terminal: t('overview.terminal') };
  const [revision, setRevision] = useState(0), pending = useRef(new Set<string>());
  const entriesRef = useRef(entries); entriesRef.current = entries;
  const refresh = useCallback(() => { pending.current.clear(); setRevision(value => value + 1); }, []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError('');
    void (async () => {
      const paths = [...pending.current]; pending.current.clear();
      const inventory = paths.length ? undefined : await rpc<WorktreeOverviewEntry[]>('worktreeOverview', repository.id, {}, { signal: abort.signal });
      if (abort.signal.aborted) return;
      if (inventory) setEntries(inventory);
      const targets = paths.length ? paths : inventory!.filter(entry => !entry.bare).map(entry => entry.path);
      for (let index = 0; index < targets.length; index += 3) {
        const result = await rpc<WorktreeOverviewEntry[]>('worktreeOverview', repository.id, { paths: targets.slice(index, index + 3) }, { signal: abort.signal });
        if (abort.signal.aborted) return;
        setEntries(previous => previous.map(entry => result.find(update => update.path === entry.path) ?? entry));
      }
    })().catch(error => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : String(error)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [repository.id, revision]);
  useEffect(() => subscribe(event => {
    if (event.type !== 'changed') return;
    const member = useWorkbench.getState().repositories.find(repo => repo.id === event.repoId);
    if (event.repoId !== repository.id && member?.commonDir !== repository.commonDir) return;
    // File/index events invalidate only the affected worktree; structural changes reread inventory.
    if (event.changes && member && entriesRef.current.length && !entriesRef.current.some(entry => entry.state === 'pending')) pending.current.add(member.root); else pending.current.clear();
    setRevision(value => value + 1);
  }), [repository.id, repository.commonDir]);
  const action = async (entry: WorktreeOverviewEntry, kind: 'select' | 'project' | 'terminal') => {
    try {
      const result = await rpc<TerminalSession | undefined>('openWorktree', repository.id, { path: entry.path, newWindow: false, ...(kind !== 'select' ? { action: kind } : {}) });
      if (kind === 'terminal' && result) { await useDock.getState().load(); useDock.setState(state => ({ sessions: [...state.sessions.filter(session => session.id !== result.id), result], activeId: result.id })); terminalOpened(); }
      if (kind === 'select') close();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  return <section className="worktree-overview" aria-label={t('overview.title')}>
    <header><Icon name="list-tree"/><h2>{t('overview.title')}</h2><span className="toolbar-spacer"/>{loading && <span role="status">{t('overview.loading')}</span>}<Button icon="refresh" title={t('overview.refresh')} aria-label={t('overview.refresh')} onClick={refresh}/><Button icon="close" title={t('overview.close')} aria-label={t('overview.close')} onClick={close}/></header>
    <p className="muted overview-note">{t('overview.note')}</p>
    {error && <p className="warning-text" role="alert">{error}</p>}
    <div className="overview-scroll"><div className="overview-grid overview-columns" aria-hidden="true"><span>{t('overview.worktree')}</span><span>{t('overview.head')}</span><span>{t('overview.changes')}</span><span>{t('overview.upstream')}</span><span>{t('overview.state')}</span><span>{t('overview.actions')}</span></div>
      {entries.map(entry => <article key={entry.path} className="overview-grid overview-row" aria-label={entry.path}>
        <div className="overview-path"><strong>{entry.path.replace(/\\/g, '/').split('/').at(-1)}</strong><small>{entry.path}</small></div>
        <div><strong>{entry.branch || (entry.bare ? t('overview.bare') : t('sidebar.detachedHEAD'))}</strong><small className="hash">{entry.head.slice(0, 8) || '—'}</small></div>
        <div>{entry.state === 'ready' ? <><span>{t('overview.staged')}: {entry.staged}</span><span>{t('overview.unstaged')}: {entry.unstaged}</span><span>{t('overview.untracked')}: {entry.untracked}</span><span className={entry.conflicts ? 'warning-text' : ''}>{t('overview.conflicts')}: {entry.conflicts}</span></> : '—'}</div>
        <div>{entry.upstream ? <><span>{entry.upstream}</span><small>↑ {entry.ahead} ↓ {entry.behind}</small></> : '—'}</div>
        <div><span>{stateLabels[entry.state]}</span>{entry.operation && <span>{operationLabels[entry.operation]}</span>}{entry.locked && <span title={entry.locked}><Icon name="lock"/>{t('overview.locked')}</span>}{entry.prunable && <span title={entry.prunable}>{t('overview.prunable')}</span>}{entry.error && <small className="warning-text">{entry.error}</small>}{entry.refreshedAt && <small title={t('overview.refreshed')}>{new Date(entry.refreshedAt).toLocaleTimeString()}</small>}</div>
        <div className="overview-actions">{(['select', 'project', 'terminal'] as const).map(kind => <Button key={kind} icon={kind === 'select' ? 'go-to-file' : kind === 'project' ? 'window' : 'terminal'} disabled={entry.bare || entry.state === 'missing' || entry.state === 'error' || entry.state === 'pending'} title={actionLabels[kind]} aria-label={`${actionLabels[kind]}: ${entry.path}`} onClick={() => void action(entry, kind)}/>)}</div>
      </article>)}
    </div>
  </section>;
}
