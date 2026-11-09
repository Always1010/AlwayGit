import type { Change } from '../src/protocol/types';
import { defaultFileSort, type FileSort } from '../src/protocol/file-sort';
import { fileComparator } from './fileSort';

export type ChangeArea = 'conflict' | 'unstaged' | 'staged';
export interface ChangeEntry {
  file: Change;
  area: ChangeArea;
  key: string;
}
export const changeKey = (area: ChangeArea, path: string) => JSON.stringify([area, path]);
export const isStaged = (file: Change) =>
  !file.conflict &&
  !file.untracked &&
  !!file.indexStatus &&
  file.indexStatus !== ' ' &&
  file.indexStatus !== '?';
export const isUnstaged = (file: Change) =>
  !file.conflict && (file.untracked || (!!file.worktreeStatus && file.worktreeStatus !== ' '));
export function compareChangedFiles(a: Change, b: Change): number {
  return fileComparator<Change>()(a, b);
}
export function changeComparator(area: ChangeArea, sort: FileSort) {
  return fileComparator<Change>(sort, (file) =>
    area === 'conflict'
      ? 'U'
      : area === 'staged'
        ? file.indexStatus
        : file.untracked
          ? '?'
          : file.worktreeStatus,
  );
}
export function changeEntries(changes: Change[], sort: FileSort = defaultFileSort): ChangeEntry[] {
  return (['conflict', 'unstaged', 'staged'] as const).flatMap((area) =>
    changes
      .filter(
        area === 'conflict' ? (file) => file.conflict : area === 'staged' ? isStaged : isUnstaged,
      )
      .sort(changeComparator(area, sort))
      .map((file) => ({ file, area, key: changeKey(area, file.path) })),
  );
}
