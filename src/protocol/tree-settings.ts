import { z } from 'zod';
import type { CommitTreeViewState } from './tree';

export const treeViewModeSchema = z.enum(['list', 'horizontal', 'radial', 'vertical']);
const changes = (showChanges: boolean) =>
  z
    .object({
      showChanges: z.boolean().default(showChanges),
      changesOnly: z.boolean().default(false),
    })
    .strict()
    .transform((value) => ({ ...value, showChanges: value.showChanges || value.changesOnly }));
export const treeDefaultsSchema = z
  .object({
    opening: z.enum(['recent', 'defaults']).default('recent'),
    viewMode: treeViewModeSchema.default('list'),
    wheelMode: z.enum(['zoom', 'scroll']).default('zoom'),
    previewOpen: z.boolean().default(false),
    expansion: z.enum(['remember', 'auto', 'expanded', 'collapsed']).default('remember'),
    single: changes(false).default({ showChanges: false, changesOnly: false }),
    comparison: changes(true).default({ showChanges: true, changesOnly: false }),
  })
  .strict();
export type TreeDefaults = z.infer<typeof treeDefaultsSchema>;
export function readTreeDefaults(
  value?: unknown,
  legacyWheel: 'zoom' | 'scroll' = 'zoom',
): TreeDefaults {
  const parsed = treeDefaultsSchema.safeParse(value ?? { wheelMode: legacyWheel });
  return parsed.success ? parsed.data : treeDefaultsSchema.parse({ wheelMode: legacyWheel });
}
export function inheritedTreeView(view: CommitTreeViewState = {}): CommitTreeViewState {
  const { viewMode, showChanges, changesOnly, wheelMode, previewOpen, previewSplit } = view;
  return Object.fromEntries(
    Object.entries({
      viewMode,
      showChanges,
      changesOnly,
      wheelMode,
      previewOpen,
      previewSplit,
    }).filter(([, value]) => value !== undefined),
  );
}
export function openingTreeView(
  defaults: TreeDefaults,
  comparison: boolean,
  recent?: CommitTreeViewState,
): CommitTreeViewState {
  return {
    viewMode: defaults.viewMode,
    wheelMode: defaults.wheelMode,
    previewOpen: defaults.previewOpen,
    ...(comparison ? defaults.comparison : defaults.single),
    ...(defaults.opening === 'recent' && recent ? inheritedTreeView(recent) : {}),
    ...(defaults.expansion !== 'remember'
      ? {
          expansion: { mode: defaults.expansion, overrides: {} },
        }
      : {}),
  };
}
