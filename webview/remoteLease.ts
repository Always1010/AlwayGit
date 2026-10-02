import type { Snapshot } from '../src/protocol/types';

/** Call when opening or selecting a target, never when submitting a stale dialog. */
export function captureRemoteLease(snapshot: Snapshot, remote: string, remoteBranch: string) {
  remote = remote.trim(); remoteBranch = remoteBranch.trim();
  const ref = snapshot.refs.find(item => item.fullName === `refs/remotes/${remote}/${remoteBranch}`);
  return { remote, remoteBranch, expectedOid: ref?.oid ?? '', expectedDestination: snapshot.remoteDestinations?.[remote] };
}

export function updateRemoteLease(previous: ReturnType<typeof captureRemoteLease>, snapshot: Snapshot, remote: string, remoteBranch: string) {
  return remote.trim() === previous.remote && remoteBranch.trim() === previous.remoteBranch
    ? previous : captureRemoteLease(snapshot, remote, remoteBranch);
}
