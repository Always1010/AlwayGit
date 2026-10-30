import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TreeCameraState } from '../src/protocol/tree';
import type { SnapshotNode, SnapshotRow } from './commitTreeModel';
import { Button, Icon } from './ui';
import { useTranslation } from './i18n';
import {
  fitTree,
  graphNodeHeight,
  radialNodeHeight,
  intersects,
  layoutTree,
  treeEdge,
  zoomTree,
  type TreeCamera,
  type TreeGraphMode,
  type TreeGraphNode,
} from './treeLayout';
import { wheelTree } from './treeWheel';
import type { TreeWheelMode } from '../src/protocol/interface-settings';
import './commit-tree-graph.css';

const graphReviewThreshold = 6000;
export function CommitTreeGraph({
  rows,
  mode,
  query,
  fitRequest,
  expanded,
  selected,
  nodeHint,
  statusName,
  openEntry,
  openHistorical,
  context,
  useList,
  initialCamera,
  onCameraChange,
  ready = true,
  wheelMode: treeWheelMode,
  onWheelModeChange,
  initialFocus,
  allowLargeGraph,
  onGraphStateChange,
}: {
  rows: SnapshotRow[];
  mode: TreeGraphMode;
  query: string;
  fitRequest: number;
  expanded: ReadonlySet<string>;
  selected?: string;
  nodeHint(node: SnapshotNode): string;
  statusName(status: string): string;
  openEntry(node: SnapshotNode): void;
  openHistorical(node: SnapshotNode): void;
  context(node: SnapshotNode, x: number, y: number, anchor: HTMLElement): void;
  useList(): void;
  initialCamera?: TreeCameraState;
  onCameraChange?(camera: TreeCameraState): void;
  ready?: boolean;
  wheelMode: TreeWheelMode;
  onWheelModeChange(mode: TreeWheelMode): void;
  initialFocus?: string;
  allowLargeGraph?: boolean;
  onGraphStateChange?(value: { graphFocus?: string; allowLargeGraph?: boolean }): void;
}) {
  const t = useTranslation(),
    stage = useRef<HTMLDivElement>(null);
  const wheelModeRef = useRef(treeWheelMode);
  wheelModeRef.current = treeWheelMode;
  const [allowLarge, setAllowLarge] = useState(allowLargeGraph ?? false),
    [size, setSize] = useState({ width: 800, height: 600 });
  const [camera, setCamera] = useState<TreeCamera>({ x: 30, y: 30, scale: 1 }),
    [focusId, setFocusId] = useState(initialFocus);
  const rememberFocus = (id: string) => {
    setFocusId(id);
    onGraphStateChange?.({ graphFocus: id });
  };
  const [positioned, setPositioned] = useState(false),
    [measured, setMeasured] = useState(false);
  const restoredCamera = useRef(initialCamera);
  const blocked = rows.length > graphReviewThreshold && !allowLarge;
  const layout = useMemo(
    () => layoutTree(blocked ? [] : rows, mode, !!query.trim()),
    [rows, mode, query, blocked],
  );
  const edges = useMemo(
    () =>
      layout.nodes.flatMap((node) => {
        if (node.parent !== undefined)
          return [{ id: node.row.node.id, ...treeEdge(node, layout.nodes[node.parent], mode) }];
        if (!layout.root) return [];
        const { x, y } = layout.root;
        return [
          {
            id: node.row.node.id,
            path:
              mode === 'radial'
                ? `M${x},${y} L${node.anchorX},${node.anchorY}`
                : `M${x},${y} C${x / 2},${y} ${x / 2},${node.anchorY} ${node.anchorX},${node.anchorY}`,
            bounds: {
              x: Math.min(x, node.anchorX),
              y: Math.min(y, node.anchorY),
              width: Math.abs(node.anchorX - x),
              height: Math.abs(node.anchorY - y),
            },
          },
        ];
      }),
    [layout, mode],
  );
  const fit = useCallback(() => {
    setCamera(fitTree(layout.bounds, size.width, size.height));
  }, [layout, size]);
  // Fit on a layout switch or data/search change; expansion preserves the current reading position.
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    if (positioned) fitRef.current();
  }, [mode, query, blocked, fitRequest]);
  const previousSize = useRef(size);
  useEffect(() => {
    const previous = previousSize.current;
    previousSize.current = size;
    // Keep the same scale and canvas center while the preview divider is dragged.
    if (positioned)
      setCamera((current) => ({
        ...current,
        x: current.x + (size.width - previous.width) / 2,
        y: current.y + (size.height - previous.height) / 2,
      }));
  }, [size]);
  useLayoutEffect(() => {
    if (positioned || !ready || !measured) return;
    const saved = restoredCamera.current;
    setCamera(
      saved
        ? {
            x: size.width / 2 - saved.centerX * saved.scale,
            y: size.height / 2 - saved.centerY * saved.scale,
            scale: saved.scale,
          }
        : fitTree(layout.bounds, size.width, size.height),
    );
    setPositioned(true);
  }, [ready, measured, positioned, layout, size]);
  useLayoutEffect(() => {
    if (positioned)
      onCameraChange?.({
        centerX: (size.width / 2 - camera.x) / camera.scale,
        centerY: (size.height / 2 - camera.y) / camera.scale,
        scale: camera.scale,
      });
  }, [camera, size, positioned, onCameraChange]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0].contentRect;
      if (box.width > 0 && box.height > 0) {
        setSize({ width: box.width, height: box.height });
        setMeasured(true);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const zoom = useCallback(
    (factor: number, x = size.width / 2, y = size.height / 2) =>
      setCamera((current) => zoomTree(current, factor, x, y)),
    [size],
  );
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      setCamera((current) =>
        wheelTree(
          current,
          event,
          box,
          { x: event.clientX - box.left, y: event.clientY - box.top },
          wheelModeRef.current,
        ),
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const viewport = {
    x: -camera.x / camera.scale - 80,
    y: -camera.y / camera.scale - 80,
    width: size.width / camera.scale + 160,
    height: size.height / camera.scale + 160,
  };
  const visible = layout.nodes.filter((node) => intersects(node, viewport));
  const hasVisibleFocus = visible.some((node) => node.row.node.id === focusId);
  const focusNode = (index: number) => {
    const node = layout.nodes[Math.max(0, Math.min(layout.nodes.length - 1, index))];
    if (!node) return;
    rememberFocus(node.row.node.id);
    setCamera((current) => ({
      ...current,
      x: size.width / 2 - (node.x + node.width / 2) * current.scale,
      y: size.height / 2 - (node.y + node.height / 2) * current.scale,
    }));
    requestAnimationFrame(() =>
      stage.current
        ?.querySelector<HTMLButtonElement>(`[data-graph-index="${node.index}"]`)
        ?.focus(),
    );
  };
  const nodeTransform = (node: TreeGraphNode) =>
    mode === 'radial'
      ? `translate(${node.anchorX} ${node.anchorY}) rotate(${node.angle})`
      : `translate(${node.x} ${node.y + graphNodeHeight / 2})`;
  return (
    <div className="commit-tree-graph" data-testid="commit-tree-graph" data-layout={mode}>
      <div className="tree-graph-toolbar">
        <Button
          className="icon-only"
          icon="zoom-out"
          title={t('treeViews.zoomOut')}
          aria-label={t('treeViews.zoomOut')}
          disabled={blocked}
          onClick={() => zoom(1 / 1.3)}
        />
        <span className="tree-graph-scale">{Math.round(camera.scale * 1000) / 10}%</span>
        <Button
          className="icon-only"
          icon="zoom-in"
          title={t('treeViews.zoomIn')}
          aria-label={t('treeViews.zoomIn')}
          disabled={blocked}
          onClick={() => zoom(1.3)}
        />
        <Button
          className="icon-only"
          icon="screen-full"
          title={t('treeViews.fit')}
          aria-label={t('treeViews.fit')}
          disabled={blocked}
          onClick={fit}
        />
        <div className="tree-wheel-mode" role="group" aria-label={t('treeViews.wheelMode')}>
          <span>{t('treeViews.wheelMode')}</span>
          {(['zoom', 'scroll'] as const).map((value) => (
            <Button
              key={value}
              aria-pressed={treeWheelMode === value}
              title={
                value === 'zoom' ? t('treeViews.wheelZoomHint') : t('treeViews.wheelScrollHint')
              }
              onClick={() => onWheelModeChange(value)}
            >
              {value === 'zoom' ? t('treeViews.wheelZoom') : t('treeViews.wheelScroll')}
            </Button>
          ))}
        </div>
        <span className="muted">
          {treeWheelMode === 'zoom'
            ? t('treeViews.navigationHintZoom')
            : t('treeViews.navigationHint')}
        </span>
      </div>
      <div
        className="tree-graph-stage"
        ref={stage}
        tabIndex={0}
        aria-label={treeWheelMode === 'zoom' ? t('treeViews.canvasZoom') : t('treeViews.canvas')}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            zoom(1.3);
          } else if (event.key === '-') {
            event.preventDefault();
            zoom(1 / 1.3);
          } else if (event.key === '0') {
            event.preventDefault();
            fit();
          } else if (event.key === 'Home' || event.key === 'ArrowDown') {
            event.preventDefault();
            focusNode(0);
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as Element).closest('button')) return;
          const element = event.currentTarget,
            startX = event.clientX,
            startY = event.clientY,
            initial = camera;
          element.setPointerCapture(event.pointerId);
          element.classList.add('dragging');
          const move = (next: PointerEvent) =>
            setCamera({
              ...initial,
              x: initial.x + next.clientX - startX,
              y: initial.y + next.clientY - startY,
            });
          const end = () => {
            element.removeEventListener('pointermove', move);
            element.removeEventListener('pointerup', end);
            element.removeEventListener('pointercancel', end);
            element.removeEventListener('lostpointercapture', end);
            element.classList.remove('dragging');
          };
          element.addEventListener('pointermove', move);
          element.addEventListener('pointerup', end);
          element.addEventListener('pointercancel', end);
          element.addEventListener('lostpointercapture', end);
        }}
      >
        {blocked ? (
          <div className="tree-graph-large" role="status">
            <Icon name="info" />
            <p>{t('treeViews.largeGraph', { count: rows.length })}</p>
            <Button
              onClick={() => {
                setAllowLarge(true);
                onGraphStateChange?.({ allowLargeGraph: true });
              }}
            >
              {t('treeViews.renderAll')}
            </Button>
            <Button onClick={useList}>{t('treeViews.list')}</Button>
          </div>
        ) : !rows.length ? (
          query.trim() ? (
            <div className="revision-tree-loading">{t('tree.noMatches')}</div>
          ) : null
        ) : (
          <svg width="100%" height="100%" role="tree" aria-label={t('tree.fullRepositoryTree')}>
            <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}>
              <g className="tree-graph-edges" aria-hidden="true">
                {edges
                  .filter((edge) => intersects(edge.bounds, viewport))
                  .map((edge) => (
                    <path key={edge.id} d={edge.path} />
                  ))}
              </g>
              {layout.root && (
                <g
                  className="tree-graph-root"
                  transform={`translate(${layout.root.x} ${layout.root.y})`}
                  aria-hidden="true"
                >
                  <circle r={5} />
                  <text y={-14} textAnchor="middle">
                    {t('tree.snapshotTitle')}
                  </text>
                </g>
              )}
              {visible.map((point) => {
                const node = point.row.node,
                  folder = node.entry.type === 'tree',
                  opened = expanded.has(node.id),
                  status = node.change?.status[0],
                  index = point.index;
                return (
                  <g key={node.id} transform={nodeTransform(point)}>
                    {(mode === 'vertical' || mode === 'radial') && (
                      <circle
                        className={`tree-graph-point ${folder ? 'directory' : 'file'}${opened ? ' expanded' : ''}`}
                        r={folder ? 4 : 3}
                        aria-hidden="true"
                      />
                    )}
                    <foreignObject
                      x={
                        mode === 'radial'
                          ? point.flipped
                            ? -point.labelWidth - 6
                            : 6
                          : mode === 'vertical'
                            ? 8
                            : 0
                      }
                      y={-(mode === 'radial' ? radialNodeHeight : graphNodeHeight) / 2}
                      width={point.labelWidth}
                      height={mode === 'radial' ? radialNodeHeight : graphNodeHeight}
                    >
                      <button
                        className={`tree-graph-node${folder ? ' directory' : ''}${mode === 'radial' && point.flipped ? ' flipped' : ''}${selected === node.id ? ' selected' : ''}${node.deleted ? ' snapshot-deleted' : ''}`}
                        data-node-id={node.id}
                        data-path={node.entry.path}
                        data-graph-index={index}
                        data-status={status}
                        data-change-highlight={point.row.changeHighlight}
                        role="treeitem"
                        aria-level={point.row.depth + 1}
                        aria-expanded={folder ? opened : undefined}
                        aria-selected={selected === node.id}
                        aria-label={nodeHint(node)}
                        tabIndex={
                          focusId === node.id || (!hasVisibleFocus && point === visible[0]) ? 0 : -1
                        }
                        title={nodeHint(node)}
                        onFocus={() => rememberFocus(node.id)}
                        onClick={() => openEntry(node)}
                        onDoubleClick={() => {
                          if (!folder && node.entry.type !== 'gitlink') openHistorical(node);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          context(node, event.clientX, event.clientY, event.currentTarget);
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key === 'ArrowDown' ||
                            event.key === 'ArrowUp' ||
                            event.key === 'Home' ||
                            event.key === 'End'
                          ) {
                            event.preventDefault();
                            focusNode(
                              event.key === 'Home'
                                ? 0
                                : event.key === 'End'
                                  ? layout.nodes.length - 1
                                  : index + (event.key === 'ArrowDown' ? 1 : -1),
                            );
                          } else if (
                            (event.key === 'ArrowRight' && folder && !opened) ||
                            (event.key === 'ArrowLeft' && folder && opened)
                          ) {
                            event.preventDefault();
                            openEntry(node);
                          } else if (event.key === 'ArrowLeft' && point.parent !== undefined) {
                            event.preventDefault();
                            focusNode(point.parent);
                          } else if (event.key === 'ArrowRight' && point.children.length) {
                            event.preventDefault();
                            focusNode(point.children[0]);
                          } else if (
                            event.key === 'ContextMenu' ||
                            (event.shiftKey && event.key === 'F10')
                          ) {
                            event.preventDefault();
                            const box = event.currentTarget.getBoundingClientRect();
                            context(node, box.left + 20, box.bottom, event.currentTarget);
                          }
                        }}
                      >
                        {mode !== 'radial' && (
                          <>
                            <Icon
                              name={folder ? (opened ? 'chevron-down' : 'chevron-right') : 'blank'}
                            />
                            <Icon
                              name={
                                folder
                                  ? opened
                                    ? 'folder-opened'
                                    : 'folder'
                                  : node.entry.type === 'symlink'
                                    ? 'file-symlink-file'
                                    : node.entry.type === 'gitlink'
                                      ? 'file-submodule'
                                      : 'file'
                              }
                            />
                          </>
                        )}
                        <span className="tree-graph-label">{point.label}</span>
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
                        {node.deleted && mode !== 'radial' && (
                          <span title={t('tree.virtualDeleted')}>
                            <Icon name="trash" />
                          </span>
                        )}
                        {status && (
                          <span
                            className={`snapshot-badge status-${status}`}
                            title={statusName(status)}
                          >
                            {status}
                          </span>
                        )}
                      </button>
                    </foreignObject>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </div>
      <div className="tree-graph-footer muted">
        {t('treeViews.visibleCount', { visible: visible.length, count: rows.length })}
        {query.trim() && ` · ${t('treeViews.searchPaths')}`}
      </div>
    </div>
  );
}
