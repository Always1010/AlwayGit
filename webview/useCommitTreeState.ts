import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CommitTreePanelState,
  CommitTreeTarget,
  CommitTreeViewState,
} from '../src/protocol/tree';
import { readCommitTreeState, saveCommitTreeState, rpc, subscribe } from './rpc';
import { SessionPersistence } from './session-persistence';

/** One complete snapshot owns both display choices and the current reading position. */
export function useCommitTreeState(target: CommitTreeTarget) {
  const saved = useRef(readCommitTreeState(target));
  const [initial] = useState(() => saved.current.view ?? {});
  const [saveError, setSaveError] = useState<string>();
  const paused = useRef(false);
  const [persistence] = useState(
    () =>
      new SessionPersistence<CommitTreePanelState>(saveCommitTreeState, async (value) => {
        if (!paused.current) await rpc('saveCommitTreeState', target.repoId, value);
        setSaveError(undefined);
      }),
  );
  useEffect(() => {
    const flush = () => persistence.flushNow();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    const unsubscribe = subscribe((event) => {
      if (event.type === 'treePageCacheCleared' && event.repoId === target.repoId) {
        paused.current = true;
        persistence.discardPending();
      }
    });
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
      unsubscribe();
      flush();
    };
  }, [persistence, target.repoId]);
  const update = useCallback(
    (patch: Partial<CommitTreeViewState>) => {
      saved.current = {
        ...saved.current,
        view: { ...saved.current.view, ...patch },
      };
      persistence.save(saved.current, (error) => setSaveError(error.message));
    },
    [persistence],
  );
  return {
    initial,
    saved,
    update,
    saveError,
    retry: () => persistence.flushNow(),
    resume: () => {
      paused.current = false;
    },
  };
}
