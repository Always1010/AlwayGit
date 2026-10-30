import { useCallback, useRef, useState } from 'react';
import type { CommitTreeTarget, CommitTreeViewState } from '../src/protocol/tree';
import { readCommitTreeState, saveCommitTreeState } from './rpc';

/** One complete snapshot owns both display choices and the current reading position. */
export function useCommitTreeState(target: CommitTreeTarget) {
  const saved = useRef(readCommitTreeState(target));
  const [initial] = useState(() => saved.current.view ?? {});
  const [saveError, setSaveError] = useState<string>();
  const serialized = useRef('');
  const update = useCallback((patch: Partial<CommitTreeViewState>) => {
    saved.current = {
      ...saved.current,
      view: { ...saved.current.view, ...patch },
    };
    try {
      const next = JSON.stringify(saved.current);
      if (serialized.current === next) return;
      saveCommitTreeState(saved.current);
      serialized.current = next;
      setSaveError(undefined);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }, []);
  return { initial, saved, update, saveError };
}
