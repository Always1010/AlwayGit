import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type {
  CommitTreeTarget,
  RevisionTreeChanges,
  RevisionTreeCommit,
  RevisionTreeEntry,
  RevisionTreeListing,
} from '../src/protocol/tree';
import type { DiffTarget } from '../src/protocol/types';
import { rpc } from './rpc';
import { useCommitTreeState } from './useCommitTreeState';
import { TreeDefaultsDialog } from './TreeDefaultsSettings';
import { readTreeDefaults } from '../src/protocol/tree-settings';
import { useWorkbenchFields } from './subscriptions';
import { useResolvedTheme, diffRowHeight } from './appearance';
import { useTranslation } from './i18n';
import { Button, Icon, ResizeHandle } from './ui';
import { VirtualFileRows } from './VirtualFileRows';
import { SnapshotPreview } from './SnapshotPreview';
import { DiffPreview } from './DiffPreview';
import { ContextMenu } from './ContextMenu';
import {
  allSnapshotNodes,
  changeCounts,
  snapshotCounts,
  snapshotNodes,
  snapshotRows,
  type SnapshotNode,
} from './commitTreeModel';
import { CommitTreeGraph } from './CommitTreeGraph';
import type { TreeViewMode } from './treeLayout';
import './commit-tree.css';
import { useTreeExpansion } from './useTreeExpansion';
import { treeDirectoryExpanded } from '../src/protocol/tree-expansion';

interface ChangeFocus {
  key: string;
  expanded: ReadonlySet<string>;
}

