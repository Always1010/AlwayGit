import { uiText } from '../text';
import { useId } from 'react';
import type { GraphLayoutRow, GraphSegment } from './layout';
import { getGraphPalette, type GraphPaletteId } from './palettes';

export interface GraphRowProps {
  row: GraphLayoutRow;
  height?: number;
  laneWidth?: number;
  width?: number;
  /** The commit currently checked out, including a detached HEAD. */
  head?: boolean;
  selected?: boolean;
  main?: boolean;
  pushed?: boolean;
  /** A mutable Working Tree node which is visually distinct from a Git commit. */
  working?: boolean;
  mainTargets?: ReadonlySet<string>;
  paletteId?: GraphPaletteId;
  paletteSize?: number;
  hoveredPath?: string;
  onHoverPath?(pathId?: string): void;
}

function pathFor(segment: GraphSegment, height: number, laneWidth: number): string {
  const x1 = (segment.fromLane + 0.5) * laneWidth;
  const x2 = (segment.toLane + 0.5) * laneWidth;
  const y1 = segment.from === 'top' ? 0 : height / 2;
  const y2 = segment.to === 'middle' ? height / 2 : height;
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const bend = (y2 - y1) / 2;
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}

/** A complete, independently renderable row for a fixed-height history table. */
export function GraphRow({ row, height = 26, laneWidth = 16, width, head = false, selected = false, main = false, pushed = true, working = false, mainTargets, paletteId = 'vivid', paletteSize, hoveredPath, onHoverPath }: GraphRowProps) {
  const titleId = useId();
  const palette = getGraphPalette(paletteId);
  const colorFor = (index: number) => {
    const slot = index % (paletteSize ?? palette.light.length);
    return `var(--graph-lane-${slot}, ${palette.dark[slot % palette.dark.length]})`;
  };
  const svgWidth = Math.max(width ?? 0, row.laneCount * laneWidth, laneWidth);
  const parentLabel = row.parents.length
    ? uiText("graphRow.parents", { value: (row.parents.length > 1 ? uiText("graphRow.mergeCommit") : ''), value2: (row.parents.map(oid => oid.slice(0, 8)).join(', ')) })
    : uiText("graphRow.rootCommitNoParents");
  const label = working
    ? uiText("graphRow.workingTreeVirtualNodeLane", { value: (row.lane + 1), value2: (selected ? uiText("graphRow.selected") : '') })
    : uiText("graphRow.commitLane", { value: (row.oid.slice(0, 8)), value2: (row.lane + 1), parentLabel: (parentLabel), value3: (main ? uiText("graphRow.mainBranch") : ''), value4: (head ? uiText("graphRow.currentHEAD") : ''), value5: (selected ? uiText("graphRow.selectedCommit") : '') });
  const nodeX = (row.lane + 0.5) * laneWidth;
  const nodeY = height / 2;
  const nodeColor = main ? 'var(--graph-main, #f2f2f2)' : colorFor(row.color);
  const workingColor = 'var(--working-tree-accent, var(--green, currentColor))';

  return (
    <svg
      className="git-graph-row"
      width={svgWidth}
      height={height}
      viewBox={`0 0 ${svgWidth} ${height}`}
      role="img"
      aria-labelledby={titleId}
      data-head={head || undefined}
      data-selected={selected || undefined}
      data-main={main || undefined}
      data-working={working || undefined}
      style={{ display: 'block', overflow: 'visible', flexShrink: 0 }}
    >
      <title id={titleId}>{label}</title>
      {row.segments.map((segment, index) => {
        const mainSegment=mainTargets?.has(segment.target)??false;
        const highlighted=!!hoveredPath&&segment.pathId===hoveredPath;
        return (
        <path
          key={`${segment.kind}-${segment.target}-${index}`}
          d={pathFor(segment, height, laneWidth)}
          fill="none"
          stroke={working && segment.kind==='parent'?workingColor:mainSegment?'var(--graph-main, #f2f2f2)':colorFor(segment.color)}
          strokeWidth={highlighted?4:mainSegment?3:2.5}
          opacity={hoveredPath && !highlighted ? .35 : 1}
          data-path-id={segment.pathId}
          onMouseEnter={()=>onHoverPath?.(segment.pathId)}
          onMouseLeave={()=>onHoverPath?.()}
          pointerEvents="stroke"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          aria-hidden="true"
        />
      );})}
      {working ? <><circle
        className="git-graph-working-halo"
        cx={nodeX}
        cy={nodeY}
        r={7.5}
        fill={workingColor}
        opacity={.16}
        pointerEvents="none"
        aria-hidden="true"
      /><rect
        className="git-graph-working-node"
        x={nodeX-4.5}
        y={nodeY-4.5}
        width={9}
        height={9}
        rx={1}
        transform={`rotate(45 ${nodeX} ${nodeY})`}
        fill={workingColor}
        stroke="var(--bg, var(--vscode-editor-background, Canvas))"
        strokeWidth={1.5}
        data-path-id={row.pathId}
        onMouseEnter={()=>onHoverPath?.(row.pathId)}
        onMouseLeave={()=>onHoverPath?.()}
        vectorEffect="non-scaling-stroke"
        aria-hidden="true"
      /></>:<circle
          className="git-graph-node"
          cx={nodeX}
          cy={nodeY}
          r={row.parents.length > 1 ? pushed ? 4.5 : 4 : pushed ? 3.5 : 3}
          fill={pushed ? nodeColor : 'var(--bg, var(--vscode-editor-background, Canvas))'}
          stroke={selected ? 'var(--selected-fg, var(--vscode-list-activeSelectionForeground, currentColor))' : pushed ? 'var(--fg, var(--vscode-foreground, currentColor))' : nodeColor}
          strokeWidth={selected ? 2 : pushed ? 1 : 2}
          opacity={hoveredPath && row.pathId !== hoveredPath ? .35 : 1}
          data-path-id={row.pathId}
          onMouseEnter={()=>onHoverPath?.(row.pathId)}
          onMouseLeave={()=>onHoverPath?.()}
          vectorEffect="non-scaling-stroke"
          data-pushed={pushed}
          aria-hidden="true"
        />}
      {!working && pushed && row.parents.length > 1 && (
        <circle
          cx={nodeX}
          cy={nodeY}
          r={1.5}
          fill="var(--bg, var(--vscode-editor-background, Canvas))"
          aria-hidden="true"
        />
      )}
    </svg>
  );
}
