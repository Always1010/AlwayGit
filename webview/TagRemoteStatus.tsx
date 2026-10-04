import { useEffect, useState } from 'react';
import type { GitRef } from '../src/protocol/types';
import { Button, Icon, Modal } from './ui';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { selectedTagRemote, tagListEntries, tagQueryKey, tagState, type TagListEntry } from './tagStatus';

const icons = { synced: 'pass', local: 'device-desktop', remote: 'cloud', different: 'warning', unknown: 'question' } as const;
const labels = { synced: 'tags.synced', local: 'tags.local', remote: 'tags.remote', different: 'tags.different', unknown: 'tags.unknown' } as const;
const hints = { synced: 'tags.syncedHint', local: 'tags.localHint', remote: 'tags.remoteHint', different: 'tags.differentHint' } as const;
export function useTagEntries(localTags: readonly GitRef[]) {
  const snapshot = useWorkbench(state => state.snapshot), preferred = useWorkbench(state => state.tagRemote);
  const remote = selectedTagRemote(snapshot, preferred), key = snapshot && remote ? tagQueryKey(snapshot, remote) : undefined;
  const query = useWorkbench(state => key ? state.tagQueries[key] : undefined);
  return tagListEntries(localTags, remote, query);
}
export function useTagStatus(entry: TagListEntry) {
  const t = useTranslation();
  const snapshot = useWorkbench(state => state.snapshot), preferred = useWorkbench(state => state.tagRemote);
  const remote = selectedTagRemote(snapshot, preferred), key = snapshot && remote ? tagQueryKey(snapshot, remote) : undefined;
  const query = useWorkbench(state => key ? state.tagQueries[key] : undefined);
  const status = entry.local ? tagState(entry.local, remote, query) : entry.state, label = t(labels[status]);
  const result = query?.result, lines = [entry.fullName];
  if (!remote) lines.push(t('tags.noRemote'));
  else if (status === 'unknown') lines.push(t('tags.unknownHint', { remote }));
  else lines.push(t(hints[status], { remote }));
  if (result) lines.push(t('tags.checkedAt', { time: new Date(result.checkedAt).toLocaleString() }));
  if (status === 'different' && result && entry.local?.refOid) lines.push(t('tags.objects', { local: entry.local.refOid.slice(0, 12), remote: result.refs[entry.fullName].slice(0, 12) }));
  if (status === 'remote' && entry.remoteOid) lines.push(t('tags.remoteObject', { oid: entry.remoteOid.slice(0, 12) }));
  if (result?.separatePush) lines.push(t('tags.separatePush'));
  if (query?.loading) lines.push(t('tags.checking'));
  if (query?.error) lines.push(t('tags.failed', { error: query.error }));
  return { status, label, title: lines.join('\n'), icon: icons[status], loading: query?.loading };
}

export function TagStatus({ entry, compact = false }: { entry: TagListEntry; compact?: boolean }) {
  const view = useTagStatus(entry), t = useTranslation(), [open, setOpen] = useState(false);
  const repoId = useWorkbench(state => state.repoId);
  useEffect(() => { setOpen(false); }, [repoId, entry.fullName]);
  const className = `tag-status tag-status-${view.status}${compact ? ' tag-status-compact' : ''}`;
  if (compact) return <span className={className} role="img" aria-label={view.title} title={view.title}><Icon name={view.icon}/></span>;
  return <><button className={className} title={view.title} aria-label={`${entry.name}: ${view.label}`} onClick={() => setOpen(true)}><Icon name={view.icon}/></button>
    {open && <Modal title={`${entry.name} · ${t('tags.details')}`} onClose={() => setOpen(false)} footer={<Button icon={view.loading ? 'loading' : 'refresh'} disabled={view.loading} onClick={() => void useWorkbench.getState().loadTagStatuses(true)}>{t('tags.check')}</Button>}><div className="tag-status-details">{view.title}</div></Modal>}
  </>;
}

export function TagRemoteControls() {
  const snapshot = useWorkbench(state => state.snapshot), preferred = useWorkbench(state => state.tagRemote);
  const collapsed = useWorkbench(state => state.collapsedSidebarGroups.includes('tag'));
  const remote = selectedTagRemote(snapshot, preferred), key = snapshot && remote ? tagQueryKey(snapshot, remote) : undefined;
  const query = useWorkbench(state => key ? state.tagQueries[key] : undefined), t = useTranslation();
  useEffect(() => { if (!collapsed) void useWorkbench.getState().loadTagStatuses(); }, [key, collapsed]);
  return <div className="tag-remote-controls">
    {remote ? snapshot!.remotes!.length > 1 ? <select value={remote} aria-label={t('tags.selectRemote')} title={t('tags.selectRemote')} onChange={event => useWorkbench.getState().setTagRemote(event.target.value)}>{snapshot!.remotes!.map(name => <option key={name}>{name}</option>)}</select> : <span className="truncate" title={remote}>{remote}</span> : <span className="truncate">{t('tags.noRemote')}</span>}
    <Button className="icon-only" icon={query?.loading ? 'loading' : 'refresh'} disabled={!remote || query?.loading} title={query?.loading ? t('tags.checking') : t('tags.check')} aria-label={t('tags.check')} onClick={() => void useWorkbench.getState().loadTagStatuses(true)}/>
  </div>;
}
