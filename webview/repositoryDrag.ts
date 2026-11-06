import type { RepositoryRow, ReorderRepository } from '../src/protocol/types';

export interface RepositoryDrag {
  key: string;
  collectionId: string | null;
  rows: RepositoryRow[];
}
export type RepositoryDropSurface =
  | { kind: 'root' }
  | { kind: 'collection'; collectionId: string }
  | { kind: 'entry'; key: string; collectionId: string | null; ratio: number };
export type RepositoryDrop =
  { kind: 'move'; collectionId: string | null } | { kind: 'reorder'; payload: ReorderRepository };

/** Keep group entry, insertion edges, and root removal distinct before submitting any mutation. */
export function repositoryDrop(
  source: RepositoryDrag,
  target: RepositoryDropSurface,
): RepositoryDrop | undefined {
  const move = (collectionId: string | null): RepositoryDrop | undefined =>
    source.rows.length && source.rows.some((row) => row.collectionId !== collectionId)
      ? { kind: 'move', collectionId }
      : undefined;
  if (target.kind === 'root') return move(null);
  if (target.kind === 'collection') return move(target.collectionId);
  if (
    source.rows.length &&
    target.key.startsWith('collection:') &&
    target.ratio >= 0.25 &&
    target.ratio <= 0.75
  )
    return move(target.key.slice(11));
  if (
    source.collectionId === target.collectionId &&
    source.rows.length <= 1 &&
    source.key !== target.key
  )
    return {
      kind: 'reorder',
      payload: {
        key: source.key,
        targetKey: target.key,
        collectionId: target.collectionId ?? undefined,
        position: target.ratio < 0.5 ? 'before' : 'after',
      },
    };
  if (target.key.startsWith('repository:') && target.collectionId !== null)
    return move(target.collectionId);
  return undefined;
}
