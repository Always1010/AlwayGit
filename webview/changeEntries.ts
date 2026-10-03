import type { Change } from '../src/protocol/types';

export type ChangeArea = 'conflict' | 'unstaged' | 'staged';
export interface ChangeEntry { file: Change; area: ChangeArea; key: string }
export const changeKey = (area: ChangeArea, path: string) => JSON.stringify([area, path]);
export const isStaged = (file: Change) => !file.conflict && !file.untracked && !!file.indexStatus && file.indexStatus !== ' ' && file.indexStatus !== '?';
export const isUnstaged = (file: Change) => !file.conflict && (file.untracked || !!file.worktreeStatus && file.worktreeStatus !== ' ');
export function compareChangedFiles(a: Change, b: Change): number {
  return a.path.split('/').at(-1)!.localeCompare(b.path.split('/').at(-1)!, 'en', { sensitivity: 'base' }) || a.path.localeCompare(b.path, 'en', { sensitivity: 'base' }) || a.path.localeCompare(b.path, 'en');
}
export function changeEntries(changes: Change[]): ChangeEntry[] {
  return (['conflict', 'unstaged', 'staged'] as const).flatMap(area => changes.filter(area === 'conflict' ? file => file.conflict : area === 'staged' ? isStaged : isUnstaged).sort(compareChangedFiles).map(file => ({ file, area, key: changeKey(area, file.path) })));
}
