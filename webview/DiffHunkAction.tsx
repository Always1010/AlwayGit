import React from 'react';
import type { DiffRow, PatchHunk, PatchHunks } from '../src/protocol/diff';
import { useTranslation } from './i18n';
import { Button } from './ui';

/** Anchor a complete Git hunk at its first context line; visual blocks are independent. */
export function patchHunkAtRow(hunks: PatchHunks | undefined, row: DiffRow): PatchHunk | undefined {
  return hunks?.hunks.find(hunk => hunk.beforeCount > 0 ? row.beforeLine === hunk.beforeStart : row.afterLine === hunk.afterStart);
}
export function DiffHunkAction({ hunk, area, disabled, apply }: { hunk: PatchHunk; area: 'staged' | 'unstaged'; disabled: boolean; apply(id: string): void }) {
  const t = useTranslation(), label = `${t(area === 'staged' ? 'diff.unstageHunk' : 'diff.stageHunk')}: ${hunk.header}`;
  return <Button className="icon-only diff-hunk-action" icon={area === 'staged' ? 'remove' : 'add'} title={label} aria-label={label} disabled={disabled} onClick={() => apply(hunk.id)}/>;
}
