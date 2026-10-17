import React from 'react';
import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { translator } from '../src/i18n';
import { DiffHunkAction, patchHunkAtRow } from '../webview/DiffHunkAction';
vi.mock('../webview/i18n', () => ({ useTranslation: () => translator('en') }));
vi.mock('../webview/store', () => ({ useWorkbench: (select: (state: unknown) => unknown) => select({ singleKeyShortcuts: true }) }));
const hunk = { id: 'host-id', beforeStart: 4, beforeCount: 8, afterStart: 4, afterCount: 9, header: '@@ -4,8 +4,9 @@' };
it('renders accessible icon actions with complete Git hunk scope and disables during writes', () => {
  const stage = renderToStaticMarkup(<DiffHunkAction hunk={hunk} area="unstaged" disabled={false} apply={() => {}}/>);
  expect(stage).toContain('aria-label="Stage Git hunk: @@ -4,8 +4,9 @@"'); expect(stage).toContain('title="Stage Git hunk: @@ -4,8 +4,9 @@"'); expect(stage).toContain('codicon-add');
  const unstage = renderToStaticMarkup(<DiffHunkAction hunk={hunk} area="staged" disabled={true} apply={() => {}}/>);
  expect(unstage).toContain('aria-label="Unstage Git hunk: @@ -4,8 +4,9 @@"'); expect(unstage).toContain('codicon-remove'); expect(unstage).toContain('disabled');
});
it('anchors actions at Git context starts, including additions and deletions, independently of display change rows', () => {
  const metadata = { token: 'host-token', hunks: [hunk] };
  expect(patchHunkAtRow(metadata, { changed: false, beforeLine: 4, afterLine: 4 })).toBe(hunk);
  expect(patchHunkAtRow(metadata, { changed: true, beforeLine: 7, afterLine: 7 })).toBeUndefined();
  expect(patchHunkAtRow({ hunks: [{ ...hunk, beforeStart: 0, beforeCount: 0, afterStart: 1 }] }, { changed: true, afterLine: 1 })?.id).toBe('host-id');
  expect(patchHunkAtRow({ hunks: [{ ...hunk, beforeStart: 1, afterStart: 0, afterCount: 0 }] }, { changed: true, beforeLine: 1 })?.id).toBe('host-id');
  expect(patchHunkAtRow(undefined, { changed: true, beforeLine: 4 })).toBeUndefined();
});
