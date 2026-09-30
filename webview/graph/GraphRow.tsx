import React, { useId } from 'react';
import type { GraphLayoutRow, GraphSegment } from './layout';

export interface GraphRowProps {
  row: GraphLayoutRow;
  height?: number;
  laneWidth?: number;
  width?: number;
  /** The commit currently checked out, including a detached HEAD. */
  head?: boolean;
  selected?: boolean;
  main?: boolean;
  mainTargets?: ReadonlySet<string>;
}

const colors = [
  'var(--graph-lane-0, #61a8ff)',
  'var(--graph-lane-1, #ff9b52)',
  'var(--graph-lane-2, #c58cff)',
  'var(--graph-lane-3, #45c7bd)',
  'var(--graph-lane-4, #f06fae)',
  'var(--graph-lane-5, #ff7373)',
  'var(--graph-lane-6, #d9b84e)',
  'var(--graph-lane-7, #59bde8)',
];

const colorFor = (index: number) => colors[index % colors.length];

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
export function GraphRow({ row, height = 26, laneWidth = 16, width, head = false, selected = false, main = false, mainTargets }: GraphRowProps) {
  const titleId = useId();
  const svgWidth = Math.max(width ?? 0, row.laneCount * laneWidth, laneWidth);
  const parentLabel = row.parents.length
    ? `${row.parents.length > 1 ? 'Merge commit; ' : ''}parents ${row.parents.map(oid => oid.slice(0, 8)).join(', ')}`
    : 'Root commit; no parents';
  const label = `Commit ${row.oid.slice(0, 8)}, lane ${row.lane + 1}. ${parentLabel}.${main ? ' Main branch.' : ''}${head ? ' Current HEAD.' : ''}${selected ? ' Selected commit.' : ''}`;
  const nodeX = (row.lane + 0.5) * laneWidth;
  const nodeY = height / 2;

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
      style={{ display: 'block', overflow: 'visible', flexShrink: 0 }}
    >
      <title id={titleId}>{label}</title>
      {row.segments.map((segment, index) => {
        const mainSegment=mainTargets?.has(segment.target)??false;
        return (
        <path
          key={`${segment.kind}-${segment.target}-${index}`}
          d={pathFor(segment, height, laneWidth)}
          fill="none"
          stroke={mainSegment?'var(--graph-main, #f2f2f2)':colorFor(segment.color)}
          strokeWidth={mainSegment?3:2.5}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          aria-hidden="true"
        />
      );})}
      {head && (
        <circle
          className="git-graph-head-ring"
          cx={nodeX}
          cy={nodeY}
          r={6.5}
          fill="var(--vscode-editor-background, Canvas)"
          stroke="var(--vscode-focusBorder, currentColor)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          aria-hidden="true"
        />
      )}
      <circle
        className="git-graph-node"
        cx={nodeX}
        cy={nodeY}
        r={row.parents.length > 1 ? 4.5 : 3.5}
        fill={main?'var(--graph-main, #f2f2f2)':colorFor(row.color)}
        stroke={selected ? 'var(--vscode-list-activeSelectionForeground, currentColor)' : 'var(--vscode-foreground, currentColor)'}
        strokeWidth={selected ? 2 : 1}
        vectorEffect="non-scaling-stroke"
        aria-hidden="true"
      />
      {row.parents.length > 1 && (
        <circle
          cx={nodeX}
          cy={nodeY}
          r={1.5}
          fill="var(--vscode-editor-background, Canvas)"
          aria-hidden="true"
        />
      )}
    </svg>
  );
}
