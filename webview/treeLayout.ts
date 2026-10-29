import type { SnapshotRow } from './commitTreeModel';

export type TreeGraphMode = 'horizontal' | 'radial' | 'vertical';
export type TreeViewMode = 'list' | TreeGraphMode;
export interface GraphBounds { x: number; y: number; width: number; height: number }
export interface TreeGraphNode extends GraphBounds {
  index: number;
  row: SnapshotRow; parent?: number; children: number[];
  label: string; labelWidth: number; angle: number; flipped: boolean;
  anchorX: number; anchorY: number;
}
export interface TreeGraphLayout { nodes: TreeGraphNode[]; bounds: GraphBounds; root?: { x: number; y: number } }
export interface TreeCamera { x: number; y: number; scale: number }
export const graphNodeHeight = 28;
export const radialNodeHeight = 22;

export function fitTree(bounds: GraphBounds, width: number, height: number): TreeCamera {
  const scale = Math.min(1, Math.max(.000001, Math.min(Math.max(1, width - 36) / bounds.width, Math.max(1, height - 36) / bounds.height)));
  return { scale, x: (width - bounds.width * scale) / 2 - bounds.x * scale, y: (height - bounds.height * scale) / 2 - bounds.y * scale };
}

export function zoomTree(current: TreeCamera, factor: number, x: number, y: number): TreeCamera {
  const scale = Math.min(6, Math.max(.000001, current.scale * factor)), ratio = scale / current.scale;
  return { scale, x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio };
}

