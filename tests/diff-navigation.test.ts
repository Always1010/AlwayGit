import { describe, expect, it } from 'vitest';
import { alignDiff, changedRanges } from '../webview/diff';

describe('Diff change navigation', () => {
  it('groups adjacent changed rows and keeps separate changes independently navigable', () => {
    const rows=alignDiff('same\nold a\nold b\ncontext\ntail', 'same\nnew a\nnew b\ncontext\nadded\ntail');
    const ranges=changedRanges(rows);

    expect(ranges).toHaveLength(2);
    expect(rows.slice(ranges[0].start,ranges[0].end+1).every(row=>row.changed)).toBe(true);
    expect(rows.slice(ranges[1].start,ranges[1].end+1).every(row=>row.changed)).toBe(true);
    expect(ranges[1].start).toBeGreaterThan(ranges[0].end+1);
  });
});
