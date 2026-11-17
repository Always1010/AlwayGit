import { useEffect, useRef, useState } from 'react';
import type { CherryPickCheck } from '../src/protocol/types';
import { rpc, RpcError } from './rpc';
import { isActionContextCurrent, useWorkbench, type RepositoryActionContext } from './store';

/** Check only an opened action dialog, bound to its original repository, branch and HEAD. */
export function useCherryPickCheck(
  context: RepositoryActionContext,
  head: string,
  branch: string | undefined,
  commits?: string[],
) {
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([context.repoId, context.epoch, head, branch, commits, revision]);
  const [result, setResult] = useState<{
    key: string;
    check?: CherryPickCheck;
    failed?: boolean;
    changed?: boolean;
  }>();
  const invalidated = useRef(false);
  const isCurrent = () => {
    const snapshot = useWorkbench.getState().snapshot;
    return (
      !invalidated.current &&
      isActionContextCurrent(context) &&
      snapshot?.head === head &&
      snapshot?.branch === branch
    );
  };
  invalidated.current ||= !!commits && !isCurrent();
  const current = !invalidated.current;
  useEffect(() => {
    if (!context.repoId || !head || !branch || !commits?.length || !current) return;
    let active = true;
    const controller = new AbortController();
    void rpc<CherryPickCheck>(
      'cherryPickCheck',
      context.repoId,
      { commits, expectedHead: head, expectedBranch: branch },
      { signal: controller.signal },
    ).then(
      (check) => {
        if (active && isCurrent())
          setResult({
            key,
            ...(check.head === head && check.branch === branch ? { check } : { changed: true }),
          });
      },
      (error) => {
        if (active && isCurrent())
          setResult({
            key,
            ...(error instanceof RpcError && error.code === 'OPERATION_CHANGED'
              ? { changed: true }
              : { failed: true }),
          });
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [key, current]);
  const matching = result?.key === key ? result : undefined;
  return {
    check: current ? matching?.check : undefined,
    failed: !!matching?.failed,
    changed: !current || !!matching?.changed,
    retry: () => setRevision((previous) => previous + 1),
  };
}
