import type { GitRef, Snapshot } from '../src/protocol/types';

export function remoteBranchName(ref: GitRef, snapshot: Snapshot): string {
  const name = ref.fullName.replace(/^refs\/remotes\//, '');
  const remote = [...(snapshot.remotes ?? [])].sort((a, b) => b.length - a.length).find(value => name.startsWith(`${value}/`));
  return name.slice((remote?.length ?? name.indexOf('/')) + 1);
}

export function trackingCandidates(ref: GitRef, snapshot: Snapshot): GitRef[] {
  return snapshot.refs.filter(local => local.kind === 'local' && (local.upstream === ref.name || local.upstream === ref.fullName));
}

export function trackingConflict(ref: GitRef, name: string, snapshot: Snapshot, names: string[]): string | undefined {
  if (!name) return 'name';
  if (names.filter(value => value === name).length > 1) return 'duplicate';
  const collision = snapshot.refs.find(local => local.kind === 'local' && local.name === name);
  if (collision && !trackingCandidates(ref, snapshot).includes(collision)) return 'upstream';
  if ([...names, ...snapshot.refs.filter(local => local.kind === 'local').map(local => local.name)].some(other => other !== name && (other.startsWith(`${name}/`) || name.startsWith(`${other}/`)))) return 'prefix';
  return undefined;
}
