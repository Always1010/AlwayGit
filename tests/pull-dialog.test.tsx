import React from 'react';
import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionDialog } from '../webview/ActionDialog';

const fixture = vi.hoisted(() => ({
  state: {
    repoId: 'repo',
    language: 'en',
    busy: false,
    tagQueries: {},
    operationSettings: {
      defaultPullStrategy: 'rebase',
      defaultResetMode: 'mixed',
    },
    snapshot: {
      repository: { id: 'repo', name: 'Example' },
      branch: 'main',
      head: 'a'.repeat(40),
      upstream: 'origin/main',
      remotes: ['origin'],
      refs: [],
      changes: [],
      stashes: [],
      worktrees: [],
      operation: {},
    },
  },
}));
vi.mock('../webview/store', () => ({
  useWorkbench: Object.assign(
    (selector?: (state: typeof fixture.state) => unknown) =>
      selector ? selector(fixture.state) : fixture.state,
    { getState: () => fixture.state },
  ),
  captureActionContext: () => ({ repoId: 'repo', epoch: 1 }),
}));
vi.mock('../webview/rpc', () => ({ demoMode: false, rpc: vi.fn() }));

it.each(['rebase', 'merge', 'ff-only'])(
  'opens Pull with the applied %s default selected',
  (strategy) => {
    fixture.state.operationSettings.defaultPullStrategy = strategy;
    const html = renderToStaticMarkup(
      <ActionDialog
        dialog={{ type: 'pull' }}
        onClose={() => {}}
        openAbort={() => {}}
        replaceDialog={() => {}}
      />,
    );
    const options = html.match(/<select[^>]*aria-label="Pull Strategy"[^>]*>(.*?)<\/select>/)?.[1];
    expect(options).toContain(`<option value="${strategy}" selected="">`);
    expect(options?.match(/selected=""/g)).toHaveLength(1);
  },
);
