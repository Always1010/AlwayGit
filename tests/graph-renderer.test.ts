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
    expect(markup).toContain('height="32"');
    expect(markup.match(/<path/g)).toHaveLength(2);
    expect(markup.match(/<circle/g)).toHaveLength(2);
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
});
