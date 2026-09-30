import type { Change, DiffTarget, RepositoryChanges, Snapshot } from '../src/protocol/types';

export function diffKey(target?: DiffTarget): string {
  if (!target) return '';
  if (target.kind === 'commit') return JSON.stringify([target.kind, target.oid, target.parent, target.path, target.previousPath]);
  if (target.kind === 'comparison') return JSON.stringify([target.kind, target.left, target.right, target.path, target.previousPath]);
  return JSON.stringify([target.kind, target.area, target.path]);
}

export function mergeChanges(a?: RepositoryChanges, b?: RepositoryChanges): RepositoryChanges | undefined {
  if (!a?.paths || !b?.paths) return undefined;
  return { paths: [...new Set([...a.paths, ...b.paths])], index: !!(a.index || b.index) };
}

export function historyKey(snapshot: Snapshot, refs: string[]): string {
  return JSON.stringify(refs.map(name => [name, name === 'HEAD' ? snapshot.head : snapshot.refs.find(ref => ref.fullName === name)?.oid]));
}

export function hasArea(change: Change, area: Extract<DiffTarget, { kind: 'change' }>['area']): boolean {
  if (area === 'conflict') return change.conflict;
  if (change.conflict) return false;
  return area === 'staged' ? change.indexStatus !== ' ' && !change.untracked : change.worktreeStatus !== ' ' || change.untracked;
}

export function workingTarget(snapshot: Snapshot, current?: DiffTarget, selectedFile?: string): DiffTarget | undefined {
  const change = snapshot.changes.find(file => file.path === selectedFile) ?? snapshot.changes[0];
  if (!change) return undefined;
  const area = current?.kind === 'change' && current.path === change.path && hasArea(change, current.area)
    ? current.area : change.conflict ? 'conflict' : change.worktreeStatus !== ' ' || change.untracked ? 'unstaged' : 'staged';
  return { kind: 'change', path: change.path, area };
}

export function affectsWorkingDiff(before: Snapshot | undefined, after: Snapshot, target: DiffTarget, changes?: RepositoryChanges): boolean {
  if (target.kind !== 'change') return false;
  if (!before || !changes?.paths || changes.index) return true;
  const oldFile = before.changes.find(file => file.path === target.path), file = after.changes.find(file => file.path === target.path);
  if (JSON.stringify(oldFile) !== JSON.stringify(file) || target.area === 'staged' && before.head !== after.head) return true;
  if (target.area !== 'unstaged') return false;
  const normalize = (value: string) => /^[A-Za-z]:[\\/]/.test(after.repository.root) ? value.replace(/\\/g, '/').toLowerCase() : value;
  const names = [target.path, file?.originalPath].filter((name): name is string => !!name).map(normalize);
  return changes.paths.some(path => names.some(name => name === normalize(path) || name.startsWith(normalize(path) + '/')));
}
