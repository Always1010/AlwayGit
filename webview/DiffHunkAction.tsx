import React from 'react';
import type { DiffRow, PatchHunk, PatchHunks } from '../src/protocol/diff';
import { useTranslation } from './i18n';
import { Button } from './ui';

/** Only actual changed lines anchor actions; context never owns a block button. */
export function patchHunkAtRow(hunks: PatchHunks | undefined, row: DiffRow): PatchHunk | undefined {
  return row.changed ? hunks?.hunks.find(hunk => hunk.beforeCount > 0 ? row.beforeLine === hunk.beforeStart : row.afterLine === hunk.afterStart) : undefined;
}
export function patchHunkForRow(hunks: PatchHunks | undefined, row: DiffRow): PatchHunk | undefined {
  if (!row.changed) return;
  return hunks?.hunks.find(hunk => hunk.beforeCount > 0 && row.beforeLine !== undefined && row.beforeLine >= hunk.beforeStart && row.beforeLine < hunk.beforeStart + hunk.beforeCount
    || hunk.afterCount > 0 && row.afterLine !== undefined && row.afterLine >= hunk.afterStart && row.afterLine < hunk.afterStart + hunk.afterCount);
}
export function DiffHunkAction({ hunk, area, disabled, apply }: { hunk: PatchHunk; area: 'staged' | 'unstaged'; disabled: boolean; apply(id: string): void }) {
  const t = useTranslation(), label = `${t(area === 'staged' ? 'diff.unstageHunk' : 'diff.stageHunk')}: ${hunk.header}`;
  return <Button className={`diff-hunk-action ${area === 'staged' ? 'diff-hunk-right' : 'diff-hunk-left'}`} title={label} aria-label={label} disabled={disabled} onClick={() => apply(hunk.id)}><span aria-hidden="true">{area === 'staged' ? '»' : '«'}</span></Button>;
}
