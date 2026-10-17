import { setImmediate } from 'node:timers/promises';
import type { Commit } from '../protocol/types';
import { message } from '../i18n';
import { GitError } from './error';

type Run = (args: string[], input?: Buffer) => Promise<Buffer>;
interface Node { oid: string; parents: string[]; children: string[] }
interface Change { status: string; path: string; previousPath?: string }
interface Edge { oid: string; parent?: string; changes: Change[] }
export interface FileHistoryEntry { oid: string; fileHistory: NonNullable<Commit['fileHistory']> }
export interface FileHistoryIndex { entries: FileHistoryEntry[]; filePaths: string[] }
const ids = (values: string[]) => Buffer.from(values.join('\n') + '\n', 'utf8');
const edgeKey = (oid: string, parent?: string) => `${oid}:${parent ?? ''}`;
const fail = () => new GitError(message('service.malformedGitStatusOutput'), 'PARSE_ERROR');

/**
 * Trace tree entries through each real parent edge, including both sides of a
 * merge. git log --follow mutates one pathname while walking; that can miss a
 * renamed branch's changes. Here Git supplies candidate commits and rename
 * detection, while each branch keeps its own pathname. Copies start a new file.
 * All Git reads share the caller's cancellation/output/time limits.
 */
export async function fileHistoryIndex(run: Run, tips: string[], revision: string, path: string, head?: string, signal?: AbortSignal): Promise<FileHistoryIndex> {
  if (!tips.length) return { entries: [], filePaths: [] };
  const checkpoint = async () => { await setImmediate(); signal?.throwIfAborted(); };
  const tree = (await run(['ls-tree', '-z', revision, '--', path])).toString('utf8');
  if (tree.startsWith('040000 ')) throw new GitError(message('service.fileHistoryRequiresFile'), 'INVALID_PATH');
  const starts = [...new Set([...tips, revision, ...(head ? [head] : [])])];
  const raw = (await run(['rev-list', '--topo-order', '--parents', '--stdin', '--'], ids(starts))).toString('utf8').trim();
  const nodes: Node[] = raw ? raw.split('\n').map(line => { const [oid, ...parents] = line.split(' '); return { oid, parents, children: [] }; }) : [];
  const graph = new Map(nodes.map(node => [node.oid, node]));
  if (nodes.length > 1_000_000) throw new GitError(message('service.fileHistoryTooLarge'), 'FILE_HISTORY_LIMIT');
  for (const node of nodes) for (const parent of node.parents) graph.get(parent)?.children.push(node.oid);
  const ancestors = (starts: string[]) => {
    const seen = new Set<string>(), pending = [...starts];
    while (pending.length) { const oid = pending.pop()!; if (seen.has(oid)) continue; seen.add(oid); pending.push(...(graph.get(oid)?.parents ?? [])); }
    return seen;
  };
  const scope = ancestors(tips), anchorAncestors = ancestors([revision]);
  const edges = new Map<string, Edge>(), scanned = new Set<string>(), aliases = new Set([path]);
  // Only commits touching a known pathname need diffs. Read full diffs there so
  // rename detection can discover a source/destination outside the path filter.
  while ([...aliases].some(name => !scanned.has(name))) {
    await checkpoint();
    if (aliases.size > 4096) throw new GitError(message('service.fileHistoryTooLarge'), 'FILE_HISTORY_LIMIT');
    const batch: string[] = []; let length = 0;
    for (const name of aliases) if (!scanned.has(name) && (length + name.length < 6000 || !batch.length)) { batch.push(name); scanned.add(name); length += name.length; }
    const candidates = (await run(['rev-list', '--full-history', '--parents', '--stdin', '--', ...batch], ids(starts))).toString('utf8').trim();
    const requests: Edge[] = [];
    for (const line of candidates ? candidates.split('\n') : []) {
      const node = graph.get(line.split(' ', 1)[0]); if (!node) continue;
      for (const parent of node.parents.length ? node.parents : [undefined]) {
        const key = edgeKey(node.oid, parent);
        if (!edges.has(key)) { const edge = { oid: node.oid, parent, changes: [] }; edges.set(key, edge); requests.push(edge); }
      }
    }
    for (let start = 0; start < requests.length; start += 128) {
      await checkpoint();
      const group = requests.slice(start, start + 128);
      // diff-tree stdin accepts a commit followed by a replacement parent list.
      // --always emits a header even for an empty edge, preserving parent order.
      const input = ids(group.map(edge => edge.parent ? `${edge.oid} ${edge.parent}` : edge.oid));
      const output = await run(['diff-tree', '--stdin', '--root', '--always', '-r', '-M50%', '--no-ext-diff', '--name-status', '-z'], input);
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(output); }
      catch { throw new GitError(message('service.thisRepositoryContainsAPathEncodedWithInvalidUTF'), 'UNSUPPORTED_PATH_ENCODING'); }
      const tokens = text.split('\0'); let position = 0;
      for (const edge of group) {
        if (tokens[position++] !== edge.oid) throw fail();
        while (position < tokens.length && /^[ACDMRTUXB][0-9]*$/.test(tokens[position])) {
          const status = tokens[position++], name = tokens[position++];
          if (!name) throw fail();
          const change: Change = status.startsWith('R') || status.startsWith('C') ? { status, previousPath: name, path: tokens[position++] } : { status, path: name };
          if (!change.path) throw fail();
          edge.changes.push(change);
        }
      }
      if (position !== tokens.length - 1) throw fail();
    }
    // New aliases can also intersect diffs read in a previous round.
    for (const edge of edges.values()) for (const change of edge.changes) if (change.status.startsWith('R') && change.previousPath && (aliases.has(change.path) || aliases.has(change.previousPath))) {
      aliases.add(change.path); aliases.add(change.previousPath);
    }
  }
  // Index edge lookups only after the rename closure is complete.
  const byPath = new Map<string, Map<string, Change>>(), bySource = new Map<string, Map<string, Change>>();
  for (const [key, edge] of edges) {
    byPath.set(key, new Map(edge.changes.filter(change => aliases.has(change.path)).map(change => [change.path, change])));
    bySource.set(key, new Map(edge.changes.filter(change => change.status.startsWith('R') && change.previousPath && aliases.has(change.previousPath)).map(change => [change.previousPath!, change])));
  }
  const related = new Map<string, { paths: Set<string>; parent?: string }>();
  const record = (oid: string, change: Change, parent?: string) => {
    if (!scope.has(oid)) return;
    let entry = related.get(oid);
    if (!entry) related.set(oid, entry = { paths: new Set(), parent });
    // Prefer the first actual parent for the normal commit-details comparison.
    if (parent === graph.get(oid)?.parents[0]) entry.parent = parent;
    entry.paths.add(change.path);
  };
  let seed = revision;
  if (tree) {
    // A tree entry exists at the pinned revision, even if it was later deleted.
  } else {
    // A deleted file can be opened at its deletion commit or a later revision.
    // Start from its last existing parent version, retaining the deletion node.
    const deletion = nodes.find(node => anchorAncestors.has(node.oid) && node.parents.some(parent => byPath.get(edgeKey(node.oid, parent))?.get(path)?.status === 'D'));
    const parent = deletion?.parents.find(parent => byPath.get(edgeKey(deletion.oid, parent))?.get(path)?.status === 'D');
    if (!deletion || !parent) return { entries: [], filePaths: [] };
    record(deletion.oid, byPath.get(edgeKey(deletion.oid, parent))!.get(path)!, parent); seed = parent;
  }
  const seen = new Map<string, Set<string>>(), pending: [string, string][] = [];
  const enqueue = (oid: string, name: string) => {
    if (!graph.has(oid)) return;
    const names = seen.get(oid) ?? new Set<string>(); if (names.has(name)) return;
    names.add(name); seen.set(oid, names); pending.push([oid, name]);
  };
  enqueue(seed, path);
  let visited = 0;
  while (pending.length) {
    if (++visited % 4096 === 0) await checkpoint();
    if (visited > 1_000_000) throw new GitError(message('service.fileHistoryTooLarge'), 'FILE_HISTORY_LIMIT');
    const [oid, name] = pending.pop()!, node = graph.get(oid)!;
    for (const parent of node.parents.length ? node.parents : [undefined]) {
      const change = byPath.get(edgeKey(oid, parent))?.get(name);
      if (change && change.status !== 'D') record(oid, change, parent);
      if (parent && change?.status !== 'A' && !change?.status.startsWith('C') && change?.status !== 'D') enqueue(parent, change?.previousPath ?? name);
    }
    for (const child of node.children) {
      const key = edgeKey(child, oid), rename = bySource.get(key)?.get(name), change = rename ?? byPath.get(key)?.get(name);
      if (change?.status === 'D') record(child, change, oid);
      else if (rename) enqueue(child, rename.path);
      else if (!change || !change.status.startsWith('R') && !change.status.startsWith('C') && change.status !== 'A') enqueue(child, name);
    }
  }
  // Collapse hidden commits to their nearest visible ancestors. Real parents
  // remain in Commit.parents; these edges are exclusively for the filtered graph.
  const nearest = new Map<string, string[]>(), result: FileHistoryEntry[] = [];
  for (let index = nodes.length - 1; index >= 0; index--) {
    if (index % 4096 === 0) await checkpoint();
    const node = nodes[index], parents = [...new Set(node.parents.flatMap(parent => nearest.get(parent) ?? []))], entry = related.get(node.oid);
    nearest.set(node.oid, entry ? [node.oid] : parents);
    if (entry) result.push({ oid: node.oid, fileHistory: { paths: [...entry.paths], ...(entry.parent ? { parent: entry.parent } : {}), graphParents: parents } });
  }
  return { entries: result.reverse(), filePaths: head ? [...(seen.get(head) ?? [])] : [] };
}
