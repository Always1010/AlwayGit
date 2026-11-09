import { defaultFileSort, type FileSort } from '../src/protocol/file-sort';

type SortableFile = { path: string; status?: string };
const collator = new Intl.Collator('en', { sensitivity: 'base' });
const statusOrder = ['A', 'C', 'D', 'M', 'R', 'T', '?', 'U'];
const name = (path: string) => path.split('/').at(-1)!;
const extension = (path: string) => {
  const basename = name(path),
    dot = basename.lastIndexOf('.');
  return dot > 0 ? basename.slice(dot + 1) : '';
};

export function fileComparator<T extends SortableFile>(
  sort: FileSort = defaultFileSort,
  status: (file: T) => string = (file) => file.status ?? '',
): (a: T, b: T) => number {
  const rank = (file: T) => {
    const index = statusOrder.indexOf(status(file)[0]);
    return index < 0 ? statusOrder.length : index;
  };
  return (a, b) => {
    const primary =
      sort.key === 'path'
        ? collator.compare(a.path, b.path)
        : sort.key === 'extension'
          ? collator.compare(extension(a.path), extension(b.path))
          : sort.key === 'status'
            ? rank(a) - rank(b)
            : 0;
    const result =
      primary ||
      collator.compare(name(a.path), name(b.path)) ||
      collator.compare(a.path, b.path) ||
      a.path.localeCompare(b.path, 'en');
    return sort.direction === 'desc' ? -result : result;
  };
}

export function sortFiles<T extends SortableFile>(files: readonly T[], sort: FileSort): T[] {
  return [...files].sort(fileComparator<T>(sort));
}