/** Coordinates include every visible row. DOM culling belongs to the viewport, never the model. */
export function layoutTree(rows: readonly SnapshotRow[], mode: TreeGraphMode, fullPaths = false): TreeGraphLayout {
  const stack: number[] = [], roots: number[] = [];
  const nodes: TreeGraphNode[] = rows.map((row, index) => {
    stack.length = Math.min(stack.length, row.depth);
    const parent = stack[row.depth - 1], label = (fullPaths ? row.node.entry.path : row.node.entry.name) + (mode !== 'radial' && row.node.change?.previousPath ? ` ← ${row.node.change.previousPath}` : '');
    // CJK and wide characters need more space than Latin filenames. No label is truncated.
    const summaryWidth = row.node.summary ? String(Object.values(row.node.summary).reduce((sum, count) => sum + count, 0)).length * 8 + 8 : 0;
    const labelWidth = (mode === 'radial' ? 14 + (row.node.change ? 16 : 0) : 88) + summaryWidth + [...label].reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 13 : 7.8), 0);
    const result: TreeGraphNode = { index, row, parent, children: [], label, labelWidth, width: labelWidth, height: mode === 'radial' ? radialNodeHeight : graphNodeHeight, x: 0, y: 0, anchorX: 0, anchorY: 0, angle: 0, flipped: false };
    stack[row.depth] = index;
    if (parent === undefined) roots.push(index);
    return result;
  });
  nodes.forEach((node, index) => { if (node.parent !== undefined) nodes[node.parent].children.push(index); });
  if (!nodes.length) return { nodes, bounds: { x: 0, y: 0, width: 1, height: 1 } };
  const spans = nodes.map(node => mode === 'vertical' ? node.width + 24 : 38);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.children.length) spans[i] = Math.max(mode === 'vertical' ? node.width + 24 : 38, node.children.reduce((sum, child) => sum + spans[child], 0));
  }
  const starts = new Array<number>(nodes.length), centers = new Array<number>(nodes.length);
  let offset = 0;
  for (const root of roots) { starts[root] = offset; offset += spans[root]; }
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]; centers[i] = starts[i] + spans[i] / 2;
    let childStart = starts[i] + (spans[i] - node.children.reduce((sum, child) => sum + spans[child], 0)) / 2;
    for (const child of node.children) { starts[child] = childStart; childStart += spans[child]; }
  }
  const depths: number[][] = [];
  nodes.forEach((node, i) => (depths[node.row.depth] ??= []).push(i));
  const depthOffsets: number[] = [];
  if (mode === 'horizontal') {
    let x = 0;
    for (let depth = 0; depth < depths.length; depth++) {
      depthOffsets[depth] = x;
      x += (depths[depth] ?? []).reduce((width, index) => Math.max(width, nodes[index].width), 0) + 72;
    }
  } else if (mode === 'radial') {
    for (let depth = 0; depth < depths.length; depth++) {
      const ring = depths[depth] ?? [];
      let minAngle = Math.PI * 2;
      for (let i = 0; i < ring.length; i++) {
        const next = (i + 1) % ring.length;
        const distance = ((centers[ring[next]] - centers[ring[i]] + offset) % offset) / offset * Math.PI * 2;
        if (ring.length > 1) minAngle = Math.min(minAngle, distance);
      }
      // Angular clearance protects adjacent labels. Each branch then advances only past
      // its own parent label; an unrelated long filename does not inflate every ring.
      depthOffsets[depth] = Math.max(48, 28 / Math.max(minAngle, 0.000001));
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i], depth = node.row.depth;
    if (mode === 'horizontal') { node.x = depthOffsets[depth]; node.y = centers[i] - graphNodeHeight / 2; node.anchorX = node.x; node.anchorY = centers[i]; }
    // The vertical view is a compact top-to-bottom outline, rather than a wide org chart.
    else if (mode === 'vertical') { node.x = depth * 34; node.y = i * 38; node.anchorX = node.x; node.anchorY = node.y + graphNodeHeight / 2; }
    else {
      const parent = node.parent === undefined ? undefined : nodes[node.parent];
      const parentRadius = parent ? Math.hypot(parent.anchorX, parent.anchorY) + parent.labelWidth + 24 : 48;
      const angle = centers[i] / offset * Math.PI * 2 - Math.PI / 2, radius = Math.max(parentRadius, depthOffsets[depth]);
      node.anchorX = radius * Math.cos(angle); node.anchorY = radius * Math.sin(angle);
      node.flipped = Math.cos(angle) < 0; node.angle = angle * 180 / Math.PI + (node.flipped ? 180 : 0);
      node.angle = ((node.angle + 180) % 360 + 360) % 360 - 180;
      const start = node.flipped ? -node.labelWidth - 6 : 6, radians = node.angle * Math.PI / 180;
      const corners = [start, start + node.labelWidth].flatMap(x => [-radialNodeHeight / 2, radialNodeHeight / 2].map(y => ({ x: node.anchorX + x * Math.cos(radians) - y * Math.sin(radians), y: node.anchorY + x * Math.sin(radians) + y * Math.cos(radians) })));
      node.x = Math.min(...corners.map(point => point.x)); node.y = Math.min(...corners.map(point => point.y));
      node.width = Math.max(...corners.map(point => point.x)) - node.x; node.height = Math.max(...corners.map(point => point.y)) - node.y;
    }
  }
  const root = mode === 'radial' ? { x: 0, y: 0 } : mode === 'horizontal' ? { x: -56, y: (nodes[roots[0]].anchorY + nodes[roots.at(-1)!].anchorY) / 2 } : undefined;
  const minX = nodes.reduce((value, node) => Math.min(value, node.x), root ? root.x - 90 : Infinity), minY = nodes.reduce((value, node) => Math.min(value, node.y), root ? root.y - 32 : Infinity);
  const maxX = nodes.reduce((value, node) => Math.max(value, node.x + node.width), mode === 'radial' ? 90 : -Infinity), maxY = nodes.reduce((value, node) => Math.max(value, node.y + node.height), mode === 'radial' ? 16 : -Infinity);
  return { nodes, root, bounds: { x: minX - 30, y: minY - 30, width: maxX - minX + 60, height: maxY - minY + 60 } };
}

export function intersects(a: GraphBounds, b: GraphBounds): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

export function treeEdge(node: TreeGraphNode, parent: TreeGraphNode, mode: TreeGraphMode): { path: string; bounds: GraphBounds } {
  let x1 = parent.anchorX, y1 = parent.anchorY, x2 = node.anchorX, y2 = node.anchorY;
  if (mode === 'horizontal') x1 = parent.x + parent.width;
  if (mode === 'vertical') { x1 += 14; y1 += graphNodeHeight / 2; }
  const path = mode === 'horizontal' ? `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}` : mode === 'vertical' ? `M${x1},${y1} V${y2} H${x2}` : `M${x1},${y1} L${x2},${y2}`;
  return { path, bounds: { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x1 - x2), height: Math.abs(y1 - y2) } };
}
