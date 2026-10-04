import type { GitRef, RemoteTags, Snapshot } from '../src/protocol/types';

export const tagQueryRetryDelay = 30_000;
export interface TagQuery { requestId?: number; result?: RemoteTags; loading: boolean; attemptedAt: number; error?: string }
export type TagState = 'synced' | 'local' | 'different' | 'unknown';
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
