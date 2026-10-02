import type { Snapshot } from '../src/protocol/types';

export type RepositoryViewState = 'unselected' | 'opening' | 'branch' | 'detached';

export function repositoryViewState(snapshot: Snapshot | undefined, selected: boolean, loading: boolean): RepositoryViewState {
  if (snapshot) return snapshot.branch ? 'branch' : 'detached';
  if (selected && loading) return 'opening';
  return 'unselected';
}
