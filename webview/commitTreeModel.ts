import type { RevisionTreeChange, RevisionTreeEntry } from '../src/protocol/tree';

export interface SnapshotNode {
  id: string;
  entry: RevisionTreeEntry;
  children: SnapshotNode[];
  deleted?: boolean;
  change?: RevisionTreeChange;
  summary?: ChangeCounts;
}
export interface SnapshotRow { node: SnapshotNode; depth: number; guides: boolean[]; last: boolean }
export interface ChangeCounts { added: number; modified: number; deleted: number; renamed: number; copied: number; typeChanged: number }
const emptyCounts = (): ChangeCounts => ({ added: 0, modified: 0, deleted: 0, renamed: 0, copied: 0, typeChanged: 0 });
const countKeys: Record<string, keyof ChangeCounts> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'typeChanged' };
export function changeCounts(files: readonly RevisionTreeChange[]): ChangeCounts {
  const counts = emptyCounts();
  for (const file of files) counts[countKeys[file.status[0]] ?? 'modified']++;
  return counts;
}

export function snapshotNodes(entries: readonly RevisionTreeEntry[], changes: readonly RevisionTreeChange[] = []): SnapshotNode[] {
  const nodes = new Map(entries.map(entry => [entry.path, { id: entry.path, entry, children: [] } as SnapshotNode]));
  const ghosts = new Map<string, SnapshotNode>();
  const roots: SnapshotNode[] = [];
  const attach = (node: SnapshotNode, parent?: SnapshotNode) => (parent ? parent.children : roots).push(node);
  for (const node of nodes.values()) {
    const parent = nodes.get(node.entry.path.slice(0, node.entry.path.lastIndexOf('/')));
    attach(node, node.entry.path.includes('/') && parent?.entry.type === 'tree' ? parent : undefined);
  }
  const historicalParent = (path: string): SnapshotNode | undefined => {
    const slash = path.lastIndexOf('/');
    if (slash < 0) return;
    const parentPath = path.slice(0, slash), real = nodes.get(parentPath);
    if (real?.entry.type === 'tree') return real;
    if (ghosts.has(parentPath)) return ghosts.get(parentPath);
    const parent: SnapshotNode = { id: `\0directory:${parentPath}`, entry: { path: parentPath, name: parentPath.split('/').at(-1)!, oid: '', mode: '040000', type: 'tree' }, children: [], deleted: true };
    ghosts.set(parentPath, parent);
    attach(parent, historicalParent(parentPath));
    return parent;
  };
  for (const change of changes) {
    if (change.status[0] !== 'D') {
      const node = nodes.get(change.path);
      if (node) node.change = change;
      continue;
    }
    const type = change.beforeMode === '160000' ? 'gitlink' : change.beforeMode === '120000' ? 'symlink' : 'blob';
    const node: SnapshotNode = { id: `\0deleted:${change.path}`, entry: { path: change.path, name: change.path.split('/').at(-1)!, mode: change.beforeMode, oid: change.beforeOid, type }, children: [], deleted: true, change };
    attach(node, historicalParent(change.path));
  }
  const sort = (list: SnapshotNode[]) => {
    list.sort((a, b) => Number(b.entry.type === 'tree') - Number(a.entry.type === 'tree') || a.entry.name.localeCompare(b.entry.name) || Number(!!a.deleted) - Number(!!b.deleted));
    for (const node of list) {
      sort(node.children);
      if (node.entry.type === 'tree') {
        const summary = emptyCounts();
        for (const child of node.children) {
          if (child.change) summary[countKeys[child.change.status[0]] ?? 'modified']++;
          if (child.summary) for (const key of Object.keys(summary) as (keyof ChangeCounts)[]) summary[key] += child.summary[key];
        }
        if (Object.values(summary).some(Boolean)) node.summary = summary;
      }
    }
  };
  sort(roots);
  return roots;
}

export function allSnapshotNodes(nodes: SnapshotNode[]): SnapshotNode[] {
  const result: SnapshotNode[] = [], pending = [...nodes];
  while (pending.length) { const node = pending.pop()!; result.push(node); for (const child of node.children) pending.push(child); }
  return result;
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
