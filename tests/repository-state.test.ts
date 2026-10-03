import { describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../src/protocol/types';
import { repositoryViewState } from '../webview/repositoryState';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RepositoryCatalogStatus } from '../webview/RepositoryCatalogStatus';

vi.mock('../webview/store',()=>({useWorkbench:(selector:(state:unknown)=>unknown)=>selector({language:'en',singleKeyShortcuts:true,shortcutOverrides:{}})}));

const snapshot = (branch: string): Snapshot => ({ repository: { id: 'repo', root: '/repo', commonDir: '/repo/.git', name: 'repo' }, branch, ahead: 0, behind: 0, changes: [], refs: [], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 1 });

describe('repository view state', () => {
  it('announces catalog loading without an add action and offers retry only after failure',()=>{
    const props={retry:()=>{},showLog:()=>{}};
    const loading=renderToStaticMarkup(createElement(RepositoryCatalogStatus,{...props,phase:'loading'}));
    expect(loading).toContain('role="status"');expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('Loading repositories');expect(loading).not.toContain('<button');
    const failure=renderToStaticMarkup(createElement(RepositoryCatalogStatus,{...props,phase:'error',error:'catalog damaged'}));
    expect(failure).toContain('role="alert"');expect(failure).toContain('catalog damaged');
    expect(failure).toContain('Retry');expect(failure).toContain('Show Log');
  });
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
