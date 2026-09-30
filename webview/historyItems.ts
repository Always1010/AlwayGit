import type { Commit } from '../src/protocol/types';

export const WORKING_TREE_OID = 'alwaygit:working-tree';

export type HistoryItem =
  | { kind: 'working'; key: typeof WORKING_TREE_OID; oid: typeof WORKING_TREE_OID; parents: string[] }
  | { kind: 'commit'; key: string; oid: string; parents: string[]; commit: Commit; anchor: boolean };

/**
 * Insert the mutable Working Tree immediately before its current HEAD. When
 * filters omit HEAD, keep a read-only HEAD anchor beside it instead of letting
 * the Working Tree float without a branch relationship.
 */
export function buildHistoryItems(commits: readonly Commit[], head?: Commit): HistoryItem[] {
  const commitItems: HistoryItem[] = commits.map(commit => ({
    kind: 'commit', key: commit.oid, oid: commit.oid, parents: commit.parents,
    commit, anchor: false,
  }));
  const headIndex = head ? commits.findIndex(commit => commit.oid === head.oid) : -1;
  const working: HistoryItem = {
    kind: 'working', key: WORKING_TREE_OID, oid: WORKING_TREE_OID,
    parents: head ? [head.oid] : [],
  };
  if (headIndex >= 0) {
    commitItems.splice(headIndex, 0, working);
    return commitItems;
  }
  if (head) {
    return [working, {
      kind: 'commit', key: head.oid, oid: head.oid, parents: head.parents,
      commit: head, anchor: true,
    }, ...commitItems];
  }
  return [working, ...commitItems];
}
