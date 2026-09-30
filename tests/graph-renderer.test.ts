import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GraphRow } from '../webview/graph/GraphRow';
import { layoutGraph } from '../webview/graph/layout';

describe('Git graph SVG rows', () => {
  it('exposes parent relationships and merge status without relying on color', () => {
    const { rows } = layoutGraph([{
      oid: 'merge123456', parents: ['first123456', 'second123456'],
      author: 'A', email: 'a@example.com', timestamp: 0, subject: 'Merge',
    }]);
    const markup = renderToStaticMarkup(React.createElement(GraphRow, { row: rows[0] }));
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-labelledby=');
    expect(markup).toContain('Commit merge123, lane 1. Merge commit; parents first123, second12.');
    expect(markup).toContain('height="26"');
    expect(markup).toContain('cy="13"');
    expect(markup.match(/<path/g)).toHaveLength(2);
    expect(markup.match(/<circle/g)).toHaveLength(2);
  });

  it('marks HEAD visibly and in the accessible description even when detached', () => {
    const { rows } = layoutGraph([{
      oid: 'detached123456', parents: [], author: 'A', email: 'a@example.com', timestamp: 0, subject: 'Detached',
    }]);
    const markup = renderToStaticMarkup(React.createElement(GraphRow, {
      row: rows[0], head: true, selected: true,
    }));
    expect(markup).toContain('Current HEAD. Selected commit.');
    expect(markup).toContain('data-head="true"');
    expect(markup).toContain('class="git-graph-head-ring"');
    expect(markup).toContain('r="6.5"');
    expect(markup).toContain('var(--vscode-focusBorder, currentColor)');
    expect(markup).toContain('var(--vscode-list-activeSelectionForeground, currentColor)');
    expect(markup.match(/<circle/g)).toHaveLength(2);
  });

  it('keeps merge curves within the compact row and leaves ordinary commits unmarked', () => {
    const { rows } = layoutGraph([{
      oid: 'merge', parents: ['first', 'second'], author: 'A', email: 'a@example.com', timestamp: 0, subject: 'Merge',
    }]);
    const markup = renderToStaticMarkup(React.createElement(GraphRow, { row: rows[0] }));
    expect(markup).toContain('d="M 8 13 C 8 19.5, 24 19.5, 24 26"');
    expect(markup).not.toContain('git-graph-head-ring');
    expect(markup).not.toContain('data-head');
    expect(markup).not.toContain('Current HEAD');
  });

  it('labels a parentless root and preserves the requested row dimensions', () => {
    const { rows } = layoutGraph([{
      oid: 'root', parents: [], author: 'A', email: 'a@example.com', timestamp: 0, subject: 'Root',
    }]);
    const markup = renderToStaticMarkup(React.createElement(GraphRow, {
      row: rows[0], height: 40, width: 120,
    }));
    expect(markup).toContain('Root commit; no parents');
    expect(markup).toContain('height="40"');
    expect(markup).toContain('width="120"');
    expect(markup).not.toContain('<path');
  });

  it('renders the default branch as a heavier neutral path', () => {
    const { rows } = layoutGraph([{
      oid: 'main-tip', parents: ['main-parent'], author: 'A', email: 'a@example.com', timestamp: 0, subject: 'Main',
    }]);
    const mainTargets=new Set(['main-tip','main-parent']);
    const markup=renderToStaticMarkup(React.createElement(GraphRow,{row:rows[0],main:true,mainTargets}));
    expect(markup).toContain('data-main="true"');
    expect(markup).toContain('Main branch.');
    expect(markup).toContain('stroke="var(--graph-main, #f2f2f2)"');
    expect(markup).toContain('stroke-width="3"');
    expect(markup).toContain('fill="var(--graph-main, #f2f2f2)"');
  });

  it('uses extended palette slots and highlights a lineage without losing HEAD', () => {
    const { rows } = layoutGraph([{
      oid: 'merge', parents: Array.from({ length: 16 }, (_, index) => `parent${index}`),
      author: 'A', email: 'a@example.com', timestamp: 0, subject: 'Wide merge',
    }], undefined, 'extended');
    const highlighted = rows[0].segments.find(segment => segment.color === 15)!;
    const markup = renderToStaticMarkup(React.createElement(GraphRow, {
      row: rows[0], paletteId: 'extended', hoveredPath: highlighted.pathId, head: true,
    }));
    expect(markup).toContain('var(--graph-lane-15,');
    expect(markup).toContain(`data-path-id="${highlighted.pathId}"`);
    expect(markup).toContain('stroke-width="4"');
    expect(markup).toContain('opacity="0.35"');
    expect(markup).toContain('git-graph-head-ring');
  });
});
