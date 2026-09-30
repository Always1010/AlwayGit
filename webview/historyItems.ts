import type { Commit } from '../src/protocol/types';

export const WORKING_TREE_OID = 'alwaygit:working-tree';

export type HistoryItem =
  | { kind: 'working'; key: typeof WORKING_TREE_OID; oid: typeof WORKING_TREE_OID; parents: string[] }
  | { kind: 'commit'; key: string; oid: string; parents: string[]; commit: Commit };

/**
 * Insert the mutable Working Tree immediately before a visible current HEAD.
 * When filters omit HEAD, keep only a standalone Working Tree node instead of
 * reintroducing a commit the user explicitly filtered out.
 */
export function buildHistoryItems(commits: readonly Commit[], head?: Commit): HistoryItem[] {
  const commitItems: HistoryItem[] = commits.map(commit => ({
    kind: 'commit', key: commit.oid, oid: commit.oid, parents: commit.parents,
    commit,
  }));
  const headIndex = head ? commits.findIndex(commit => commit.oid === head.oid) : -1;
  const working: HistoryItem = {
    kind: 'working', key: WORKING_TREE_OID, oid: WORKING_TREE_OID,
    parents: headIndex >= 0 && head ? [head.oid] : [],
  };
  if (headIndex >= 0) {
    commitItems.splice(headIndex, 0, working);
    return commitItems;
  }
  return [working, ...commitItems];
}
