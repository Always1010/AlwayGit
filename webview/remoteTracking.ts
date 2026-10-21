import type { GitRef, Snapshot } from '../src/protocol/types';
import { branchNameConflict } from '../src/protocol/ref-name';

export function remoteNames(snapshot: Pick<Snapshot, 'refs' | 'remotes'>): string[] {
  return snapshot.remotes ?? [...new Set(snapshot.refs.filter(ref => ref.kind === 'remote').map(ref => ref.name.split('/')[0]))];
}

export function remoteParts(ref: GitRef, remotes: readonly string[] = []): { remote: string; branch: string } | undefined {
  const name = ref.fullName.replace(/^refs\/remotes\//, '');
  const remote = [...remotes].sort((a, b) => b.length - a.length).find(value => name.startsWith(`${value}/`));
  return remote ? { remote, branch: name.slice(remote.length + 1) } : undefined;
}

export function refsForRemote(refs: GitRef[], remotes: readonly string[], remote: string): GitRef[] {
  return refs.filter(ref => ref.kind === 'remote' && remoteParts(ref, remotes)?.remote === remote);
}

export function remoteBranchName(ref: GitRef, snapshot: Snapshot): string {
  const name = ref.fullName.replace(/^refs\/remotes\//, '');
  return remoteParts(ref, snapshot.remotes)?.branch ?? name.slice(name.indexOf('/') + 1);
}

export function trackingCandidates(ref: GitRef, snapshot: Snapshot): GitRef[] {
  return snapshot.refs.filter(local => local.kind === 'local' && (local.upstream === ref.name || local.upstream === ref.fullName));
}

export function trackingConflict(ref: GitRef, name: string, snapshot: Snapshot, names: string[]): string | undefined {
  if (!name) return 'name';
  if (names.filter(value => value === name).length > 1) return 'duplicate';
  const collision = snapshot.refs.find(local => local.kind === 'local' && local.name === name);
  if (collision && !trackingCandidates(ref, snapshot).includes(collision)) return 'upstream';
  if (branchNameConflict(name, [...names, ...snapshot.refs.filter(local => local.kind === 'local').map(local => local.name)].filter(other => other !== name))) return 'prefix';
  return undefined;
}
