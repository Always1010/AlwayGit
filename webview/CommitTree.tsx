import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { CommitTreeTarget, RevisionTreeChanges, RevisionTreeCommit, RevisionTreeEntry, RevisionTreeListing } from '../src/protocol/tree';
import type { DiffTarget } from '../src/protocol/types';
import { rpc, saveCommitTreeState } from './rpc';
import { useWorkbenchFields } from './subscriptions';
import { useResolvedTheme, diffRowHeight } from './appearance';
import { useTranslation } from './i18n';
import { Button, Icon } from './ui';
import { VirtualFileRows } from './VirtualFileRows';
import { SnapshotPreview } from './SnapshotPreview';
import { DiffPreview } from './DiffPreview';
import { ContextMenu } from './ContextMenu';
import { allSnapshotNodes, changeCounts, snapshotCounts, snapshotNodes, snapshotRows, type SnapshotNode } from './commitTreeModel';
import { CommitTreeGraph } from './CommitTreeGraph';
import type { TreeViewMode } from './treeLayout';
import './commit-tree.css';
import { useTreeExpansion } from './useTreeExpansion';
import { TreeExpansionMemory } from './TreeExpansionMemory';
import { treeDirectoryExpanded } from '../src/protocol/tree-expansion';

export function CommitTree({ target: { repoId, revision, baseRevision } }: { target: CommitTreeTarget }) {
  const t = useTranslation(), preferences = useWorkbenchFields('appearance', 'layout', 'language');
  const theme = useResolvedTheme(preferences.appearance.theme);
  const [entries, setEntries] = useState<RevisionTreeEntry[]>([]), [indexed, setIndexed] = useState(false), [loading, setLoading] = useState(true);
  const [metadata, setMetadata] = useState<RevisionTreeCommit>(), [error, setError] = useState<string>(), [metadataError, setMetadataError] = useState<string>();
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<string>();
  const memory = useTreeExpansion(repoId);
  const [temporaryExpanded, setTemporaryExpanded] = useState<Set<string>>();
  const [previewOpen, setPreviewOpen] = useState(false), [expanding, setExpanding] = useState<number>();
  const [viewMode, setViewMode] = useState<TreeViewMode>('list');
  const indexController = useRef<AbortController | undefined>(undefined), expansionEpoch = useRef(0);
  const [attempt, setAttempt] = useState(0), [changeAttempt, setChangeAttempt] = useState(0);
  const [showChanges, setShowChanges] = useState(!!baseRevision), [selectedParent, setSelectedParent] = useState<string>();
  const [changes, setChanges] = useState<RevisionTreeChanges>(), [changesLoading, setChangesLoading] = useState(false), [changesError, setChangesError] = useState<string>();
  const [menu, setMenu] = useState<{ node: SnapshotNode; x: number; y: number; anchor: HTMLElement }>();
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const parent = baseRevision ?? selectedParent ?? metadata?.commit.parents[0], baselineReady = !!baseRevision || !!metadata;
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));
  const copy = (text: string) => void rpc('copyText', repoId, { text }).catch(fail);
  useEffect(() => {
    saveCommitTreeState({ commitTree: { repoId, revision, ...(baseRevision ? { baseRevision } : {}) } });
    document.documentElement.lang = preferences.language;
  }, [repoId, revision, baseRevision, preferences.language]);
  useEffect(() => {
    const controller = new AbortController(); indexController.current = controller;
    let live = true, complete = false;
    setLoading(true); setError(undefined); setIndexed(false); setEntries([]); setTemporaryExpanded(undefined);
    void rpc<RevisionTreeListing>('revisionTree', repoId, { revision }).then(result => { if (live && !complete) setEntries(result.entries); }).catch(() => {});
    void rpc<RevisionTreeListing>('revisionTreeIndex', repoId, { revision }, { signal: controller.signal }).then(result => {
      if (!live || controller.signal.aborted) return;
      complete = true; setEntries(result.entries); setIndexed(true);
    }).catch(error => { if (live) setError(controller.signal.aborted ? t('tree.indexCancelled') : error.message); }).finally(() => { if (live) setLoading(false); });
    void rpc<RevisionTreeCommit>('revisionTreeCommit', repoId, { revision }).then(result => { if (live) { setMetadata(result); setMetadataError(undefined); } }).catch(error => { if (live) setMetadataError(error.message); });
    return () => { live = false; controller.abort(); expansionEpoch.current++; };
  }, [repoId, revision, attempt]);
  useEffect(() => {
    const controller = new AbortController();
    setChanges(undefined); setChangesError(undefined); setChangesLoading(false);
    if (!showChanges || !baselineReady) return;
    setChangesLoading(true);
    const request = baseRevision
      ? rpc<RevisionTreeChanges>('revisionTreeCompare', repoId, { revision, baseRevision }, { signal: controller.signal })
      : rpc<RevisionTreeChanges>('revisionTreeChanges', repoId, { revision, ...(parent ? { parent } : {}) }, { signal: controller.signal });
    void request.then(result => {
      if (controller.signal.aborted) return;
      setChanges(result);
    }).catch(error => { if (!controller.signal.aborted) setChangesError(error.message); }).finally(() => { if (!controller.signal.aborted) setChangesLoading(false); });
    return () => controller.abort();
  }, [repoId, revision, baseRevision, parent, showChanges, baselineReady, changeAttempt]);
  const activeChanges = showChanges && changes?.revision === revision && (baseRevision ? changes.baseRevision === baseRevision : !changes.baseRevision && changes.parent === parent) ? changes : undefined;
  const nodes = useMemo(() => snapshotNodes(entries, activeChanges?.files), [entries, activeChanges]);
  const flatNodes = useMemo(() => allSnapshotNodes(nodes), [nodes]);
  const expanded = useMemo(() => new Set(flatNodes.filter(node => node.entry.type === 'tree' && (temporaryExpanded?.has(node.entry.path) || treeDirectoryExpanded(memory.preferences, node.entry.path, entries.length))).map(node => node.id)), [flatNodes, memory.preferences, temporaryExpanded, entries.length]);
  const directories = useMemo(() => new Set(entries.filter(entry => entry.type === 'tree').map(entry => entry.path)), [entries]);
  const rows = useMemo(() => snapshotRows(nodes, expanded, query), [nodes, expanded, query]);
  const counts = useMemo(() => snapshotCounts(entries), [entries]);
  const summary = useMemo(() => changeCounts(activeChanges?.files ?? []), [activeChanges]);
  const selectedNode = flatNodes.find(node => node.id === selected), selectedEntry = selectedNode?.entry;
  const diffTarget: DiffTarget | undefined = selectedNode?.change && activeChanges ? baseRevision
    ? { kind: 'comparison', left: baseRevision, right: revision, path: selectedNode.entry.path, previousPath: selectedNode.change.previousPath }
    : { kind: 'commit', treeComparison: true, oid: revision, path: selectedNode.entry.path, parent: activeChanges.parent, previousPath: selectedNode.change.previousPath } : undefined;
  const stopExpansion = () => { expansionEpoch.current++; setExpanding(undefined); };
  const expandAll = async () => {
    const epoch = ++expansionEpoch.current, folders = flatNodes.filter(node => node.entry.type === 'tree').map(node => node.entry.path), next = new Set(flatNodes.filter(node => expanded.has(node.id)).map(node => node.entry.path));
    setQuery(''); setExpanding(0);
    for (let offset = 0; offset < folders.length; offset += 500) {
      if (epoch !== expansionEpoch.current) return;
      folders.slice(offset, offset + 500).forEach(id => next.add(id));
      setTemporaryExpanded(new Set(next)); setExpanding(Math.min(offset + 500, folders.length));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (epoch === expansionEpoch.current) { memory.setMode('expanded'); setTemporaryExpanded(undefined); setExpanding(undefined); }
  };
  const collapse = () => { stopExpansion(); setQuery(''); setTemporaryExpanded(undefined); memory.setMode('collapsed'); };
  const expandChanges = () => { stopExpansion(); setQuery(''); setTemporaryExpanded(current => new Set([...(current ?? []), ...flatNodes.filter(node => node.entry.type === 'tree' && node.summary).map(node => node.entry.path)])); };
  const openEntry = (node: SnapshotNode) => {
    const entry = node.entry;
    if (entry.type === 'tree') {
      stopExpansion();
      const opened = !expanded.has(node.id);
      setTemporaryExpanded(current => { if (!current?.has(entry.path)) return current; const next = new Set(current); next.delete(entry.path); return next; });
      memory.setDirectory(entry.path, opened);
      if (!indexed && !node.deleted) void rpc<RevisionTreeListing>('revisionTree', repoId, { revision, path: entry.path }).then(result => setEntries(current => { const byPath = new Map(current.map(item => [item.path, item])); result.entries.forEach(item => byPath.set(item.path, item)); return [...byPath.values()]; })).catch(fail);
    } else { setSelected(node.id); setPreviewOpen(true); }
  };
  const openHistorical = (node: SnapshotNode) => {
    const at = node.deleted ? baseRevision ?? activeChanges?.parent : revision;
    if (at) void rpc('openRevision', repoId, { revision: at, path: node.entry.path }).catch(fail);
  };
  const statusName = (status: string) => t(status[0] === 'A' ? 'tree.statusAdded' : status[0] === 'D' ? 'tree.statusDeleted' : status[0] === 'R' ? 'tree.statusRenamed' : status[0] === 'C' ? 'tree.statusCopied' : status[0] === 'T' ? 'tree.statusTypeChanged' : 'tree.statusModified');
  const nodeHint = (node: SnapshotNode) => [node.entry.path, node.change && statusName(node.change.status), node.change?.previousPath && t('tree.fromPath', { path: node.change.previousPath }), node.change && `${node.change.beforeMode} → ${node.change.afterMode}`, node.deleted && t('tree.virtualDeleted'), node.summary && t('tree.changeSummary', node.summary)].filter(Boolean).join(' · ');
  return <div className="workbench commit-tree-page" data-theme={theme} style={{ '--workbench-font': `${preferences.layout.font}px`, '--file-row-height': '26px', '--diff-font': `${preferences.appearance.codeFont}px`, '--diff-row-height': `${diffRowHeight(preferences.appearance.codeFont, preferences.appearance.codeRowHeight)}px` } as CSSProperties}>
    <header className="commit-tree-header">
      <div><Icon name="list-tree"/><strong>{t(baseRevision ? 'treeCompare.title' : 'tree.snapshotTitle')}</strong><span className="hash" title={revision}>{revision.slice(0, 8)}</span><Button className="icon-only" icon="copy" title={t('tree.copyCommitId')} aria-label={t('tree.copyCommitId')} onClick={() => copy(revision)}/></div>
      {baseRevision && <div className="commit-tree-direction"><span className="hash" title={`${baseRevision} → ${revision}`}>{t('treeCompare.direction', { base: baseRevision.slice(0, 8), target: revision.slice(0, 8) })}</span><Button className="icon-only" icon="arrow-swap" title={t('treeCompare.reverse')} aria-label={t('treeCompare.reverse')} onClick={() => void rpc('openCommitTree', repoId, { revision: baseRevision, baseRevision: revision }).catch(fail)}/></div>}
      {metadata && <><strong className="truncate" title={metadata.body}>{metadata.commit.subject}</strong><span className="muted">{metadata.commit.author} · {new Date(metadata.commit.timestamp * 1000).toLocaleString(preferences.language)}</span></>}
      <span className="muted" title={metadata?.repository.root}>{metadata ? `${metadata.repository.name} · ${metadata.repository.root}` : repoId}</span>
    </header>
    <div className="revision-tree-toolbar commit-tree-toolbar">
      <select className="commit-tree-view-select" aria-label={t('treeViews.presentation')} value={viewMode} onChange={event => { setMenu(undefined); setViewMode(event.target.value as TreeViewMode); }}>
        <option value="list">{t('treeViews.list')}</option><option value="horizontal">{t('treeViews.horizontal')}</option><option value="radial">{t('treeViews.radial')}</option><option value="vertical">{t('treeViews.vertical')}</option>
      </select>
      <label className="file-path-filter"><Icon name="search"/><input type="search" disabled={!indexed} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('tree.searchAllPathsPlaceholder')} aria-label={t('tree.searchAllPaths')}/></label>
      <Button className="icon-only" icon="expand-all" title={t('tree.expandAll')} aria-label={t('tree.expandAll')} disabled={!indexed || expanding !== undefined} onClick={() => void expandAll()}/><Button className="icon-only" icon="collapse-all" title={t('tree.collapseAll')} aria-label={t('tree.collapseAll')} onClick={collapse}/>
      <label className="commit-tree-changes-toggle"><input type="checkbox" checked={showChanges} disabled={!indexed} onChange={event => { stopExpansion(); setMenu(undefined); setShowChanges(event.target.checked); }}/>{t(baseRevision ? 'treeCompare.showChanges' : 'tree.showChanges')}</label>
      {showChanges && <Button className="icon-only" icon="list-selection" title={t('tree.expandChanges')} aria-label={t('tree.expandChanges')} disabled={!activeChanges} onClick={expandChanges}/>}
      <TreeExpansionMemory preferences={memory.preferences} directories={directories} indexed={indexed} loading={memory.loading} error={memory.error} reload={memory.reload} remove={path => { stopExpansion(); setTemporaryExpanded(undefined); memory.remove(path); }} setMode={mode => { stopExpansion(); setTemporaryExpanded(undefined); memory.setMode(mode); }} reset={() => { stopExpansion(); setTemporaryExpanded(undefined); memory.reset(); }}/>
      <Button className="icon-only" icon="open-preview" title={t('tree.togglePreview')} aria-label={t('tree.togglePreview')} aria-pressed={previewOpen} onClick={() => setPreviewOpen(value => !value)}/>
    </div>
    <div className="revision-tree-status" role="status">
      {indexed ? t('tree.snapshotCount', counts) : t(loading ? 'tree.indexing' : 'tree.indexIncomplete')}{query && ` · ${t('tree.matches', { count: rows.length })}`}
      {loading && <Button className="icon-only" icon="close" title={t('tree.cancelLoading')} aria-label={t('tree.cancelLoading')} onClick={() => indexController.current?.abort()}/>}
      {expanding !== undefined && <>{t('tree.expanding', { count: expanding })}<Button className="icon-only" icon="close" title={t('tree.cancelExpand')} aria-label={t('tree.cancelExpand')} onClick={stopExpansion}/></>}
    </div>
    {showChanges && <div className="commit-tree-change-info">
      <div className="commit-tree-baseline"><span>{t('tree.comparisonBase')}</span>{!baseRevision && metadata && metadata.commit.parents.length > 1 ? <select aria-label={t('tree.comparisonBase')} value={parent} onChange={event => { stopExpansion(); setMenu(undefined); setSelectedParent(event.target.value); }}>{metadata.commit.parents.map((oid, index) => <option key={oid} value={oid}>{t('tree.parentOption', { index: index + 1, oid: oid.slice(0, 8) })}</option>)}</select> : <span className="hash" title={parent}>{parent ? parent.slice(0, 8) : metadata ? t('tree.emptyBase') : '…'}</span>}</div>
      {changesLoading ? <span role="status">{t('tree.loadingChanges')}</span> : changesError ? <div className="revision-tree-error" role="alert">{t('tree.changesUnavailable')} {changesError}<Button className="icon-only" icon="refresh" title={t('tree.retry')} aria-label={t('tree.retry')} onClick={() => setChangeAttempt(value => value + 1)}/></div> : activeChanges && <><span>{t('tree.changeSummary', summary)}</span><span className="muted">{t('tree.deletedCountHint')}</span></>}
    </div>}
    {(error || metadataError) && <div className="revision-tree-error" role="alert">{error || metadataError}<Button className="icon-only" icon="refresh" title={t('tree.retry')} aria-label={t('tree.retry')} onClick={() => setAttempt(value => value + 1)}/></div>}
    <main className={`commit-tree-body${previewOpen ? ' with-preview' : ''}`}>
      {viewMode === 'list' ? <div className="revision-tree-rows commit-tree-rows" role="tree" aria-label={t('tree.fullRepositoryTree')}>
        <VirtualFileRows items={rows} getKey={row => row.node.id} scrollParent=".commit-tree-rows" estimateSize={26} focusSelector=".revision-tree-entry">{({ node, depth, guides, last, changeHighlight }) => {
          const entry = node.entry, folder = entry.type === 'tree', opened = expanded.has(node.id), status = node.change?.status[0];
          return <div className={`revision-tree-row${selected === node.id ? ' selected' : ''}${node.deleted ? ' snapshot-deleted' : ''}`} data-status={status} data-change-highlight={changeHighlight} role="treeitem" aria-label={nodeHint(node)} aria-level={query ? 1 : depth + 1} aria-expanded={folder ? opened : undefined} aria-selected={selected === node.id} onContextMenu={event => { event.preventDefault(); setMenu({ node, x: event.clientX, y: event.clientY, anchor: event.currentTarget }); }}>
            <button className="revision-tree-entry" title={nodeHint(node)} onClick={() => openEntry(node)} onDoubleClick={() => { if (!folder && entry.type !== 'gitlink') openHistorical(node); }} onKeyDown={event => {
              if (event.key === 'ArrowRight' && folder && !opened || event.key === 'ArrowLeft' && folder && opened) { event.preventDefault(); openEntry(node); }
              if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ node, x: rect.left + 24, y: rect.bottom, anchor: event.currentTarget }); }
            }}>
              {!query && <span className="snapshot-guides" aria-hidden="true">{guides.map((line, index) => <span key={index} className={line ? 'continuing' : ''}/>)}<span className={last ? 'branch last' : 'branch'}/></span>}
              <Icon name={folder ? opened ? 'chevron-down' : 'chevron-right' : 'blank'}/><Icon name={folder ? opened ? 'folder-opened' : 'folder' : entry.type === 'symlink' ? 'file-symlink-file' : entry.type === 'gitlink' ? 'file-submodule' : 'file'}/><span className="revision-tree-name">{query ? entry.path : entry.name}</span>
            </button>
            {node.change?.previousPath && <span className="snapshot-origin" title={nodeHint(node)}>← {node.change.previousPath}</span>}
            {node.deleted && <span className="snapshot-deleted-label">{t(folder ? 'tree.deletedDirectory' : 'tree.virtualDeleted')}</span>}
            {node.summary && <span className="snapshot-directory-status" title={t('tree.changeSummary', node.summary)} aria-label={t('tree.changeSummary', node.summary)}><Icon name="circle-filled"/><span>{Object.values(node.summary).reduce((sum, count) => sum + count, 0)}</span></span>}
            {status && <span className={`snapshot-badge status-${status}`} title={statusName(status)} aria-label={statusName(status)}>{status}</span>}
            {entry.type === 'gitlink' && <span className="revision-tree-meta hash" title={entry.oid}>{entry.oid.slice(0, 8)}</span>}
          </div>;
        }}</VirtualFileRows>
        {!rows.length && !loading && indexed && <div className="revision-tree-loading">{t(query ? 'tree.noMatches' : 'tree.emptyTree')}</div>}
      </div> : <CommitTreeGraph rows={rows} mode={viewMode} query={query} expanded={expanded} selected={selected} nodeHint={nodeHint} statusName={statusName} openEntry={openEntry} openHistorical={openHistorical} context={(node, x, y, anchor) => setMenu({ node, x, y, anchor })} useList={() => setViewMode('list')}/>}
      {previewOpen && <div className="commit-tree-preview">
        {selectedEntry?.type === 'gitlink' ? <div className="revision-tree-loading">{t('tree.submodulePointer')} <span className="hash">{selectedEntry.oid}</span></div> : diffTarget ? <div className="commit-tree-diff"><div className="commit-tree-diff-mode"><span>{t('tree.changePreview')}</span><Button className="icon-only" icon="close" title={t('tree.closePreview')} aria-label={t('tree.closePreview')} onClick={() => setPreviewOpen(false)}/></div><DiffPreview isolated={{ repoId, target: diffTarget, hideEdit: true }} native={() => void rpc('diff', repoId, diffTarget).catch(fail)} edit={() => {}}/></div> : selectedEntry && !selectedNode?.deleted ? <SnapshotPreview repoId={repoId} revision={revision} path={selectedEntry.path} onClose={() => setPreviewOpen(false)}/> : <div className="revision-tree-loading">{t('tree.selectFile')}</div>}
      </div>}
    </main>
    {menu && <ContextMenu x={menu.x} y={menu.y} anchor={menu.anchor} caption={menu.node.entry.path} close={closeMenu} items={[
      ...(['blob', 'symlink'].includes(menu.node.entry.type) ? [{ label: t('tree.openHistoricalFile'), icon: 'go-to-file', run: () => openHistorical(menu.node) }] : []),
      { label: t('menus.copyPath'), icon: 'copy', run: () => copy(menu.node.entry.path) },
      ...(menu.node.entry.oid ? [{ label: t('tree.copyObjectId'), icon: 'copy', run: () => copy(menu.node.entry.oid) }] : []),
    ]}/>}
  </div>;
}
