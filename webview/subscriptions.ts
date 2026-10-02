import { useShallow } from 'zustand/react/shallow';
import type { Snapshot } from '../src/protocol/types';
import { useWorkbench } from './store';

type State = ReturnType<typeof useWorkbench.getState>;
function pick<T, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map(key => [key, value[key]])) as Pick<T, K>;
}

// Subscribe to the fields a region displays; unrelated requests and drafts stay local.
export function useWorkbenchFields<K extends keyof State>(...keys: K[]): Pick<State, K> {
  return useWorkbench(useShallow(state => pick(state, keys)));
}

export function useSnapshotFields<K extends keyof Snapshot>(...keys: K[]): Pick<Snapshot, K> | undefined {
  return useWorkbench(useShallow(state => state.snapshot ? pick(state.snapshot, keys) : undefined));
}
