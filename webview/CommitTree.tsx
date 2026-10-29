import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { CommitTreeTarget, RevisionTreeCommit, RevisionTreeEntry, RevisionTreeListing } from '../src/protocol/tree';
import { rpc, saveCommitTreeState } from './rpc';
import { useWorkbenchFields } from './subscriptions';
import { useResolvedTheme, diffRowHeight } from './appearance';
import { useTranslation } from './i18n';
import { Button, Icon } from './ui';
import { VirtualFileRows } from './VirtualFileRows';
import { SnapshotPreview } from './SnapshotPreview';
import { ContextMenu } from './ContextMenu';
import { snapshotCounts, snapshotNodes, snapshotRows } from './commitTreeModel';
import './commit-tree.css';

export function CommitTree({ target: { repoId, revision } }: { target: CommitTreeTarget }) {
  const t = useTranslation(), preferences = useWorkbenchFields('appearance', 'layout', 'language');
  const theme = useResolvedTheme(preferences.appearance.theme);
  const [entries, setEntries] = useState<RevisionTreeEntry[]>([]), [indexed, setIndexed] = useState(false), [loading, setLoading] = useState(true);
  const [metadata, setMetadata] = useState<RevisionTreeCommit>(), [error, setError] = useState<string>(), [metadataError, setMetadataError] = useState<string>();
  const [expanded, setExpanded] = useState(new Set<string>()), [query, setQuery] = useState(''), [selected, setSelected] = useState<string>();
  const [previewOpen, setPreviewOpen] = useState(false), [expanding, setExpanding] = useState<number>();
  const indexController = useRef<AbortController | undefined>(undefined), expansionEpoch = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [menu, setMenu] = useState<{ entry: RevisionTreeEntry; x: number; y: number; anchor: HTMLElement }>();
  const closeMenu = useCallback(() => setMenu(undefined), []);
  useEffect(() => {
    saveCommitTreeState({ commitTree: { repoId, revision } });
    document.documentElement.lang = preferences.language;
  }, [repoId, revision, preferences.language]);
  useEffect(() => {
    const controller = new AbortController(); indexController.current = controller;
    let live = true, complete = false;
    setLoading(true); setError(undefined); setIndexed(false); setEntries([]); setExpanded(new Set());
    void rpc<RevisionTreeListing>('revisionTree', repoId, { revision }).then(result => { if (live && !complete) setEntries(result.entries); }).catch(() => {});
    void rpc<RevisionTreeListing>('revisionTreeIndex', repoId, { revision }, { signal: controller.signal }).then(result => {
      if (!live || controller.signal.aborted) return;
      complete = true; setEntries(result.entries); setIndexed(true);
      setExpanded(new Set(result.entries.filter(entry => entry.type === 'tree' && (result.entries.length <= 5000 || !entry.path.includes('/'))).map(entry => entry.path)));
    }).catch(error => { if (live) setError(controller.signal.aborted ? t('tree.indexCancelled') : error.message); }).finally(() => { if (live) setLoading(false); });
    void rpc<RevisionTreeCommit>('revisionTreeCommit', repoId, { revision }).then(result => { if (live) { setMetadata(result); setMetadataError(undefined); } }).catch(error => { if (live) setMetadataError(error.message); });
    return () => { live = false; controller.abort(); expansionEpoch.current++; };
  }, [repoId, revision, attempt]);
  const nodes = useMemo(() => snapshotNodes(entries), [entries]);
  const rows = useMemo(() => snapshotRows(nodes, expanded, query), [nodes, expanded, query]);
  const counts = useMemo(() => snapshotCounts(entries), [entries]);
  const selectedEntry = entries.find(entry => entry.path === selected);
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));
  const copy = (text: string) => void rpc('copyText', repoId, { text }).catch(fail);
  const expandAll = async () => {
    const epoch = ++expansionEpoch.current, folders = entries.filter(entry => entry.type === 'tree').map(entry => entry.path), next = new Set(expanded);
    setQuery(''); setExpanding(0);
    for (let offset = 0; offset < folders.length; offset += 500) {
      if (epoch !== expansionEpoch.current) return;
      folders.slice(offset, offset + 500).forEach(path => next.add(path));
      setExpanded(new Set(next)); setExpanding(Math.min(offset + 500, folders.length));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (epoch === expansionEpoch.current) setExpanding(undefined);
  };
  const collapse = () => { expansionEpoch.current++; setExpanding(undefined); setQuery(''); setExpanded(new Set()); };
  const openEntry = (entry: RevisionTreeEntry) => {
    if (entry.type === 'tree') {
      setExpanded(current => { const next = new Set(current); if (!next.delete(entry.path)) next.add(entry.path); return next; });
      if (!indexed) void rpc<RevisionTreeListing>('revisionTree', repoId, { revision, path: entry.path }).then(result => setEntries(current => { const byPath = new Map(current.map(item => [item.path, item])); result.entries.forEach(item => byPath.set(item.path, item)); return [...byPath.values()]; })).catch(fail);
    }
    else { setSelected(entry.path); setPreviewOpen(true); }
  };
  return <div className="workbench commit-tree-page" data-theme={theme} style={{ '--workbench-font': `${preferences.layout.font}px`, '--file-row-height': '26px', '--diff-font': `${preferences.appearance.codeFont}px`, '--diff-row-height': `${diffRowHeight(preferences.appearance.codeFont, preferences.appearance.codeRowHeight)}px` } as CSSProperties}>
    <header className="commit-tree-header"><div><Icon name="list-tree"/> <strong>{t('tree.snapshotTitle')}</strong> <span className="hash">{revision.slice(0, 8)}</span><Button className="icon-only" icon="copy" title={t('tree.copyCommitId')} aria-label={t('tree.copyCommitId')} onClick={() => copy(revision)}/></div>{metadata && <><strong className="truncate" title={metadata.body}>{metadata.commit.subject}</strong><span className="muted">{metadata.commit.author} · {new Date(metadata.commit.timestamp * 1000).toLocaleString(preferences.language)}</span></>}<span className="muted" title={metadata?.repository.root}>{metadata ? `${metadata.repository.name} · ${metadata.repository.root}` : repoId}</span></header>
    <div className="revision-tree-toolbar commit-tree-toolbar"><label className="file-path-filter"><Icon name="search"/><input type="search" disabled={!indexed} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('tree.searchAllPathsPlaceholder')} aria-label={t('tree.searchAllPaths')}/></label><Button className="icon-only" icon="expand-all" title={t('tree.expandAll')} aria-label={t('tree.expandAll')} disabled={!indexed || expanding !== undefined} onClick={() => void expandAll()}/><Button className="icon-only" icon="collapse-all" title={t('tree.collapseAll')} aria-label={t('tree.collapseAll')} onClick={collapse}/><Button className="icon-only" icon="open-preview" title={t('tree.togglePreview')} aria-label={t('tree.togglePreview')} aria-pressed={previewOpen} onClick={() => setPreviewOpen(value => !value)}/></div>
    <div className="revision-tree-status" role="status">{indexed ? t('tree.snapshotCount', counts) : t(loading ? 'tree.indexing' : 'tree.indexIncomplete')}{query && ` · ${t('tree.matches', { count: rows.length })}`}{loading && <Button className="icon-only" icon="close" title={t('tree.cancelLoading')} aria-label={t('tree.cancelLoading')} onClick={() => indexController.current?.abort()}/>} {expanding !== undefined && <>{t('tree.expanding', { count: expanding })}<Button className="icon-only" icon="close" title={t('tree.cancelExpand')} aria-label={t('tree.cancelExpand')} onClick={() => { expansionEpoch.current++; setExpanding(undefined); }}/></>}</div>
    {(error || metadataError) && <div className="revision-tree-error" role="alert">{error || metadataError}<Button className="icon-only" icon="refresh" title={t('tree.retry')} aria-label={t('tree.retry')} onClick={() => setAttempt(value => value + 1)}/></div>}
    <main className={`commit-tree-body${previewOpen ? ' with-preview' : ''}`}><div className="revision-tree-rows commit-tree-rows" role="tree" aria-label={t('tree.fullRepositoryTree')}>
      <VirtualFileRows items={rows} getKey={row => row.node.id} scrollParent=".commit-tree-rows" estimateSize={26} focusSelector=".revision-tree-entry">{({ node, depth, guides, last }) => {
        const entry = node.entry, folder = entry.type === 'tree', opened = expanded.has(node.id);
        return <div className={`revision-tree-row${selected === node.id ? ' selected' : ''}`} role="treeitem" aria-level={depth + 1} aria-expanded={folder ? opened : undefined} aria-selected={selected === node.id} onContextMenu={event => { event.preventDefault(); setMenu({ entry, x: event.clientX, y: event.clientY, anchor: event.currentTarget }); }}>
          <button className="revision-tree-entry" title={`${entry.path} · ${entry.type === 'gitlink' ? entry.oid : entry.mode}`} onClick={() => openEntry(entry)} onDoubleClick={() => { if (!folder && entry.type !== 'gitlink') void rpc('openRevision', repoId, { revision, path: entry.path }).catch(fail); }} onKeyDown={event => { if (event.key === 'ArrowRight' && folder && !opened || event.key === 'ArrowLeft' && folder && opened) { event.preventDefault(); openEntry(entry); } }}>
            {!query && <span className="snapshot-guides" aria-hidden="true">{guides.map((line, index) => <span key={index} className={line ? 'continuing' : ''}/>)}<span className={last ? 'branch last' : 'branch'}/></span>}<Icon name={folder ? opened ? 'chevron-down' : 'chevron-right' : 'blank'}/><Icon name={folder ? opened ? 'folder-opened' : 'folder' : entry.type === 'symlink' ? 'file-symlink-file' : entry.type === 'gitlink' ? 'file-submodule' : 'file'}/><span className="revision-tree-name">{query ? entry.path : entry.name}</span>
          </button>{entry.type === 'gitlink' && <span className="revision-tree-meta hash">{entry.oid.slice(0, 8)}</span>}
        </div>;
      }}</VirtualFileRows>{!rows.length && !loading && <div className="revision-tree-loading">{t(query ? 'tree.noMatches' : 'tree.emptyTree')}</div>}
    </div>{previewOpen && <div className="commit-tree-preview">{selectedEntry?.type === 'gitlink' ? <div className="revision-tree-loading">{t('tree.submodulePointer')} <span className="hash">{selectedEntry.oid}</span></div> : selectedEntry && <SnapshotPreview repoId={repoId} revision={revision} path={selectedEntry.path} onClose={() => setPreviewOpen(false)}/>}</div>}</main>
    {menu && <ContextMenu {...menu} caption={menu.entry.path} close={closeMenu} items={[
      ...(['blob', 'symlink'].includes(menu.entry.type) ? [{ label: t('tree.openHistoricalFile'), icon: 'go-to-file', run: () => { void rpc('openRevision', repoId, { revision, path: menu.entry.path }).catch(fail); } }] : []),
      { label: t('menus.copyPath'), icon: 'copy', run: () => copy(menu.entry.path) },
      { label: t('tree.copyObjectId'), icon: 'copy', run: () => copy(menu.entry.oid) },
    ]}/>}
  </div>;
}
