import React from 'react';
import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { translator } from '../src/i18n';
import { DiffHunkAction, patchHunkAtRow, patchHunkForRow } from '../webview/DiffHunkAction';
vi.mock('../webview/i18n', () => ({ useTranslation: () => translator('en') }));
vi.mock('../webview/store', () => ({
  useWorkbench: (select: (state: unknown) => unknown) => select({ singleKeyShortcuts: true }),
}));
const hunk = {
  id: 'host-id',
  beforeStart: 4,
  beforeCount: 8,
  afterStart: 4,
  afterCount: 9,
  header: '@@ -4,8 +4,9 @@',
};
it('renders directional block actions with concise accessible labels and disables during writes', () => {
  const stage = renderToStaticMarkup(
    <DiffHunkAction hunk={hunk} area="unstaged" disabled={false} apply={() => {}} />,
  );
  expect(stage).toContain('aria-label="Stage block"');
  expect(stage).toContain('title="Stage block"');
  expect(stage).not.toContain('@@');
  expect(stage).toContain('diff-hunk-left');
  expect(stage).toContain('«');
  const unstage = renderToStaticMarkup(
    <DiffHunkAction hunk={hunk} area="staged" disabled={true} apply={() => {}} />,
  );
  expect(unstage).toContain('aria-label="Unstage block"');
  expect(unstage).toContain('title="Unstage block"');
  expect(unstage).not.toContain('@@');
  expect(unstage).toContain('diff-hunk-right');
  expect(unstage).toContain('»');
  expect(unstage).toContain('disabled');
  const working = renderToStaticMarkup(
    <DiffHunkAction
      hunk={hunk}
      area="unstaged"
      disabled={false}
      apply={() => {}}
      discard={() => {}}
    />,
  );
  expect(working).toContain('Discard block');
  expect(working).toContain('»');
  expect(working).toContain('«');
  const staged = renderToStaticMarkup(
    <DiffHunkAction
      hunk={hunk}
      area="staged"
      disabled={false}
      apply={() => {}}
      discard={() => {}}
    />,
  );
  expect(staged).not.toContain('Discard block');
});
it('anchors actions only at actual changed lines and tracks the entire block', () => {
  const metadata = { token: 'host-token', hunks: [hunk] };
  expect(patchHunkAtRow(metadata, { changed: false, beforeLine: 4, afterLine: 4 })).toBeUndefined();
  expect(patchHunkAtRow(metadata, { changed: true, beforeLine: 4, afterLine: 4 })).toBe(hunk);
  expect(patchHunkAtRow(metadata, { changed: true, beforeLine: 7, afterLine: 7 })).toBeUndefined();
  expect(
    patchHunkAtRow(
      { hunks: [{ ...hunk, beforeStart: 0, beforeCount: 0, afterStart: 1 }] },
      { changed: true, afterLine: 1 },
    )?.id,
  ).toBe('host-id');
  expect(
    patchHunkAtRow(
      { hunks: [{ ...hunk, beforeStart: 1, afterStart: 0, afterCount: 0 }] },
      { changed: true, beforeLine: 1 },
    )?.id,
  ).toBe('host-id');
  expect(patchHunkAtRow(undefined, { changed: true, beforeLine: 4 })).toBeUndefined();
  expect(patchHunkForRow(metadata, { changed: true, beforeLine: 7, afterLine: 7 })).toBe(hunk);
  expect(
    patchHunkForRow(metadata, { changed: true, beforeLine: 20, afterLine: 20 }),
  ).toBeUndefined();
  expect(
    patchHunkForRow(metadata, { changed: false, beforeLine: 7, afterLine: 7 }),
  ).toBeUndefined();
});
