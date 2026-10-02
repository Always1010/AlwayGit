import { describe, expect, it } from 'vitest';
import { statusBarPresentation } from '../src/extension/workbench-entry';

describe('Workbench entry presentation', () => {
  it('opens a missing workbench and focuses an existing hidden workbench', () => {
    expect(statusBarPresentation({ open: false, active: false })).toEqual({ visible: true, tooltip: 'Open AlwayGit Workbench' });
    expect(statusBarPresentation({ open: true, active: false })).toEqual({ visible: true, tooltip: 'Show AlwayGit Workbench' });
  });

  it('does not show a redundant launcher while Workbench is active', () => {
    expect(statusBarPresentation({ open: true, active: true })).toEqual({ visible: false, tooltip: 'Show AlwayGit Workbench' });
  });
});
