import type { RepositoryCollection, RepositoryOrder, RepositoryRow } from '../src/protocol/types';
import type { RepositoryGroup } from '../src/protocol/repositories';
import {
  collectionOrderKey,
  repositoryOrderKey,
  reconcileRepositoryOrder,
} from '../src/protocol/repository-order';

export type RepositoryDisplayEntry =
  | { kind: 'collection'; label: string; collection: RepositoryCollection }
  | { kind: 'repository'; label: string; group: RepositoryGroup };

export function repositoryDisplayEntries(
  groups: readonly RepositoryGroup[],
  collections: readonly RepositoryCollection[],
  order?: RepositoryOrder,
  showEmptyCollections = false,
): RepositoryDisplayEntry[] {
  const collectionIds = new Set(collections.map((collection) => collection.id));
  const roots = groups.filter((group) => !group.collectionIds.some((id) => collectionIds.has(id)));
  const visibleCollections =
    groups.length && roots.length === groups.length && !showEmptyCollections ? [] : collections;
  const entries: RepositoryDisplayEntry[] = [
    ...visibleCollections.map((collection) => ({
      kind: 'collection' as const,
      label: collection.name,
      collection,
    })),
    ...roots.map((group) => ({ kind: 'repository' as const, label: group.name, group })),
  ];
  const byKey = new Map(entries.map((entry) => [repositoryEntryKey(entry), entry]));
  return reconcileRepositoryOrder(groups, collections, order).root.flatMap((key) =>
    byKey.has(key) ? [byKey.get(key)!] : [],
  );
}

export const repositoryEntryKey = (entry: RepositoryDisplayEntry) =>
  entry.kind === 'collection'
    ? collectionOrderKey(entry.collection.id)
    : repositoryOrderKey(entry.group.key);

export function repositoryCollectionGroups(
  groups: readonly RepositoryGroup[],
  collectionId: string,
  order?: RepositoryOrder,
): RepositoryGroup[] {
  const members = groups.filter((group) => group.collectionIds.includes(collectionId)),
    byKey = new Map(members.map((group) => [repositoryOrderKey(group.key), group]));
  return [...new Set([...(order?.collections[collectionId] ?? []), ...byKey.keys()])].flatMap(
    (key) => (byKey.has(key) ? [byKey.get(key)!] : []),
  );
}

/** Repository keys in the exact order selectable rows are currently rendered. */
export function visibleRepositoryKeys(
  entries: readonly RepositoryDisplayEntry[],
  groups: readonly RepositoryGroup[],
  collapsedCollectionIds: readonly string[],
  order?: RepositoryOrder,
): string[] {
  const collapsed = new Set(collapsedCollectionIds);
  return entries.flatMap((entry) => {
    if (entry.kind === 'repository') return [entry.group.key];
    if (collapsed.has(entry.collection.id)) return [];
    return repositoryCollectionGroups(groups, entry.collection.id, order).map((group) =>
      repositoryRowKey({ key: group.key, collectionId: entry.collection.id }),
    );
  });
}

/** Row identity is separate from Git identity: one repository can appear in several collections. */
export const repositoryRowKey = (row: RepositoryRow): string =>
  row.collectionId === null ? row.key : JSON.stringify([row.collectionId, row.key]);

export function repositoryRows(
  groups: readonly RepositoryGroup[],
  collections: readonly RepositoryCollection[],
): RepositoryRow[] {
  const ids = new Set(collections.map((collection) => collection.id));
  return groups.flatMap<RepositoryRow>((group) => {
    const memberships = group.collectionIds.filter((id) => ids.has(id));
    return memberships.length
      ? memberships.map((collectionId) => ({ key: group.key, collectionId }))
      : [{ key: group.key, collectionId: null }];
  });
}
