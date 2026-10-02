import type { GitRef } from '../src/protocol/types';

interface RefIndex {
  byName: Map<string, GitRef>;
  byOid: Map<string, GitRef[]>;
  local: GitRef[];
  remote: GitRef[];
  tag: GitRef[];
}
const empty: GitRef[] = [];
const indexes = new WeakMap<GitRef[], RefIndex>();

/** Snapshots replace changed ref arrays; unchanged snapshots reuse this derived index. */
export function indexRefs(refs: GitRef[] = empty): RefIndex {
  const cached = indexes.get(refs);
  if (cached) return cached;
  const index: RefIndex = { byName: new Map(), byOid: new Map(), local: [], remote: [], tag: [] };
  for (const ref of refs) {
    index.byName.set(ref.fullName, ref);
    const group = index.byOid.get(ref.oid);
    if (group) group.push(ref); else index.byOid.set(ref.oid, [ref]);
    index[ref.kind].push(ref);
  }
  indexes.set(refs, index);
  return index;
}
