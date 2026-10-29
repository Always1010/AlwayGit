import type { RevisionTreeEntry } from '../src/protocol/tree';

export interface SnapshotNode {
  id: string;
  entry: RevisionTreeEntry;
  children: SnapshotNode[];
}
export interface SnapshotRow { node: SnapshotNode; depth: number; guides: boolean[]; last: boolean }

export function snapshotNodes(entries: readonly RevisionTreeEntry[]): SnapshotNode[] {
  const nodes = new Map(entries.map(entry => [entry.path, { id: entry.path, entry, children: [] } as SnapshotNode]));
  const roots: SnapshotNode[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node.entry.path.slice(0, node.entry.path.lastIndexOf('/')));
    if (node.entry.path.includes('/') && parent?.entry.type === 'tree') parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list: SnapshotNode[]) => {
    list.sort((a, b) => Number(b.entry.type === 'tree') - Number(a.entry.type === 'tree') || a.entry.name.localeCompare(b.entry.name));
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}

export function snapshotRows(nodes: SnapshotNode[], expanded: ReadonlySet<string>, query = ''): SnapshotRow[] {
  const rows: SnapshotRow[] = [], needle = query.trim().toLocaleLowerCase();
  const visit = (list: SnapshotNode[], guides: boolean[]) => {
    list.forEach((node, index) => {
      const last = index === list.length - 1;
      if (needle) {
        if (node.entry.path.toLocaleLowerCase().includes(needle)) rows.push({ node, depth: 0, guides: [], last: true });
        visit(node.children, []);
      } else {
        rows.push({ node, depth: guides.length, guides, last });
        if (expanded.has(node.id)) visit(node.children, [...guides, !last]);
      }
    });
  };
  visit(nodes, []);
  return rows;
}

export function snapshotCounts(entries: readonly RevisionTreeEntry[]) {
  return { files: entries.filter(entry => entry.type === 'blob' || entry.type === 'symlink').length, submodules: entries.filter(entry => entry.type === 'gitlink').length };
}
