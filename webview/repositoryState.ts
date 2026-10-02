import type { Snapshot } from '../src/protocol/types';

export type RepositoryViewState = 'unselected' | 'opening' | 'unavailable' | 'branch' | 'detached';

export function repositoryViewState(snapshot: Snapshot | undefined, selected: boolean, loading: boolean): RepositoryViewState {
  if (snapshot) return snapshot.branch ? 'branch' : 'detached';
  if (selected && loading) return 'opening';
  if (selected) return 'unavailable';
  return 'unselected';
}
