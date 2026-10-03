import { useWorkbenchFields, useSnapshotFields } from './subscriptions';
import { useTranslation } from './i18n';
import { Button, Icon } from './ui';
import { useMemo } from 'react';

/** Actual checkout, displayed history and detail selection are separate locations. */
export function HistoryLocation() {
  const state = useWorkbenchFields('displayedHistory', 'checkedRefs', 'search', 'historyLoading', 'historyError', 'loadHistory', 'locatingOid', 'selectedOid', 'selectedOids', 'selectedStashOid', 'tab', 'commits', 'hasMore', 'detailsLoading', 'historyBackDepth', 'backHistory', 'resetHistory', 'busy');
  const snapshot = useSnapshotFields('repository', 'branch', 'head', 'refs', 'changes'), t = useTranslation();
  const refByName = useMemo(() => new Map(snapshot?.refs.map(ref => [ref.fullName, ref])), [snapshot?.refs]);
  if (!snapshot) return null;
  const describe = (refs: readonly string[]) => refs.map(name => {
    const ref = refByName.get(name);
    return ref ? t(ref.kind === 'tag' ? 'history.locationTag' : ref.kind === 'remote' ? 'history.locationRemote' : 'history.locationBranch', { name: ref.name }) : name;
  }).join(' · ') || t('history.locationNoRefs');
  const summarize = (refs: readonly string[]) => describe(refs.slice(0, 2)) + (refs.length > 2 ? ` · ${t('history.locationOtherRefs', { count: refs.length - 2 })}` : '');
  const requested = summarize(state.checkedRefs ?? []), displayed = state.displayedHistory;
  const scope = displayed ? summarize(displayed.refs) : t('history.locationNotLoaded');
  const selection = state.tab === 'changes' ? t('history.locationWorking') : state.selectedStashOid ? t('history.locationStash', { oid: state.selectedStashOid.slice(0, 12) }) : state.selectedOids.length > 1 ? t('history.locationSelection', { count: state.selectedOids.length }) : state.selectedOid ? t('history.locationCommit', { oid: state.selectedOid.slice(0, 12) }) : t('history.locationNoSelection');
  return <div className="history-location" data-testid="history-location">
    <div className="history-location-actions"><Button icon="arrow-left" className="icon-only" title={t('history.locationBack')} aria-label={t('history.locationBack')} disabled={!state.historyBackDepth || state.busy} onClick={state.backHistory}/><Button icon="home" className="icon-only" title={t(snapshot.branch ? 'history.locationReset' : 'history.locationResetHead')} aria-label={t(snapshot.branch ? 'history.locationReset' : 'history.locationResetHead')} disabled={!snapshot.head || state.busy} onClick={state.resetHistory}/></div>
    <div className="history-location-line"><span title={snapshot.repository.root}>{t('history.locationRepository', { name: snapshot.repository.name })}</span><strong>{t('history.locationCheckout', { branch: snapshot.branch || t('history.detachedHEAD'), oid: snapshot.head?.slice(0, 12) || '—' })}</strong></div>
    <div className="history-location-scope"><span>{t('history.locationScope', { scope })}</span>{displayed?.search && <span>{t('history.locationSearch', { search: displayed.search })}</span>}</div>
    {displayed && displayed.refs.length > 2 && <details className="history-location-refs"><summary>{t('history.locationAllRefs', { count: displayed.refs.length })}</summary><div>{describe(displayed.refs)}</div></details>}
    <div className="history-location-line"><span>{t('history.locationViewing', { selection })}{state.detailsLoading && ` · ${t('history.locationDetailsLoading')}`}</span><span>{t('history.locationChanges', { count: snapshot.changes.length })}</span></div>
    {displayed && !state.historyLoading && snapshot.head && !state.commits.some(commit => commit.oid === snapshot.head) && <div className="muted">{t('history.locationHeadNotShown')}</div>}
    <div className="history-read-status" role="status" aria-live="polite">
      {state.historyLoading ? <><Icon name="loading" className="feedback-spinner"/>{t(state.locatingOid ? 'history.locationLocating' : 'history.locationLoading', { scope: requested, oid: state.locatingOid?.slice(0, 12) ?? '—' })}{state.search && ` · ${t('history.locationSearch', { search: state.search })}`}</> : state.historyError ? <><Icon name="warning"/>{t('history.locationFailed', { scope: requested, error: state.historyError })}<Button icon="refresh" className="icon-only" title={t('history.locationRetry')} aria-label={t('history.locationRetry')} onClick={() => void state.loadHistory()}/></> : displayed ? t('history.locationLoaded', { count: state.commits.length, more: state.hasMore ? t('history.locationMore') : t('history.locationComplete') }) : null}
    </div>
  </div>;
}
