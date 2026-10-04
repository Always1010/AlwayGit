import type { GitRef, RemoteTags, Snapshot } from '../src/protocol/types';

export const tagQueryRetryDelay = 30_000;
export interface TagQuery { requestId?: number; result?: RemoteTags; loading: boolean; attemptedAt: number; error?: string }
export type TagState = 'synced' | 'local' | 'remote' | 'different' | 'unknown';
export interface TagListEntry { name: string; fullName: string; local?: GitRef; remoteOid?: string; state: TagState }
export function selectedTagRemote(snapshot: Snapshot | undefined, preferred?: string): string | undefined {
  const remotes = snapshot?.remotes ?? [];
  return [preferred, snapshot?.pushTarget?.remote, 'origin', remotes[0]].find(value => value !== undefined && remotes.includes(value));
}
export function tagQueryKey(snapshot: Snapshot, remote: string): string {
  return JSON.stringify([snapshot.repository.id, remote, snapshot.remoteReadDestinations?.[remote], snapshot.remoteDestinations?.[remote]]);
}
export function tagState(ref: GitRef, remote: string | undefined, query: TagQuery | undefined): TagState {
  if (!remote) return 'local';
  if (!query?.result || !ref.refOid) return 'unknown';
  const oid = query.result.refs[ref.fullName];
  return oid === undefined ? 'local' : oid === ref.refOid ? 'synced' : 'different';
}

export function tagListEntries(localTags: readonly GitRef[], remote: string | undefined, query: TagQuery | undefined): TagListEntry[] {
  const entries = new Map<string, TagListEntry>(localTags.map(local => [local.fullName, { name: local.name, fullName: local.fullName, local, remoteOid: query?.result?.refs[local.fullName], state: tagState(local, remote, query) }]));
  if (remote && query?.result) {
    for (const [fullName, remoteOid] of Object.entries(query.result.refs)) {
      if (!fullName.startsWith('refs/tags/') || entries.has(fullName)) continue;
      entries.set(fullName, { name: fullName.slice('refs/tags/'.length), fullName, remoteOid, state: 'remote' });
    }
  }
  return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
}