export function CommitTree({
  target: { repoId, revision, baseRevision },
}: {
  target: CommitTreeTarget;
}) {
  const t = useTranslation(),
    preferences = useWorkbenchFields(
      'appearance',
      'layout',
      'language',
      'treeWheelMode',
      'treeDefaults',
    );
  const theme = useResolvedTheme(preferences.appearance.theme);
  const pageState = useCommitTreeState({ repoId, revision, baseRevision }),
    { initial, update: saveView } = pageState;
  const panelId = useId(),
    detailsId = `${panelId}-details`,
    statisticsId = `${panelId}-statistics`,
    actionsId = `${panelId}-actions`;
  const [entries, setEntries] = useState<RevisionTreeEntry[]>([]),
    [indexed, setIndexed] = useState(false),
    [loading, setLoading] = useState(true);
  const [metadata, setMetadata] = useState<RevisionTreeCommit>(),
    [error, setError] = useState<string>(),
    [metadataError, setMetadataError] = useState<string>();
  const [query, setQuery] = useState(initial.query ?? ''),
    [selected, setSelected] = useState(initial.selected);
  const memory = useTreeExpansion(repoId, initial.expansion, true);
  const [hintDismissed, setHintDismissed] = useState<boolean>(),
    [hintBusy, setHintBusy] = useState(true),
    [hintError, setHintError] = useState<string>();
  const [hintAttempt, setHintAttempt] = useState(0),
    hintLive = useRef(true);
  useEffect(() => {
    hintLive.current = true;
    let live = true;
    setHintBusy(true);
    setHintError(undefined);
    void rpc<boolean>('treeExpansionHintRead')
      .then((dismissed) => {
        if (live) setHintDismissed(dismissed);
      })
      .catch((cause) => {
        if (live) setHintError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (live) setHintBusy(false);
      });
    return () => {
      live = false;
      hintLive.current = false;
    };
  }, [hintAttempt]);
  const dismissHint = async () => {
    if (hintBusy) return;
    setHintBusy(true);
    setHintError(undefined);
    try {
      await rpc<boolean>('treeExpansionHintDismiss');
      if (hintLive.current) setHintDismissed(true);
    } catch (cause) {
      if (hintLive.current) setHintError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (hintLive.current) setHintBusy(false);
    }
  };
  const [temporaryExpanded, setTemporaryExpanded] = useState<Set<string>>();
  const [focusedChanges, setFocusedChanges] = useState<ChangeFocus>();
  const [changesOnly, setChangesOnly] = useState(initial.changesOnly ?? false);
  const [fitRequest, setFitRequest] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(initial.previewOpen ?? false),
    [expanding, setExpanding] = useState<number>();
  const [viewMode, setViewMode] = useState<TreeViewMode>(initial.viewMode ?? 'list');
  const [wheelMode, setWheelMode] = useState(initial.wheelMode ?? preferences.treeWheelMode);
  const [settingsDraft, setSettingsDraft] = useState(initial.settingsDraft);
  const body = useRef<HTMLElement>(null);
  const [bodySize, setBodySize] = useState({ width: 0, height: 0, stacked: false });
  const [previewSplit, setPreviewSplit] = useState(initial.previewSplit ?? {});
  const list = useRef<HTMLDivElement>(null);
  const restoreList = useRef(initial.listScroll);
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setBodySize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
        stacked: window.matchMedia('(max-width: 650px)').matches,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const splitAxis = bodySize.stacked ? 'y' : 'x',
    splitAvailable = Math.max(0, (bodySize.stacked ? bodySize.height : bodySize.width) - 6),
    splitMin = Math.min(
      bodySize.stacked ? 120 : viewMode === 'list' ? 180 : 220,
      splitAvailable / 2,
    ),
    splitMax = splitAvailable - Math.min(bodySize.stacked ? 120 : 220, splitAvailable / 2),
    splitSize = Math.max(
      splitMin,
      Math.min(
        splitMax,
        splitAvailable *
          (previewSplit[splitAxis] ?? (bodySize.stacked ? 0.5 : viewMode === 'list' ? 0.44 : 0.54)),
      ),
    );
  const indexController = useRef<AbortController | undefined>(undefined),
    expansionEpoch = useRef(0);
  const [attempt, setAttempt] = useState(0),
    [changeAttempt, setChangeAttempt] = useState(0);
  const [showChanges, setShowChanges] = useState(
      initial.changesOnly || (initial.showChanges ?? !!baseRevision),
    ),
    [selectedParent, setSelectedParent] = useState(initial.selectedParent);
  const [changes, setChanges] = useState<RevisionTreeChanges>(),
    [changesLoading, setChangesLoading] = useState(false),
    [changesError, setChangesError] = useState<string>();
  const [menu, setMenu] = useState<{
    node: SnapshotNode;
    x: number;
    y: number;
    anchor: HTMLElement;
  }>();
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const parent = baseRevision ?? selectedParent ?? metadata?.commit.parents[0],
    baselineReady = !!baseRevision || !!metadata;
  const comparisonKey = JSON.stringify([repoId, revision, baseRevision, parent]);
  useEffect(() => {
    document.documentElement.lang = preferences.language;
  }, [preferences.language]);
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));
  const copy = (text: string) => void rpc('copyText', repoId, { text }).catch(fail);
  useLayoutEffect(() => {
    saveView({
      viewMode,
      showChanges,
      changesOnly,
      wheelMode,
      settingsDraft,
      query,
      selected,
      selectedParent,
      previewOpen,
      previewSplit,
      ...(!memory.loading || initial.expansion ? { expansion: memory.preferences } : {}),
      ...(focusedChanges?.key === comparisonKey
        ? { changeExpanded: [...focusedChanges.expanded] }
        : {}),
    });
  }, [
    viewMode,
    showChanges,
    changesOnly,
    wheelMode,
    settingsDraft,
    query,
    selected,
    selectedParent,
    previewOpen,
    previewSplit,
    memory.preferences,
    memory.loading,
    focusedChanges,
    comparisonKey,
    saveView,
  ]);
  useEffect(() => {
    const controller = new AbortController();
    indexController.current = controller;
    let live = true,
      complete = false;
    setLoading(true);
    setError(undefined);
    setIndexed(false);
    setEntries([]);
    setTemporaryExpanded(undefined);
    void rpc<RevisionTreeListing>('revisionTree', repoId, { revision })
      .then((result) => {
        if (live && !complete) setEntries(result.entries);
      })
      .catch(() => {});
    void rpc<RevisionTreeListing>(
      'revisionTreeIndex',
      repoId,
      { revision },
      { signal: controller.signal },
    )
      .then((result) => {
        if (!live || controller.signal.aborted) return;
        complete = true;
        setEntries(result.entries);
        setIndexed(true);
      })
      .catch((error) => {
        if (live) setError(controller.signal.aborted ? t('tree.indexCancelled') : error.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    void rpc<RevisionTreeCommit>('revisionTreeCommit', repoId, { revision })
      .then((result) => {
        if (live) {
          setMetadata(result);
          setSelectedParent((current) =>
            current && result.commit.parents.includes(current) ? current : undefined,
          );
          setMetadataError(undefined);
        }
      })
      .catch((error) => {
        if (live) setMetadataError(error.message);
      });
    return () => {
      live = false;
      controller.abort();
      expansionEpoch.current++;
    };
  }, [repoId, revision, attempt]);
  useEffect(() => {
    const controller = new AbortController();
    setChanges(undefined);
    setChangesError(undefined);
    setChangesLoading(false);
    if (!showChanges || !baselineReady) return;
    setChangesLoading(true);
    const request = baseRevision
      ? rpc<RevisionTreeChanges>(
          'revisionTreeCompare',
          repoId,
          { revision, baseRevision },
          { signal: controller.signal },
        )
      : rpc<RevisionTreeChanges>(
          'revisionTreeChanges',
          repoId,
          { revision, ...(parent ? { parent } : {}) },
          { signal: controller.signal },
        );
    void request
      .then((result) => {
        if (controller.signal.aborted) return;
        setChanges(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setChangesError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setChangesLoading(false);
      });
    return () => controller.abort();
  }, [repoId, revision, baseRevision, parent, showChanges, baselineReady, changeAttempt]);
  const activeChanges =
    showChanges &&
    changes?.revision === revision &&
    (baseRevision
      ? changes.baseRevision === baseRevision
      : !changes.baseRevision && changes.parent === parent)
      ? changes
      : undefined;
  const treeDataReady =
    indexed && (!showChanges || !!activeChanges || !!changesError || !!metadataError);
  const nodes = useMemo(
    () => snapshotNodes(entries, activeChanges?.files),
    [entries, activeChanges],
  );
  const flatNodes = useMemo(() => allSnapshotNodes(nodes), [nodes]);
  const changeFocus = useMemo(() => {
    if (!activeChanges || !changesOnly) return undefined;
    if (focusedChanges?.key === comparisonKey) return focusedChanges;
    return {
      key: comparisonKey,
      expanded: new Set(
        pageState.saved.current.view?.changeExpanded ??
          flatNodes
            .filter((node) => node.entry.type === 'tree' && node.summary)
            .map((node) => node.id),
      ),
    };
  }, [activeChanges, changesOnly, focusedChanges, comparisonKey, flatNodes]);
  const expanded = useMemo(
    () =>
      changeFocus?.expanded ??
      new Set(
        flatNodes
          .filter(
            (node) =>
              node.entry.type === 'tree' &&
              (temporaryExpanded?.has(node.entry.path) ||
                treeDirectoryExpanded(memory.preferences, node.entry.path, entries.length)),
          )
          .map((node) => node.id),
      ),
    [flatNodes, memory.preferences, temporaryExpanded, entries.length, changeFocus],
  );
  const rows = useMemo(
    () =>
      changesOnly && !activeChanges && !query.trim()
        ? []
        : snapshotRows(nodes, expanded, query, {
            changesOnly: !!changeFocus,
          }),
    [nodes, expanded, query, changeFocus, changesOnly, activeChanges],
  );
  const counts = useMemo(() => snapshotCounts(entries), [entries]);
  useLayoutEffect(() => {
    if (!treeDataReady || memory.loading || !list.current) return;
    const saved = restoreList.current ?? pageState.saved.current.view?.listScroll;
    if (saved) {
      list.current.scrollTop = saved.top;
      list.current.scrollLeft = saved.left;
    }
    restoreList.current = undefined;
  }, [treeDataReady, memory.loading, viewMode]);
  const summary = useMemo(() => changeCounts(activeChanges?.files ?? []), [activeChanges]);
  const selectedNode = flatNodes.find((node) => node.id === selected),
    selectedEntry = selectedNode?.entry;
  const diffTarget: DiffTarget | undefined =
    selectedNode?.change && activeChanges
      ? baseRevision
        ? {
            kind: 'comparison',
            left: baseRevision,
            right: revision,
            path: selectedNode.entry.path,
            previousPath: selectedNode.change.previousPath,
          }
        : {
            kind: 'commit',
            treeComparison: true,
            oid: revision,
            path: selectedNode.entry.path,
            parent: activeChanges.parent,
            previousPath: selectedNode.change.previousPath,
          }
      : undefined;
  const previewKey = JSON.stringify([revision, baseRevision, parent, selected, !!diffTarget]);
  const reading = {
    value:
      pageState.saved.current.view?.preview?.key === previewKey
        ? pageState.saved.current.view.preview
        : undefined,
    onChange: (value: Omit<import('../src/protocol/tree').TreePreviewState, 'key'>) =>
      saveView({ preview: { key: previewKey, ...value } }),
  };
  const stopExpansion = () => {
    expansionEpoch.current++;
    setExpanding(undefined);
  };
  const expandAll = async () => {
    const epoch = ++expansionEpoch.current,
      folders = flatNodes
        .filter((node) => node.entry.type === 'tree')
        .map((node) => node.entry.path),
      next = new Set(
        flatNodes.filter((node) => expanded.has(node.id)).map((node) => node.entry.path),
      );
    setQuery('');
    setFocusedChanges(undefined);
    setChangesOnly(false);
    setExpanding(0);
    for (let offset = 0; offset < folders.length; offset += 500) {
      if (epoch !== expansionEpoch.current) return;
      folders.slice(offset, offset + 500).forEach((id) => next.add(id));
      setTemporaryExpanded(new Set(next));
      setExpanding(Math.min(offset + 500, folders.length));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (epoch === expansionEpoch.current) {
      memory.setMode('expanded');
      setTemporaryExpanded(undefined);
      setExpanding(undefined);
    }
  };
  const collapse = () => {
    stopExpansion();
    setQuery('');
    setFocusedChanges(undefined);
    setChangesOnly(false);
    setTemporaryExpanded(undefined);
    memory.setMode('collapsed');
  };
  const expandChanges = () => {
    stopExpansion();
    setQuery('');
    setTemporaryExpanded(undefined);
    setChangesOnly(!changesOnly);
    saveView({ changeExpanded: undefined });
    setFocusedChanges(
      changesOnly
        ? undefined
        : {
            key: comparisonKey,
            expanded: new Set(
              flatNodes
                .filter((node) => node.entry.type === 'tree' && node.summary)
                .map((node) => node.id),
            ),
          },
    );
    setFitRequest((value) => value + 1);
  };
  const openEntry = (node: SnapshotNode) => {
    const entry = node.entry;
    if (entry.type === 'tree') {
      stopExpansion();
      const opened = !expanded.has(node.id);
      if (changeFocus) {
        const next = new Set(changeFocus.expanded);
        if (opened) next.add(node.id);
        else next.delete(node.id);
        setFocusedChanges({ ...changeFocus, expanded: next });
        return;
      }
      setTemporaryExpanded((current) => {
        if (!current?.has(entry.path)) return current;
        const next = new Set(current);
        next.delete(entry.path);
        return next;
      });
      memory.setDirectory(entry.path, opened);
      if (!indexed && !node.deleted)
        void rpc<RevisionTreeListing>('revisionTree', repoId, { revision, path: entry.path })
          .then((result) =>
            setEntries((current) => {
              const byPath = new Map(current.map((item) => [item.path, item]));
              result.entries.forEach((item) => byPath.set(item.path, item));
              return [...byPath.values()];
            }),
          )
          .catch(fail);
    } else {
      setSelected(node.id);
      setPreviewOpen(true);
    }
  };
  const openHistorical = (node: SnapshotNode) => {
    const at = node.deleted ? (baseRevision ?? activeChanges?.parent) : revision;
    if (at) void rpc('openRevision', repoId, { revision: at, path: node.entry.path }).catch(fail);
  };
  const statusName = (status: string) =>
    t(
      status[0] === 'A'
        ? 'tree.statusAdded'
        : status[0] === 'D'
          ? 'tree.statusDeleted'
          : status[0] === 'R'
            ? 'tree.statusRenamed'
            : status[0] === 'C'
              ? 'tree.statusCopied'
              : status[0] === 'T'
                ? 'tree.statusTypeChanged'
                : 'tree.statusModified',
    );
  const nodeHint = (node: SnapshotNode) =>
    [
      node.entry.path,
      node.change && statusName(node.change.status),
      node.change?.previousPath && t('tree.fromPath', { path: node.change.previousPath }),
      node.change && `${node.change.beforeMode} → ${node.change.afterMode}`,
      node.deleted && t('tree.virtualDeleted'),
      node.summary && t('tree.changeSummary', node.summary),
    ]
      .filter(Boolean)
      .join(' · ');
  const changeTotal = Object.values(summary).reduce((sum, count) => sum + count, 0);
  const snapshotLabel =
    t('tree.compactFiles', { count: counts.files }) +
    (counts.submodules ? ` · ${t('tree.compactSubmodules', { count: counts.submodules })}` : '');
  const actions = (withLabels: boolean) => (
    <>
      <Button
        className={withLabels ? '' : 'icon-only'}
        icon="expand-all"
        title={t('tree.expandAll')}
        aria-label={t('tree.expandAll')}
        disabled={!indexed || expanding !== undefined}
        onClick={() => void expandAll()}
      >
        {withLabels && t('tree.expandAll')}
      </Button>
      <Button
        className={withLabels ? '' : 'icon-only'}
        icon="collapse-all"
        title={t('tree.collapseAll')}
        aria-label={t('tree.collapseAll')}
        onClick={collapse}
      >
        {withLabels && t('tree.collapseAll')}
      </Button>
      {showChanges && (
        <Button
          className={`commit-tree-focus-changes${withLabels ? '' : ' icon-only'}`}
          icon="list-selection"
          title={t('tree.expandChanges')}
          aria-label={t('tree.expandChanges')}
          aria-pressed={changesOnly}
          disabled={!indexed || !activeChanges || !changeTotal}
          onClick={expandChanges}
        >
          {withLabels && t('tree.expandChanges')}
        </Button>
      )}
      <span
        className="commit-tree-memory-info"
        tabIndex={0}
        role="img"
        title={t('treeMemory.info')}
        aria-label={t('treeMemory.info')}
      >
        <Icon name="info" />
        {withLabels && t('treeMemory.info')}
      </span>
      <Button
        className={withLabels ? '' : 'icon-only'}
        icon="open-preview"
        title={t('tree.togglePreview')}
        aria-label={t('tree.togglePreview')}
        aria-pressed={previewOpen}
        onClick={() => setPreviewOpen((value) => !value)}
      >
        {withLabels && t('tree.togglePreview')}
      </Button>
      <Button
        className={withLabels ? '' : 'icon-only'}
        icon="settings-gear"
        title={t('treeSettings.title')}
        aria-label={t('treeSettings.title')}
        onClick={() => setSettingsDraft(readTreeDefaults(preferences.treeDefaults))}
      >
        {withLabels && t('treeSettings.title')}
      </Button>
    </>
  );
  return (
    <div
      className="workbench commit-tree-page"
      onPointerDownCapture={pageState.resume}
      onKeyDownCapture={pageState.resume}
      onWheelCapture={pageState.resume}
      onInputCapture={pageState.resume}
      data-theme={theme}
      style={
        {
          '--workbench-font': `${preferences.layout.font}px`,
          '--file-row-height': '26px',
          '--diff-font': `${preferences.appearance.codeFont}px`,
          '--diff-row-height': `${diffRowHeight(preferences.appearance.codeFont, preferences.appearance.codeRowHeight)}px`,
        } as CSSProperties
      }
    >
      <header className="commit-tree-header">
        <div className="commit-tree-identity">
          <Icon name="list-tree" />
          <strong className="commit-tree-title">
            {t(baseRevision ? 'treeCompare.title' : 'tree.snapshotTitle')}
          </strong>
          <span
            className="hash commit-tree-direction"
            title={
              baseRevision
                ? t('treeCompare.direction', { base: baseRevision, target: revision })
                : revision
            }
            aria-label={
              baseRevision
                ? t('treeCompare.direction', { base: baseRevision, target: revision })
                : revision
            }
          >
            {baseRevision && <>{baseRevision.slice(0, 8)} → </>}
            {revision.slice(0, 8)}
          </span>
          {baseRevision ? (
            <Button
              className="icon-only"
              icon="arrow-swap"
              title={t('treeCompare.reverse')}
              aria-label={t('treeCompare.reverse')}
              onClick={() =>
                void rpc('openCommitTree', repoId, {
                  revision: baseRevision,
                  baseRevision: revision,
                }).catch(fail)
              }
            />
          ) : (
            <Button
              className="icon-only"
              icon="copy"
              title={t('tree.copyCommitId')}
              aria-label={t('tree.copyCommitId')}
              onClick={() => copy(revision)}
            />
          )}
        </div>
        {metadata && (
          <strong className="commit-tree-subject truncate" title={metadata.body}>
            {metadata.commit.subject}
          </strong>
        )}
        <span
          className="commit-tree-repository muted truncate"
          title={metadata?.repository.root ?? repoId}
        >
          {metadata?.repository.name ?? repoId}
        </span>
        <Button
          className="icon-only"
          icon="ellipsis"
          title={t('tree.details')}
          aria-label={t('tree.details')}
          popoverTarget={detailsId}
        />
      </header>
      <div
        id={detailsId}
        popover="auto"
        className="commit-tree-popover"
        role="dialog"
        aria-label={t('tree.details')}
      >
        <div className="commit-tree-popover-heading">
          <strong>{t('tree.details')}</strong>
          <Button
            className="icon-only"
            icon="close"
            title={t('common.close')}
            aria-label={t('common.close')}
            popoverTarget={detailsId}
            popoverTargetAction="hide"
          />
        </div>
        {metadata && (
          <>
            <pre className="commit-tree-message">{metadata.body || metadata.commit.subject}</pre>
            <p className="muted">
              {metadata.commit.author} ·{' '}
              {new Date(metadata.commit.timestamp * 1000).toLocaleString(preferences.language)}
            </p>
          </>
        )}
        <p className="commit-tree-detail-revision">
          <span className="hash">
            {baseRevision
              ? t('treeCompare.direction', { base: baseRevision, target: revision })
              : revision}
          </span>
          <Button
            className="icon-only"
            icon="copy"
            title={t('tree.copyCommitId')}
            aria-label={t('tree.copyCommitId')}
            onClick={() => copy(revision)}
          />
        </p>
        <p>{metadata?.repository.name ?? repoId}</p>
        {metadata && <p className="muted">{metadata.repository.root}</p>}
      </div>
      <div className="revision-tree-toolbar commit-tree-toolbar">
        <select
          className="commit-tree-view-select"
          aria-label={t('treeViews.presentation')}
          value={viewMode}
          onChange={(event) => {
            setMenu(undefined);
            setViewMode(event.target.value as TreeViewMode);
          }}
        >
          <option value="list">{t('treeViews.list')}</option>
          <option value="horizontal">{t('treeViews.horizontal')}</option>
          <option value="radial">{t('treeViews.radial')}</option>
          <option value="vertical">{t('treeViews.vertical')}</option>
        </select>
        <label className="file-path-filter">
          <Icon name="search" />
          <input
            type="search"
            disabled={!indexed}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('tree.searchAllPathsPlaceholder')}
            aria-label={t('tree.searchAllPaths')}
          />
        </label>
        <div className="commit-tree-primary-controls">
          <label
            className="commit-tree-changes-toggle"
            title={t(baseRevision ? 'treeCompare.showChanges' : 'tree.showChanges')}
          >
            <input
              type="checkbox"
              checked={showChanges}
              disabled={!indexed}
              onChange={(event) => {
                stopExpansion();
                setMenu(undefined);
                setShowChanges(event.target.checked);
                if (!event.target.checked) setChangesOnly(false);
              }}
            />
            {t('tree.changeMarkers')}
          </label>
          {showChanges && !baseRevision && metadata && metadata.commit.parents.length > 1 && (
            <select
              className="commit-tree-parent-select"
              aria-label={t('tree.comparisonBase')}
              title={parent}
              value={parent}
              onChange={(event) => {
                stopExpansion();
                setMenu(undefined);
                setSelectedParent(event.target.value);
                setFocusedChanges(undefined);
                saveView({ changeExpanded: undefined });
              }}
            >
              {metadata.commit.parents.map((oid, index) => (
                <option key={oid} value={oid}>
                  {t('tree.parentOption', { index: index + 1, oid: oid.slice(0, 8) })}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="commit-tree-secondary-controls">{actions(false)}</div>
        <Button
          className="icon-only commit-tree-more-actions"
          icon="ellipsis"
          title={t('tree.moreActions')}
          aria-label={t('tree.moreActions')}
          popoverTarget={actionsId}
        />
        <div className="commit-tree-statistics" role="status">
          <Button
            className="commit-tree-statistics-button"
            title={t('tree.statistics')}
            aria-label={t('tree.statistics')}
            popoverTarget={statisticsId}
          >
            <Icon name="graph" className="commit-tree-statistics-icon" />
            {indexed ? (
              <span className="commit-tree-snapshot-count">{snapshotLabel}</span>
            ) : (
              <Icon
                name={loading ? 'loading' : 'warning'}
                className={loading ? 'codicon-modifier-spin' : ''}
              />
            )}
            {query && <span>{t('tree.matches', { count: rows.length })}</span>}
            {showChanges &&
              (changesLoading ? (
                <span title={t('tree.loadingChanges')} aria-label={t('tree.loadingChanges')}>
                  <Icon name="loading" className="codicon-modifier-spin" />
                </span>
              ) : (
                activeChanges && (
                  <>
                    <span
                      className="commit-tree-change-counts"
                      title={t('tree.changeSummary', summary)}
                    >
                      {Object.entries(summary)
                        .filter(([, count]) => count > 0)
                        .map(([key, count]) => (
                          <span
                            key={key}
                            className={`status-${key === 'typeChanged' ? 'T' : key[0].toUpperCase()}`}
                          >
                            {key === 'typeChanged' ? 'T' : key[0].toUpperCase()}
                            {count}
                          </span>
                        ))}
                      {!changeTotal && t('tree.compactChanges', { count: 0 })}
                    </span>
                    <span className="commit-tree-change-total">
                      {t('tree.compactChanges', { count: changeTotal })}
                    </span>
                  </>
                )
              ))}
          </Button>
        </div>
      </div>
      <div
        id={actionsId}
        popover="auto"
        className="commit-tree-popover commit-tree-actions-popover"
        role="dialog"
        aria-label={t('tree.moreActions')}
      >
        <div className="commit-tree-popover-heading">
          <strong>{t('tree.moreActions')}</strong>
          <Button
            className="icon-only"
            icon="close"
            title={t('common.close')}
            aria-label={t('common.close')}
            popoverTarget={actionsId}
            popoverTargetAction="hide"
          />
        </div>
        {actions(true)}
      </div>
      <div
        id={statisticsId}
        popover="auto"
        className="commit-tree-popover"
        role="dialog"
        aria-label={t('tree.statistics')}
      >
        <div className="commit-tree-popover-heading">
          <strong>{t('tree.statistics')}</strong>
          <Button
            className="icon-only"
            icon="close"
            title={t('common.close')}
            aria-label={t('common.close')}
            popoverTarget={statisticsId}
            popoverTargetAction="hide"
          />
        </div>
        <p>
          {indexed
            ? t('tree.snapshotCount', counts)
            : t(loading ? 'tree.indexing' : 'tree.indexIncomplete')}
        </p>
        {query && <p>{t('tree.matches', { count: rows.length })}</p>}
        {showChanges && (
          <>
            <p>
              {t('tree.comparisonBase')}{' '}
              <span className="hash">{parent ?? (metadata ? t('tree.emptyBase') : '…')}</span>
            </p>
            {changesLoading && <p>{t('tree.loadingChanges')}</p>}
            {activeChanges && (
              <>
                <p>{t('tree.changeSummary', summary)}</p>
                <p className="muted">{t('tree.deletedCountHint')}</p>
              </>
            )}
          </>
        )}
      </div>
      {hintDismissed === false && (
        <div className="commit-tree-memory-introduction">
          <Icon name="info" />
          <span>{t('treeMemory.introduction')}</span>
          <Button
            className="icon-only"
            icon="close"
            title={t('treeMemory.dismissIntroduction')}
            aria-label={t('treeMemory.dismissIntroduction')}
            disabled={hintBusy}
            onClick={() => void dismissHint()}
          />
        </div>
      )}
      {hintError && (
        <div className="revision-tree-error commit-tree-memory-error" role="alert">
          {t('treeMemory.hintUnavailable')} {hintError}
          <Button
            className="icon-only"
            icon="refresh"
            title={t('tree.retry')}
            aria-label={t('tree.retry')}
            disabled={hintBusy}
            onClick={() =>
              hintDismissed === false ? void dismissHint() : setHintAttempt((value) => value + 1)
            }
          />
        </div>
      )}
      {memory.error && (
        <div className="revision-tree-error commit-tree-memory-error" role="alert">
          {t('treeMemory.unavailable')} {memory.error}
          <Button
            className="icon-only"
            icon="refresh"
            title={t('tree.retry')}
            aria-label={t('tree.retry')}
            disabled={memory.loading}
            onClick={memory.reload}
          />
        </div>
      )}
      {(loading || !indexed || expanding !== undefined) && (
        <div className="revision-tree-status commit-tree-progress" role="status">
          {!indexed && t(loading ? 'tree.indexing' : 'tree.indexIncomplete')}
          {loading && (
            <Button
              className="icon-only"
              icon="close"
              title={t('tree.cancelLoading')}
              aria-label={t('tree.cancelLoading')}
              onClick={() => indexController.current?.abort()}
            />
          )}
          {expanding !== undefined && (
            <>
              {t('tree.expanding', { count: expanding })}
              <Button
                className="icon-only"
                icon="close"
                title={t('tree.cancelExpand')}
                aria-label={t('tree.cancelExpand')}
                onClick={stopExpansion}
              />
            </>
          )}
        </div>
      )}
      {showChanges && changesError && (
        <div className="revision-tree-error" role="alert">
          {t('tree.changesUnavailable')} {changesError}
          <Button
            className="icon-only"
            icon="refresh"
            title={t('tree.retry')}
            aria-label={t('tree.retry')}
            onClick={() => setChangeAttempt((value) => value + 1)}
          />
        </div>
      )}
      {(error || metadataError) && (
        <div className="revision-tree-error" role="alert">
          {error || metadataError}
          <Button
            className="icon-only"
            icon="refresh"
            title={t('tree.retry')}
            aria-label={t('tree.retry')}
            onClick={() => setAttempt((value) => value + 1)}
          />
        </div>
      )}
      <main
        ref={body}
        className={`commit-tree-body${previewOpen ? ' with-preview' : ''}`}
        style={{ '--commit-tree-split': `${splitSize}px` } as CSSProperties}
      >
        {viewMode === 'list' ? (
          <div
            ref={list}
            className="revision-tree-rows commit-tree-rows"
            onScroll={(event) => {
              if (treeDataReady && !memory.loading)
                saveView({
                  listScroll: {
                    top: event.currentTarget.scrollTop,
                    left: event.currentTarget.scrollLeft,
                  },
                });
            }}
            role="tree"
            aria-label={t('tree.fullRepositoryTree')}
          >
            <VirtualFileRows
              items={rows}
              getKey={(row) => row.node.id}
              scrollParent=".commit-tree-rows"
              estimateSize={26}
              focusSelector=".revision-tree-entry"
            >
              {({ node, depth, guides, last, changeHighlight }) => {
                const entry = node.entry,
                  folder = entry.type === 'tree',
                  opened = expanded.has(node.id),
                  status = node.change?.status[0];
                return (
                  <div
                    className={`revision-tree-row${selected === node.id ? ' selected' : ''}${node.deleted ? ' snapshot-deleted' : ''}`}
                    data-status={status}
                    data-change-highlight={changeHighlight}
                    role="treeitem"
                    aria-label={nodeHint(node)}
                    aria-level={query ? 1 : depth + 1}
                    aria-expanded={folder ? opened : undefined}
                    aria-selected={selected === node.id}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenu({
                        node,
                        x: event.clientX,
                        y: event.clientY,
                        anchor: event.currentTarget,
                      });
                    }}
                  >
                    <button
                      className="revision-tree-entry"
                      title={nodeHint(node)}
                      onClick={() => openEntry(node)}
                      onDoubleClick={() => {
                        if (!folder && entry.type !== 'gitlink') openHistorical(node);
                      }}
                      onKeyDown={(event) => {
                        if (
                          (event.key === 'ArrowRight' && folder && !opened) ||
                          (event.key === 'ArrowLeft' && folder && opened)
                        ) {
                          event.preventDefault();
                          openEntry(node);
                        }
                        if (
                          event.key === 'ContextMenu' ||
                          (event.shiftKey && event.key === 'F10')
                        ) {
                          event.preventDefault();
                          const rect = event.currentTarget.getBoundingClientRect();
                          setMenu({
                            node,
                            x: rect.left + 24,
                            y: rect.bottom,
                            anchor: event.currentTarget,
                          });
                        }
                      }}
                    >
                      {!query && (
                        <span className="snapshot-guides" aria-hidden="true">
                          {guides.map((line, index) => (
                            <span key={index} className={line ? 'continuing' : ''} />
                          ))}
                          <span className={last ? 'branch last' : 'branch'} />
                        </span>
                      )}
                      <Icon name={folder ? (opened ? 'chevron-down' : 'chevron-right') : 'blank'} />
                      <Icon
                        name={
                          folder
                            ? opened
                              ? 'folder-opened'
                              : 'folder'
                            : entry.type === 'symlink'
                              ? 'file-symlink-file'
                              : entry.type === 'gitlink'
                                ? 'file-submodule'
                                : 'file'
                        }
                      />
                      <span className="revision-tree-name">{query ? entry.path : entry.name}</span>
                    </button>
                    {node.change?.previousPath && (
                      <span className="snapshot-origin" title={nodeHint(node)}>
                        ← {node.change.previousPath}
                      </span>
                    )}
                    {node.deleted && (
                      <span className="snapshot-deleted-label">
                        {t(folder ? 'tree.deletedDirectory' : 'tree.virtualDeleted')}
                      </span>
                    )}
                    {node.summary && (
                      <span
                        className="snapshot-directory-status"
                        title={t('tree.changeSummary', node.summary)}
                        aria-label={t('tree.changeSummary', node.summary)}
                      >
                        <Icon name="circle-filled" />
                        <span>
                          {Object.values(node.summary).reduce((sum, count) => sum + count, 0)}
                        </span>
                      </span>
                    )}
                    {status && (
                      <span
                        className={`snapshot-badge status-${status}`}
                        title={statusName(status)}
                        aria-label={statusName(status)}
                      >
                        {status}
                      </span>
                    )}
                    {entry.type === 'gitlink' && (
                      <span className="revision-tree-meta hash" title={entry.oid}>
                        {entry.oid.slice(0, 8)}
                      </span>
                    )}
                  </div>
                );
              }}
            </VirtualFileRows>
            {!rows.length && !loading && indexed && (!changesOnly || !!activeChanges) && (
              <div className="revision-tree-loading">
                {t(query ? 'tree.noMatches' : 'tree.emptyTree')}
              </div>
            )}
          </div>
        ) : (
          <CommitTreeGraph
            initialFocus={pageState.saved.current.view?.graphFocus}
            allowLargeGraph={pageState.saved.current.view?.allowLargeGraph}
            onGraphStateChange={saveView}
            wheelMode={wheelMode}
            onWheelModeChange={setWheelMode}
            key={viewMode}
            initialCamera={pageState.saved.current.view?.cameras?.[viewMode]}
            ready={treeDataReady && !memory.loading}
            onCameraChange={(camera) =>
              saveView({
                cameras: {
                  ...pageState.saved.current.view?.cameras,
                  [viewMode]: camera,
                },
              })
            }
            rows={rows}
            mode={viewMode}
            query={query}
            fitRequest={fitRequest}
            expanded={expanded}
            selected={selected}
            nodeHint={nodeHint}
            statusName={statusName}
            openEntry={openEntry}
            openHistorical={openHistorical}
            context={(node, x, y, anchor) => setMenu({ node, x, y, anchor })}
            useList={() => setViewMode('list')}
          />
        )}
        {previewOpen && (
          <ResizeHandle
            axis={splitAxis}
            className="commit-tree-preview-divider"
            label={t('tree.resizePreview')}
            value={splitSize}
            min={splitMin}
            max={splitMax}
            onChange={(value) => {
              if (splitAvailable > 0)
                setPreviewSplit((current) => ({ ...current, [splitAxis]: value / splitAvailable }));
            }}
          />
        )}
        {previewOpen && (
          <div className="commit-tree-preview">
            {!treeDataReady ? (
              <div className="revision-tree-loading">
                <Icon name="loading" className="codicon-modifier-spin" /> {t('tree.loading')}
              </div>
            ) : selectedEntry?.type === 'gitlink' ? (
              <div className="revision-tree-loading">
                {t('tree.submodulePointer')} <span className="hash">{selectedEntry.oid}</span>
              </div>
            ) : diffTarget ? (
              <div className="commit-tree-diff">
                <div className="commit-tree-diff-mode">
                  <span>{t('tree.changePreview')}</span>
                  <Button
                    className="icon-only"
                    icon="close"
                    title={t('tree.closePreview')}
                    aria-label={t('tree.closePreview')}
                    onClick={() => setPreviewOpen(false)}
                  />
                </div>
                <DiffPreview
                  key={previewKey}
                  reading={reading}
                  isolated={{ repoId, target: diffTarget, hideEdit: true }}
                  native={() => void rpc('diff', repoId, diffTarget).catch(fail)}
                  edit={() => {}}
                />
              </div>
            ) : selectedEntry && !selectedNode?.deleted ? (
              <SnapshotPreview
                reading={reading}
                repoId={repoId}
                revision={revision}
                path={selectedEntry.path}
                onClose={() => setPreviewOpen(false)}
              />
            ) : (
              <div className="revision-tree-loading">{t('tree.selectFile')}</div>
            )}
          </div>
        )}
      </main>
      {pageState.saveError && (
        <div role="alert" className="revision-tree-error">
          {t('treeViews.stateSaveFailed', { error: pageState.saveError })}
          <Button
            icon="refresh"
            className="icon-only"
            title={t('treeViews.retrySave')}
            aria-label={t('treeViews.retrySave')}
            onClick={pageState.retry}
          />
        </div>
      )}
      {settingsDraft && (
        <TreeDefaultsDialog
          draft={settingsDraft}
          onChange={setSettingsDraft}
          current={pageState.saved.current.view ?? {}}
          comparison={!!baseRevision}
          onClose={() => setSettingsDraft(undefined)}
        />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          anchor={menu.anchor}
          caption={menu.node.entry.path}
          close={closeMenu}
          items={[
            ...(['blob', 'symlink'].includes(menu.node.entry.type)
              ? [
                  {
                    label: t('tree.openHistoricalFile'),
                    icon: 'go-to-file',
                    run: () => openHistorical(menu.node),
                  },
                ]
              : []),
            { label: t('menus.copyPath'), icon: 'copy', run: () => copy(menu.node.entry.path) },
            ...(menu.node.entry.oid
              ? [
                  {
                    label: t('tree.copyObjectId'),
                    icon: 'copy',
                    run: () => copy(menu.node.entry.oid),
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
}
