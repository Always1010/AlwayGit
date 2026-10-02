import type { RepositoryCollection, RepositoryOrder } from '../src/protocol/types';
import type { RepositoryGroup } from '../src/protocol/repositories';
import { collectionOrderKey, repositoryOrderKey, reconcileRepositoryOrder } from '../src/protocol/repository-order';

export type RepositoryDisplayEntry =
  | { kind: 'collection'; label: string; collection: RepositoryCollection }
  | { kind: 'repository'; label: string; group: RepositoryGroup };

export function repositoryDisplayEntries(groups: readonly RepositoryGroup[], collections: readonly RepositoryCollection[], order?: RepositoryOrder): RepositoryDisplayEntry[] {
  const collectionIds = new Set(collections.map(collection => collection.id));
  const roots = groups.filter(group => !group.collectionId || !collectionIds.has(group.collectionId));
  const entries: RepositoryDisplayEntry[] = [
    ...collections.map(collection => ({ kind: 'collection' as const, label: collection.name, collection })),
    ...roots.map(group => ({ kind: 'repository' as const, label: group.name, group })),
  ];
  const byKey = new Map(entries.map(entry => [repositoryEntryKey(entry), entry]));
  return reconcileRepositoryOrder(groups, collections, order).root.flatMap(key => byKey.has(key) ? [byKey.get(key)!] : []);
}

export const repositoryEntryKey = (entry: RepositoryDisplayEntry) => entry.kind === 'collection' ? collectionOrderKey(entry.collection.id) : repositoryOrderKey(entry.group.key);

export function repositoryCollectionGroups(groups: readonly RepositoryGroup[], collectionId: string, order?: RepositoryOrder): RepositoryGroup[] {
  const members = groups.filter(group => group.collectionId === collectionId), byKey = new Map(members.map(group => [repositoryOrderKey(group.key), group]));
  return [...new Set([...(order?.collections[collectionId] ?? []), ...byKey.keys()])].flatMap(key => byKey.has(key) ? [byKey.get(key)!] : []);
}

/** Repository keys in the exact order selectable rows are currently rendered. */
export function visibleRepositoryKeys(entries: readonly RepositoryDisplayEntry[], groups: readonly RepositoryGroup[], collapsedCollectionIds: readonly string[], order?: RepositoryOrder): string[] {
  const collapsed = new Set(collapsedCollectionIds);
  return entries.flatMap(entry => {
    if (entry.kind === 'repository') return [entry.group.key];
    if (collapsed.has(entry.collection.id)) return [];
    return repositoryCollectionGroups(groups, entry.collection.id, order).map(group => group.key);
  });
}
