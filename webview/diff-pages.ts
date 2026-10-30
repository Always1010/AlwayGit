import { useEffect, useRef, useState } from 'react';
import type { DiffIndex, DiffPage, DiffRow } from '../src/protocol/diff';
import { rpc } from './rpc';

const PAGE_ROWS = 128;
/** Bounded viewport cache. Index metadata, not cached text, owns navigation/statistics. */
export function useDiffPages(
  repoId: string | undefined,
  index: DiffIndex | undefined,
  start: number,
  end: number,
  enabled: boolean,
  isolated = false,
) {
  const cache = useRef<{ token: string; pages: Map<number, DiffRow[]> }>({
    token: '',
    pages: new Map(),
  });
  const [, render] = useState(0),
    [failure, setFailure] = useState<{ token: string; message: string }>();
  const token = index?.token ?? '';
  if (cache.current.token !== token) cache.current = { token, pages: new Map() };
  const first = Math.floor(start / PAGE_ROWS),
    last = Math.floor(end / PAGE_ROWS);
  useEffect(() => {
    if (!token || !enabled || !index?.rowCount) return;
    const controller = new AbortController();
    let live = true;
    setFailure(undefined);
    void (async () => {
      // Sequential requests share one cancellable read category.
      for (let page = first; page <= last; page++) {
        if (cache.current.pages.has(page)) continue;
        const result = await rpc<DiffPage>(
          isolated ? 'isolatedDiffPage' : 'diffPage',
          repoId,
          { token, start: page * PAGE_ROWS, count: PAGE_ROWS },
          { signal: controller.signal },
        );
        if (!live || cache.current.token !== token || result.token !== token) return;
        cache.current.pages.set(page, result.rows);
        for (const key of cache.current.pages.keys())
          if (cache.current.pages.size > 6 && (key < first || key > last))
            cache.current.pages.delete(key);
        render((value) => value + 1);
      }
    })().catch((error) => {
      if (live)
        setFailure({ token, message: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [repoId, token, first, last, enabled, isolated]);
  return {
    row: (position: number) =>
      cache.current.pages.get(Math.floor(position / PAGE_ROWS))?.[position % PAGE_ROWS],
    error: failure?.token === token ? failure.message : undefined,
  };
}
