import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/protocol/types';
import { repositoryViewState } from '../webview/repositoryState';

const snapshot = (branch: string): Snapshot => ({ repository: { id: 'repo', root: '/repo', commonDir: '/repo/.git', name: 'repo' }, branch, ahead: 0, behind: 0, changes: [], refs: [], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 1 });

describe('repository view state', () => {
  it('does not describe an empty or loading workbench as Detached HEAD', () => {
    expect(repositoryViewState(undefined, false, false)).toBe('unselected');
    expect(repositoryViewState(undefined, true, true)).toBe('opening');
    expect(repositoryViewState(undefined, true, false)).toBe('unavailable');
  });

  it('uses Detached HEAD only for a loaded repository without a branch', () => {
    expect(repositoryViewState(snapshot('main'), true, false)).toBe('branch');
    expect(repositoryViewState(snapshot(''), true, false)).toBe('detached');
  });
});
