import type { Snapshot } from '../src/protocol/types';
import { tagQueryKey, type TagQuery } from './tagStatus';

export interface TagDeleteLease {
  remote: string; name: string; checked: boolean; expectedDestination?: string; expectedReadDestination?: string; expectedRemoteOid?: string;
}
type TagQueries = Record<string, TagQuery>;

export function captureTagDeleteLease(snapshot: Snapshot, queries: TagQueries, remote: string, name: string, expected?: Pick<TagDeleteLease, 'expectedDestination' | 'expectedRemoteOid'>): TagDeleteLease {
  remote = remote.trim(); name = name.trim();
  const lease = { remote, name, checked: !!expected?.expectedRemoteOid, expectedDestination: expected?.expectedDestination ?? snapshot.remoteDestinations?.[remote],
    expectedReadDestination: snapshot.remoteReadDestinations?.[remote], expectedRemoteOid: expected?.expectedRemoteOid };
  return completeTagDeleteLease(lease, snapshot, queries);
}

/** Only a different selected target starts a new confirmation. */
export function updateTagDeleteLease(previous: TagDeleteLease, snapshot: Snapshot, queries: TagQueries, remote: string, name: string): TagDeleteLease {
  return remote.trim() === previous.remote && name.trim() === previous.name
    ? previous : captureTagDeleteLease(snapshot, queries, remote, name);
}

/** A target opened before its first check may acquire its first OID, never a newer one. */
export function completeTagDeleteLease(lease: TagDeleteLease, snapshot: Snapshot, queries: TagQueries): TagDeleteLease {
  if (lease.checked || lease.expectedDestination !== snapshot.remoteDestinations?.[lease.remote]
    || lease.expectedReadDestination !== snapshot.remoteReadDestinations?.[lease.remote]) return lease;
  const result = queries[tagQueryKey(snapshot, lease.remote)]?.result;
  return result?.remote === lease.remote && result.destination === lease.expectedReadDestination
    ? { ...lease, checked: true, expectedRemoteOid: result.refs[`refs/tags/${lease.name}`] } : lease;
}

export function tagDeleteLeaseProblem(lease: TagDeleteLease, snapshot: Snapshot, queries: TagQueries, remote: string, name: string): 'changed' | 'unchecked' | 'separate' | undefined {
  remote = remote.trim(); name = name.trim();
  if (lease.remote !== remote || lease.name !== name || lease.expectedDestination !== snapshot.remoteDestinations?.[remote]
    || lease.expectedReadDestination !== snapshot.remoteReadDestinations?.[remote]) return 'changed';
  const result = queries[tagQueryKey(snapshot, remote)]?.result;
  if (!remote || !lease.expectedDestination || !lease.expectedReadDestination || !result) return 'unchecked';
  if (result.remote !== remote || result.destination !== lease.expectedReadDestination) return 'changed';
  if (result.separatePush) return 'separate';
  if (!lease.expectedRemoteOid) return 'unchecked';
  return result.refs[`refs/tags/${name}`] === lease.expectedRemoteOid ? undefined : 'changed';
}
