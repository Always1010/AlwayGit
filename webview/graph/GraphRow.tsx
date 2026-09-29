import React, { useId } from 'react';
import type { GraphLayoutRow, GraphSegment } from './layout';

export interface GraphRowProps {
  row: GraphLayoutRow;
  height?: number;
  laneWidth?: number;
  width?: number;
}

// Theme-provided terminal colors keep graph lines recognizable in dark, light,
// and high-contrast VS Code themes. The node has a foreground outline as well.
const colors = [
  'var(--vscode-terminal-ansiBlue, #3b82f6)',
  'var(--vscode-terminal-ansiGreen, #22a06b)',
  'var(--vscode-terminal-ansiMagenta, #b35ad5)',
  'var(--vscode-terminal-ansiCyan, #129ca8)',
  'var(--vscode-terminal-ansiYellow, #bc8a16)',
  'var(--vscode-terminal-ansiRed, #e05260)',
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
export function GraphRow({ row, height = 32, laneWidth = 16, width }: GraphRowProps) {
  const titleId = useId();
  const svgWidth = Math.max(width ?? 0, row.laneCount * laneWidth, laneWidth);
  const parentLabel = row.parents.length
    ? `${row.parents.length > 1 ? 'Merge commit; ' : ''}parents ${row.parents.map(oid => oid.slice(0, 8)).join(', ')}`
    : 'Root commit; no parents';
  const label = `Commit ${row.oid.slice(0, 8)}, lane ${row.lane + 1}. ${parentLabel}.`;

  return (
    <svg
      className="git-graph-row"
      width={svgWidth}
      height={height}
      viewBox={`0 0 ${svgWidth} ${height}`}
      role="img"
      aria-labelledby={titleId}
      style={{ display: 'block', overflow: 'visible', flexShrink: 0 }}
    >
      <title id={titleId}>{label}</title>
      {row.segments.map((segment, index) => (
        <path
          key={`${segment.kind}-${segment.target}-${index}`}
          d={pathFor(segment, height, laneWidth)}
          fill="none"
          stroke={colorFor(segment.color)}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          aria-hidden="true"
        />
      ))}
      <circle
        cx={(row.lane + 0.5) * laneWidth}
        cy={height / 2}
        r={row.parents.length > 1 ? 4.5 : 3.5}
        fill={colorFor(row.color)}
        stroke="var(--vscode-foreground, currentColor)"
        strokeWidth={1}
        aria-hidden="true"
      />
      {row.parents.length > 1 && (
        <circle
          cx={(row.lane + 0.5) * laneWidth}
          cy={height / 2}
          r={1.5}
          fill="var(--vscode-editor-background, Canvas)"
          aria-hidden="true"
        />
      )}
    </svg>
  );
}
