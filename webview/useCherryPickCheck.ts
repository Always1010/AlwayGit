import { useEffect, useState } from 'react';
import type { CherryPickCheck } from '../src/protocol/types';
import type { MenuTarget } from './menus';
import { rpc } from './rpc';

export interface CherryPickMenuCheck { included: string[]; failed?: boolean }

/** Results belong to one repository, branch, HEAD and selection, never to the graph page. */
export function useCherryPickCheck(repoId: string | undefined, head: string | undefined, branch: string | undefined, target?: MenuTarget): CherryPickMenuCheck | undefined {
  const commits = target?.kind === 'commit' ? [...new Set(target.oids?.length ? target.oids : [target.oid])] : [];
  const selection = JSON.stringify(commits);
  const key = JSON.stringify([repoId, head, branch, selection]);
  const [result, setResult] = useState<{ key: string; target: MenuTarget; check: CherryPickMenuCheck }>();
  useEffect(() => {
    if (!repoId || !head || !branch || target?.kind !== 'commit' || !commits.length) return;
    let active = true;
    if (commits.includes(head)) {
      setResult({ key, target, check: { included: [head] } });
      return;
    }
    const controller = new AbortController();
    void rpc<CherryPickCheck>('cherryPickCheck', repoId, { commits, expectedHead: head, expectedBranch: branch }, { signal: controller.signal }).then(check => {
      if (active) setResult({ key, target, check: check.head === head && check.branch === branch ? { included: check.included } : { included: [], failed: true } });
    }, () => { if (active) setResult({ key, target, check: { included: [], failed: true } }); });
    return () => { active = false; controller.abort(); };
  }, [key, target]);
  return result?.key === key && result.target === target ? result.check : undefined;
}
