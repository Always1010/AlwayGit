import type { RepositoryCollection, RepositoryOrder } from './types';
import type { RepositoryGroup } from './repositories';

export const collectionOrderKey = (id: string) => `collection:${id}`;
export const repositoryOrderKey = (key: string) => `repository:${key}`;
const appendMissing = (saved: readonly string[], available: readonly string[]) => [...new Set([...saved, ...available])];

/** Preserve unavailable repositories' positions; explicit removal forgets their keys. */
export function reconcileRepositoryOrder(groups: readonly RepositoryGroup[], collections: readonly RepositoryCollection[], saved?: RepositoryOrder): RepositoryOrder {
  const ids = new Set(collections.map(collection => collection.id));
  const parent = new Map(groups.map(group => [repositoryOrderKey(group.key), group.collectionId && ids.has(group.collectionId) ? group.collectionId : undefined]));
  const roots = groups.filter(group => !parent.get(repositoryOrderKey(group.key)));
  // Only legacy migration sorts existing root repositories. Future entries append.
  if (!saved) roots.sort((left, right) => left.name.localeCompare(right.name));
  const defaults = [...roots.map(group => repositoryOrderKey(group.key)), ...collections.map(collection => collectionOrderKey(collection.id))];
  return {
    root: appendMissing((saved?.root ?? []).filter(key => key.startsWith('collection:') ? ids.has(key.slice(11)) : !parent.get(key)), defaults),
    collections: Object.fromEntries(collections.map(collection => [collection.id, appendMissing(
      (saved?.collections[collection.id] ?? []).filter(key => !parent.has(key) || parent.get(key) === collection.id),
      groups.filter(group => parent.get(repositoryOrderKey(group.key)) === collection.id).map(group => repositoryOrderKey(group.key)),
    )])),
  };
}

export function forgetRepositoryOrderKeys(order: RepositoryOrder, keys: ReadonlySet<string>): RepositoryOrder {
  return { root: order.root.filter(key => !keys.has(key)), collections: Object.fromEntries(Object.entries(order.collections).map(([id, entries]) => [id, entries.filter(key => !keys.has(key))])) };
}
