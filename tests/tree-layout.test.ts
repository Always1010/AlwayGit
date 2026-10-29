import { describe, expect, it } from 'vitest';
import type { SnapshotRow } from '../webview/commitTreeModel';
import { fitTree, graphNodeHeight, intersects, layoutTree, treeEdge, zoomTree, type TreeGraphMode } from '../webview/treeLayout';

function row(path: string, depth: number, folder = false): SnapshotRow {
  return { node: { id: path, entry: { path, name: path.split('/').at(-1)!, type: folder ? 'tree' : 'blob', mode: folder ? '040000' : '100644', oid: 'abc' }, children: [] }, depth, guides: [], last: false };
}
const modes: TreeGraphMode[] = ['horizontal', 'radial', 'vertical'];
describe('repository tree layouts', () => {
  it.each(modes)('handles empty and single-path %s layouts with finite bounds and complete fitting', mode => {
    const empty = layoutTree([], mode);
    expect(empty.nodes).toEqual([]);
    const layout = layoutTree([row('src', 0, true), row('src/nested', 1, true), row('src/nested/文件.ts', 2)], mode);
    expect(layout.nodes.map(node => node.parent)).toEqual([undefined, 0, 1]);
    expect(layout.nodes.every(node => intersects(node, layout.bounds))).toBe(true);
    for (const value of Object.values(layout.bounds)) expect(Number.isFinite(value)).toBe(true);
    const camera = fitTree(layout.bounds, 800, 500);
    expect(layout.bounds.width * camera.scale).toBeLessThanOrEqual(764);
    expect(layout.bounds.height * camera.scale).toBeLessThanOrEqual(464);
    expect(layout.bounds.x * camera.scale + camera.x).toBeGreaterThanOrEqual(17.9);
    expect(layout.bounds.y * camera.scale + camera.y).toBeGreaterThanOrEqual(17.9);
  });
  it.each(modes)('retains all nodes and parent links in a wide %s tree', mode => {
    const rows = [row('src', 0, true), ...Array.from({ length: 12000 }, (_, i) => row(`src/file-${i}.ts`, 1))];
    const layout = layoutTree(rows, mode);
    expect(layout.nodes).toHaveLength(rows.length);
    expect(layout.nodes[0].children).toHaveLength(12000);
    expect(layout.nodes.at(-1)?.row.node.id).toBe('src/file-11999.ts');
    expect(layout.nodes.slice(1).every(node => node.parent === 0)).toBe(true);
    const last = layout.nodes.at(-1)!;
    const edge = treeEdge(last, layout.nodes[0], mode);
    expect(edge.path).not.toMatch(/NaN|Infinity/);
    expect(intersects(edge.bounds, layout.bounds)).toBe(true);
  });
  it.each(modes)('lays out a deep %s path without recursive layout traversal', mode => {
    const layout = layoutTree(Array.from({ length: 1500 }, (_, i) => row(`path-${i}`, i, true)), mode);
    expect(layout.nodes.at(-1)?.parent).toBe(1498);
    expect(Number.isFinite(layout.bounds.height)).toBe(true);
    expect(Number.isFinite(layout.bounds.width)).toBe(true);
  });
  it('keeps full search paths independent of collapsed ancestors and shows rename origins', () => {
    const match = row('src/deep/file.ts', 0); match.node.change = { path: 'src/deep/file.ts', previousPath: 'old/file.ts', status: 'R100', beforeMode: '100644', afterMode: '100644', beforeOid: 'a', afterOid: 'b' };
    const layout = layoutTree([match, row('other/file.ts', 0)], 'horizontal', true);
    expect(layout.nodes[0].label).toBe('src/deep/file.ts ← old/file.ts');
    expect(layout.nodes.every(node => node.parent === undefined)).toBe(true);
  });
  it('uses compact preorder rows and depth indentation in the vertical view', () => {
    const layout = layoutTree([row('src', 0, true), row('src/a', 1, true), row('src/a/file', 2), row('src/b', 1)], 'vertical');
    expect(layout.nodes.map(node => node.x)).toEqual([0, 34, 68, 34]);
    expect(layout.nodes.map(node => node.y)).toEqual([0, 38, 76, 114]);
    expect(layout.nodes[1].y - layout.nodes[0].y).toBeGreaterThan(graphNodeHeight);
    expect(treeEdge(layout.nodes[3], layout.nodes[0], 'vertical').path).toBe('M14,28 V128 H34');
  });
  it('gives radial siblings separated labels with readable rotation and separate depth rings', () => {
    const layout = layoutTree([row('root', 0, true), ...Array.from({ length: 40 }, (_, i) => row(`root/file-${i}.ts`, 1))], 'radial');
    const ring = layout.nodes.slice(1);
    expect(ring.every(node => node.angle >= -90 && node.angle <= 90)).toBe(true);
    const ordered = [...ring].sort((a, b) => Math.atan2(a.anchorY, a.anchorX) - Math.atan2(b.anchorY, b.anchorX));
    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i], b = ordered[(i + 1) % ordered.length];
      expect(Math.hypot(a.anchorX - b.anchorX, a.anchorY - b.anchorY)).toBeGreaterThan(27);
      expect(Math.cos(a.angle * Math.PI / 180)).toBeGreaterThanOrEqual(-.00001);
    }
    expect(Math.hypot(ring[0].anchorX, ring[0].anchorY) - Math.hypot(layout.nodes[0].anchorX, layout.nodes[0].anchorY)).toBeGreaterThan(layout.nodes[0].labelWidth);
  });
  it('fits a typical 12-node radial snapshot with readable labels in the page canvas', () => {
    const rows = [row('src', 0, true), row('src/git', 1, true), row('src/git/tree.ts', 2), row('src/index.ts', 1), row('docs', 0, true), row('docs/README.md', 1), row('docs/spec.md', 1), row('tests', 0, true), row('tests/tree.test.ts', 1), row('package.json', 0), row('README.md', 0), row('tsconfig.json', 0)];
    rows[8].node.change = { path: 'tests/tree.test.ts', previousPath: 'tests/very-long-original-name.test.ts', status: 'R100', beforeMode: '100644', afterMode: '100644', beforeOid: 'a', afterOid: 'b' };
    const layout = layoutTree(rows, 'radial');
    const camera = fitTree(layout.bounds, 1100, 480);
    expect(camera.scale).toBeGreaterThanOrEqual(.65);
    expect(layout.nodes[8].row.node.change?.previousPath).toBe('tests/very-long-original-name.test.ts');
    expect(layout.nodes[8].label).toBe('tree.test.ts');
    expect(layout.root).toEqual({ x: 0, y: 0 });
    expect(layout.nodes.every(node => intersects(node, layout.bounds))).toBe(true);
    expect(layoutTree(rows, 'horizontal').root).toBeDefined();
  });
  it('zooms around the pointer and fitting restores all bounds after pan and zoom', () => {
    const layout = layoutTree([row('src', 0, true), row('src/file', 1)], 'horizontal');
    const original = fitTree(layout.bounds, 800, 500), zoomed = zoomTree(original, 2, 123, 234);
    expect((123 - zoomed.x) / zoomed.scale).toBeCloseTo((123 - original.x) / original.scale);
    expect((234 - zoomed.y) / zoomed.scale).toBeCloseTo((234 - original.y) / original.scale);
    const panned = { ...zoomed, x: zoomed.x - 10000, y: zoomed.y + 10000 };
    expect(panned).not.toEqual(original);
    expect(fitTree(layout.bounds, 800, 500)).toEqual(original);
    const middle = { x: 20, y: 0, width: 10, height: 10 };
    expect(intersects({ x: 0, y: 5, width: 50, height: 0 }, middle)).toBe(true);
  });
});
