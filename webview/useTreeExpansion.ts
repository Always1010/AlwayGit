import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultTreeExpansion,
  patchTreeExpansion,
  type TreeExpansionMode,
  type TreeExpansionPatch,
  type TreeExpansionPreferences,
} from '../src/protocol/tree-expansion';
import { rpc, subscribe } from './rpc';

type Operation = { id: number; patch?: TreeExpansionPatch; failed?: boolean };
interface MemoryState {
  repoId: string;
  base: TreeExpansionPreferences;
  pending: Operation[];
  queue: Promise<unknown>;
  changes: number;
  events: number;
  sequence: number;
  loading: boolean;
  error?: string;
  local?: TreeExpansionPreferences;
}
function projected(state: MemoryState) {
  return state.pending.reduce(
    (preferences, operation) =>
      operation.patch ? patchTreeExpansion(preferences, operation.patch) : defaultTreeExpansion(),
    state.local ?? state.base,
  );
}

/** Local choices overlay late reads and broadcasts until the host confirms each ordered patch. */
export function useTreeExpansion(
  repoId: string,
  initial?: TreeExpansionPreferences,
  isolated = false,
) {
  const [, refresh] = useState(0),
    current = useRef<MemoryState | undefined>(undefined);
  if (current.current?.repoId !== repoId)
    current.current = {
      repoId,
      base: defaultTreeExpansion(),
      pending: [],
      queue: Promise.resolve(),
      changes: 0,
      events: 0,
      sequence: 0,
      loading: true,
      local: initial,
    };
  const state = current.current;
  const render = useCallback((owner: MemoryState) => {
    if (current.current === owner) refresh((value) => value + 1);
  }, []);
  const enqueue = useCallback(
    (owner: MemoryState, operation: Operation) => {
      owner.queue = owner.queue
        .catch(() => {})
        .then(async () => {
          if (!owner.pending.includes(operation)) return;
          // Keep failed and subsequent choices in order: retrying a failed mode must not erase a later path choice.
          if (owner.pending.some((item) => item.id < operation.id && item.failed)) {
            operation.failed = true;
            owner.loading = false;
            render(owner);
            return;
          }
          const events = owner.events,
            patch = operation.patch;
          try {
            const preferences = await rpc<TreeExpansionPreferences>(
              patch ? 'treeExpansionPatch' : 'treeExpansionReset',
              owner.repoId,
              patch,
            );
            if (!owner.pending.includes(operation)) return;
            if (owner.events === events) owner.base = preferences;
            owner.pending = owner.pending.filter((item) => item.id !== operation.id);
            if (!owner.pending.some((item) => item.failed)) owner.error = undefined;
          } catch (error) {
            if (!owner.pending.includes(operation)) return;
            operation.failed = true;
            owner.error = error instanceof Error ? error.message : String(error);
          }
          owner.loading = owner.pending.some((item) => !item.failed);
          render(owner);
        });
    },
    [render],
  );
  const reload = useCallback(() => {
    const owner = state,
      failed = owner.pending.filter((item) => item.failed);
    if (failed.length) {
      owner.changes++;
      owner.loading = true;
      for (const operation of failed) {
        operation.failed = false;
        enqueue(owner, operation);
      }
      render(owner);
      return;
    }
    const changes = owner.changes,
      events = owner.events;
    owner.loading = true;
    render(owner);
    void rpc<TreeExpansionPreferences>('treeExpansionRead', owner.repoId)
      .then((preferences) => {
        if (owner.changes === changes && owner.events === events) {
          owner.base = preferences;
          if (isolated && !owner.local) owner.local = preferences;
          if (!owner.pending.length) owner.error = undefined;
        }
      })
      .catch((error) => {
        if (owner.changes === changes && owner.events === events)
          owner.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        owner.loading = owner.pending.some((item) => !item.failed);
        render(owner);
      });
  }, [state, render, enqueue, isolated]);
  useEffect(() => {
    reload();
    return subscribe((event) => {
      if (event.type !== 'treeExpansionChanged' || event.repoId !== state.repoId) return;
      state.events++;
      state.base = event.preferences;
      if (event.cleared) {
        state.local = isolated ? event.preferences : undefined;
        state.changes++;
        state.pending = [];
        state.error = undefined;
        state.loading = false;
      }
      render(state);
    });
  }, [state, reload, render, isolated]);
  const write = useCallback(
    (patch?: TreeExpansionPatch) => {
      const owner = state,
        operation: Operation = { id: ++owner.sequence, patch };
      if (isolated)
        owner.local = patch ? patchTreeExpansion(projected(owner), patch) : defaultTreeExpansion();
      // A new overall choice supersedes failed choices; a path choice only supersedes that same path.
      owner.pending = owner.pending.filter(
        (item) =>
          !item.failed ||
          (patch?.kind === 'directory' &&
            (item.patch?.kind !== 'directory' || item.patch.path !== patch.path)),
      );
      owner.changes++;
      owner.pending.push(operation);
      owner.loading = true;
      render(owner);
      enqueue(owner, operation);
    },
    [state, render, enqueue, isolated],
  );
  return {
    preferences: projected(state),
    loading: state.loading,
    error: state.error,
    reload,
    setDirectory: (path: string, expanded: boolean) => write({ kind: 'directory', path, expanded }),
    remove: (path: string) => write({ kind: 'directory', path, expanded: null }),
    setMode: (mode: TreeExpansionMode) => write({ kind: 'mode', mode }),
    reset: () => write(),
  };
}
