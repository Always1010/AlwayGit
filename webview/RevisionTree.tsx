import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { RevisionTreeEntry, RevisionTreeListing, RevisionTreeSearchPage } from '../src/protocol/tree';
import type { ContextHandler } from './Sidebar';
import { rpc } from './rpc';
import { useWorkbenchFields } from './subscriptions';
import { useTranslation } from './i18n';
import { Button, Empty, Icon } from './ui';
import { VirtualFileRows } from './VirtualFileRows';

type TreeRow = { entry: RevisionTreeEntry; depth: number };
type SearchContext = { repoId?: string; revision: string; query: string };

function sameSearchContext(left: SearchContext, right: SearchContext): boolean {
  return left.repoId === right.repoId && left.revision === right.revision && left.query === right.query;
}

function sizeLabel(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function rowsFor(entries: RevisionTreeEntry[], listings: Map<string, RevisionTreeEntry[]>, expanded: Set<string>, depth = 0): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const entry of entries) {
    rows.push({ entry, depth });
    if (entry.type === 'tree' && expanded.has(entry.path)) for(const row of rowsFor(listings.get(entry.path) ?? [], listings, expanded, depth + 1))rows.push(row);
  }
  return rows;
}

export function RevisionTree({ revision, context }: { revision: string; context: ContextHandler }) {
  const state = useWorkbenchFields('repoId', 'report', 'selectFile', 'selectedFile'), t = useTranslation();
  const [listings, setListings] = useState(() => new Map<string, RevisionTreeEntry[]>());
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const [loading, setLoading] = useState(() => new Set<string>());
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<RevisionTreeSearchPage>();
  const [searching, setSearching] = useState(false);
  const treeEpoch = useRef(0), searchEpoch = useRef(0), searchController = useRef<AbortController | undefined>(undefined);
  const searchContext = useRef<SearchContext>({ repoId: state.repoId, revision, query: query.trim() });
  searchContext.current = { repoId: state.repoId, revision, query: query.trim() };
  const cancelSearch = () => { ++searchEpoch.current; searchController.current?.abort(); searchController.current = undefined; };
  const beginSearch = (context: SearchContext) => {
    cancelSearch();
    const controller = new AbortController(); searchController.current = controller;
    return { request: searchEpoch.current, controller, context };
  };
  const currentSearch = ({ request, controller, context }: ReturnType<typeof beginSearch>) => request === searchEpoch.current && !controller.signal.aborted && sameSearchContext(context, searchContext.current);

  const load = useCallback(async (treePath: string) => {
    if (!state.repoId || loading.has(treePath) || listings.has(treePath)) return;
    const request = treeEpoch.current;
    setLoading(current => new Set(current).add(treePath)); setError(undefined);
    try {
      const result = await rpc<RevisionTreeListing>('revisionTree', state.repoId, { revision, ...(treePath ? { path: treePath } : {}) });
      if (request !== treeEpoch.current || result.revision !== revision || result.path !== treePath) return;
      setListings(current => new Map(current).set(treePath, result.entries));
    } catch (cause) {
      if (request === treeEpoch.current) { const message = cause instanceof Error ? cause.message : String(cause); setError(message); state.report(cause); }
    } finally {
      if (request === treeEpoch.current) setLoading(current => { const next = new Set(current); next.delete(treePath); return next; });
    }
  }, [state.repoId, revision, listings, loading, state.report]);

  useEffect(() => {
    const request = ++treeEpoch.current; cancelSearch();
    setListings(new Map()); setExpanded(new Set()); setLoading(new Set([''])); setError(undefined); setQuery(''); setSearch(undefined);
    void rpc<RevisionTreeListing>('revisionTree', state.repoId, { revision }).then(result => {
      if (request === treeEpoch.current && result.revision === revision && result.path === '') setListings(new Map([['', result.entries]]));
    }).catch(cause => { if (request === treeEpoch.current) { setError(cause instanceof Error ? cause.message : String(cause)); state.report(cause); } }).finally(() => { if (request === treeEpoch.current) setLoading(new Set()); });
  }, [state.repoId, revision]);

  useEffect(() => {
    const value = query.trim();
    if (!value) { cancelSearch(); setSearch(undefined); setSearching(false); return cancelSearch; }
    const pending = beginSearch({ repoId: state.repoId, revision, query: value });
    setSearching(true);
    const timer = window.setTimeout(() => {
      void rpc<RevisionTreeSearchPage>('revisionTreeSearch', state.repoId, { revision, query: value }, { signal: pending.controller.signal }).then(result => {
        if (currentSearch(pending) && result.revision === revision && result.query === value) setSearch(result);
      }).catch(cause => { if (currentSearch(pending)) { setError(cause instanceof Error ? cause.message : String(cause)); state.report(cause); } }).finally(() => { if (currentSearch(pending)) { searchController.current = undefined; setSearching(false); } });
    }, 250);
    return () => { window.clearTimeout(timer); cancelSearch(); };
  }, [query, revision, state.repoId, state.report]);

  const expand = (entry: RevisionTreeEntry) => {
    const opening = !expanded.has(entry.path);
    setExpanded(current => { const next = new Set(current); if (opening) next.add(entry.path); else next.delete(entry.path); return next; });
    if (opening) void load(entry.path);
  };
  const open = (entry: RevisionTreeEntry) => {
    if (entry.type === 'tree') { expand(entry); return; }
    if (entry.type === 'gitlink') return;
    state.selectFile({ kind: 'revision', revision, path: entry.path });
  };
  const openDocument = (entry: RevisionTreeEntry) => {
    if (entry.type === 'blob' || entry.type === 'symlink') void rpc('openRevision', state.repoId, { revision, path: entry.path }).catch(state.report);
  };
  const rootRows = useMemo(() => rowsFor(listings.get('') ?? [], listings, expanded), [listings, expanded]);
  const visibleRows = search ? search.entries.map(entry => ({ entry, depth: 0 })) : rootRows;
  const more = async () => {
    if (!search?.nextCursor || !state.repoId) return;
    const page = search, context = { repoId: state.repoId, revision, query: query.trim() };
    if (page.revision !== revision || page.query !== context.query) return;
    const pending = beginSearch(context);
    setSearching(true); setError(undefined);
    try {
      const next = await rpc<RevisionTreeSearchPage>('revisionTreeSearch', context.repoId, { revision, query: page.query, cursor: page.nextCursor }, { signal: pending.controller.signal });
      if (currentSearch(pending) && next.revision === revision && next.query === page.query) setSearch({ ...next, entries: [...page.entries, ...next.entries], truncated: page.truncated || next.truncated });
    } catch (cause) { if (currentSearch(pending)) { setError(cause instanceof Error ? cause.message : String(cause)); state.report(cause); } }
    finally { if (currentSearch(pending)) { searchController.current = undefined; setSearching(false); } }
  };

  return <div className="revision-tree">
    <div className="revision-tree-toolbar">
      <label className="file-path-filter"><Icon name="search"/><input type="search" value={query} onChange={event => { cancelSearch(); setQuery(event.target.value); }} aria-label={t('tree.searchAllPaths')} placeholder={t('tree.searchAllPathsPlaceholder')}/></label>
      {query && <Button className="icon-only" icon="close" title={t('tree.clearSearch')} aria-label={t('tree.clearSearch')} onClick={() => { cancelSearch(); setQuery(''); }}/>}
    </div>
    <div className="revision-tree-status" aria-live="polite">{search ? t('tree.matches', { count: search.entries.length }) : t('tree.resultTreeAt', { oid: revision.slice(0, 8) })}{search?.truncated ? ` · ${t('tree.searchTruncated')}` : ''}</div>
    <div className="revision-tree-rows" role="tree" aria-label={t('tree.fullRepositoryTree')}>
      <VirtualFileRows items={visibleRows} getKey={row=>row.entry.path} scrollParent=".revision-tree-rows">{({ entry, depth }) => {
        const folder = entry.type === 'tree', opened = folder && expanded.has(entry.path), selected = state.selectedFile === entry.path;
        const kindLabel = entry.type === 'tree' ? t('tree.directory') : entry.type === 'symlink' ? t('tree.symbolicLink') : entry.type === 'gitlink' ? t('tree.gitlink') : t('tree.file');
        return <div key={`${search ? 'search' : 'tree'}:${entry.path}`} className={`revision-tree-row${selected ? ' selected' : ''}`} role="treeitem" aria-level={depth + 1} aria-expanded={folder ? opened : undefined} aria-selected={selected} style={{ '--tree-depth': depth } as CSSProperties} onContextMenu={event => context(event, { kind: 'revision-tree-entry', revision, entry })}>
          <button className="revision-tree-entry" title={`${entry.path} · ${kindLabel}`} onClick={event => {if(event.detail<2)open(entry);}} onDoubleClick={() => openDocument(entry)}>
            <span className="revision-tree-indent"/>{folder && <Icon name={opened ? 'chevron-down' : 'chevron-right'}/>}<Icon name={folder ? opened ? 'folder-opened' : 'folder' : entry.type === 'symlink' ? 'file-symlink-file' : entry.type === 'gitlink' ? 'file-submodule' : 'file'}/>
            <span className="revision-tree-name">{entry.name}</span>
          </button>
          {entry.type === 'gitlink' ? <span className="revision-tree-meta hash" title={entry.oid}>{entry.oid.slice(0, 12)}</span> : entry.size !== undefined ? <span className="revision-tree-meta">{sizeLabel(entry.size)}</span> : null}
          {loading.has(entry.path) && <Icon name="loading" className="codicon-modifier-spin"/>}
        </div>;
      }}</VirtualFileRows>
      {!visibleRows.length && !loading.size && !searching && <Empty title={query ? t('tree.noMatchingPaths') : t('tree.emptyTree')}/>}
      {(loading.has('') || searching) && <div className="revision-tree-loading"><Icon name="loading" className="codicon-modifier-spin"/> {t('tree.loading')}</div>}
      {error && <div className="revision-tree-error">{error}</div>}
      {search?.nextCursor !== undefined && <Button icon="more" disabled={searching} onClick={() => void more()}>{t('tree.loadMore')}</Button>}
    </div>
  </div>;
}
