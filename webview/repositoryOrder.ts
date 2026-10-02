import type { RepositoryCollection } from '../src/protocol/types';
import type { RepositoryGroup } from '../src/protocol/repositories';

export type RepositoryDisplayEntry =
  | { kind: 'collection'; label: string; collection: RepositoryCollection }
  | { kind: 'repository'; label: string; group: RepositoryGroup };

export function repositoryDisplayEntries(groups: readonly RepositoryGroup[], collections: readonly RepositoryCollection[]): RepositoryDisplayEntry[] {
  const collectionIds = new Set(collections.map(collection => collection.id));
  const roots = groups.filter(group => !group.collectionId || !collectionIds.has(group.collectionId));
  return [
    ...collections.map(collection => ({ kind: 'collection' as const, label: collection.name, collection })),
    ...roots.map(group => ({ kind: 'repository' as const, label: group.name, group })),
  ].sort((left, right) => left.label.localeCompare(right.label));
}

/** Repository keys in the exact order selectable rows are currently rendered. */
export function visibleRepositoryKeys(entries: readonly RepositoryDisplayEntry[], groups: readonly RepositoryGroup[], collapsedCollectionIds: readonly string[]): string[] {
  const collapsed = new Set(collapsedCollectionIds);
  return entries.flatMap(entry => {
    if (entry.kind === 'repository') return [entry.group.key];
    if (collapsed.has(entry.collection.id)) return [];
    return groups.filter(group => group.collectionId === entry.collection.id).map(group => group.key);
  });
}
