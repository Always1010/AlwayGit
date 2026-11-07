interface HistoryNode {
  oid: string;
  parents: readonly string[];
}

/**
 * Prefer each tip's first-parent path without ever emitting a parent before
 * another visible child. Rank the complete scope before slicing any pages.
 * Iterative walks also handle long histories without exhausting the stack.
 */
export function orderHistory<T extends HistoryNode>(
  commits: readonly T[],
  tips: readonly string[],
): T[] {
  const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
  const ranked: T[] = [];
  const rank = new Map<string, number>();
  for (const start of [...tips, ...byOid.keys()]) {
    const pending = [start];
    while (pending.length) {
      const oid = pending.pop()!;
      const commit = byOid.get(oid);
      if (!commit || rank.has(oid)) continue;
      rank.set(oid, ranked.length);
      ranked.push(commit);
      for (let index = commit.parents.length - 1; index >= 0; index--)
        pending.push(commit.parents[index]);
    }
  }
  const children = new Uint32Array(ranked.length);
  for (const commit of ranked)
    for (const parent of new Set(commit.parents)) {
      const index = rank.get(parent);
      if (index !== undefined) children[index]++;
    }

  // A min-heap of eligible ranks lets blocked shared ancestors wait while the
  // next preferred path unfolds, without repeatedly scanning all pending tips.
  const ready: number[] = [];
  const push = (value: number) => {
    let index = ready.length;
    ready.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (ready[parent] <= value) break;
      ready[index] = ready[parent];
      index = parent;
    }
    ready[index] = value;
  };
  const pop = () => {
    const first = ready[0];
    const last = ready.pop()!;
    if (ready.length) {
      let index = 0;
      while (index * 2 + 1 < ready.length) {
        let child = index * 2 + 1;
        if (child + 1 < ready.length && ready[child + 1] < ready[child]) child++;
        if (ready[child] >= last) break;
        ready[index] = ready[child];
        index = child;
      }
      ready[index] = last;
    }
    return first;
  };
  children.forEach((count, index) => {
    if (!count) push(index);
  });
  const result: T[] = [];
  while (ready.length) {
    const commit = ranked[pop()];
    result.push(commit);
    for (const parent of new Set(commit.parents)) {
      const index = rank.get(parent);
      if (index !== undefined && --children[index] === 0) push(index);
    }
  }
  return result;
}
