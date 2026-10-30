import { z } from 'zod';
import type { Commit } from './types';
import { treeExpansionPreferencesSchema } from './tree-expansion';

const fixedRevisionSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
export const commitTreeTargetSchema = z
  .object({
    repoId: z.string().min(1).max(4096),
    revision: fixedRevisionSchema,
    baseRevision: fixedRevisionSchema.optional(),
  })
  .strict();
export const treeViewModeSchema = z.enum(['list', 'horizontal', 'radial', 'vertical']);
const coordinate = z.number().finite().min(-1e9).max(1e9);
const scrollOffset = z.number().finite().min(0).max(1e9);
export const treeCameraStateSchema = z.object({
  centerX: coordinate,
  centerY: coordinate,
  scale: z.number().finite().min(0.000001).max(6),
});
export type TreeCameraState = z.infer<typeof treeCameraStateSchema>;
export const treePreviewStateSchema = z.object({
  key: z.string().max(16384),
  top: scrollOffset.optional().catch(undefined),
  left: scrollOffset.optional().catch(undefined),
  imageZoom: z
    .union([z.literal('fit'), z.number().positive().max(16)])
    .optional()
    .catch(undefined),
  maximized: z.boolean().optional().catch(undefined),
  collapsed: z.boolean().optional().catch(undefined),
});
export type TreePreviewState = z.infer<typeof treePreviewStateSchema>;
/** Invalid optional fields fall back independently; old panels contain only commitTree. */
export const commitTreeViewStateSchema = z.object({
  viewMode: treeViewModeSchema.optional().catch(undefined),
  showChanges: z.boolean().optional().catch(undefined),
  changesOnly: z.boolean().optional().catch(undefined),
  wheelMode: z.enum(['zoom', 'scroll']).optional().catch(undefined),
  query: z.string().max(8192).optional().catch(undefined),
  selected: z.string().max(8192).optional().catch(undefined),
  selectedParent: fixedRevisionSchema.optional().catch(undefined),
  previewOpen: z.boolean().optional().catch(undefined),
  previewSplit: z
    .object({
      x: z.number().min(0).max(1).optional().catch(undefined),
      y: z.number().min(0).max(1).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  expansion: treeExpansionPreferencesSchema.optional().catch(undefined),
  changeExpanded: z.array(z.string().max(8192)).max(100000).optional().catch(undefined),
  cameras: z
    .object({
      horizontal: treeCameraStateSchema.optional().catch(undefined),
      radial: treeCameraStateSchema.optional().catch(undefined),
      vertical: treeCameraStateSchema.optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  listScroll: z.object({ top: scrollOffset, left: scrollOffset }).optional().catch(undefined),
  preview: treePreviewStateSchema.optional().catch(undefined),
});
export type CommitTreeViewState = z.infer<typeof commitTreeViewStateSchema>;
export const commitTreePanelStateSchema = z
  .object({
    commitTree: commitTreeTargetSchema,
    view: commitTreeViewStateSchema.optional().catch(undefined),
  })
  .strict();
export type CommitTreeTarget = z.infer<typeof commitTreeTargetSchema>;
export type CommitTreePanelState = z.infer<typeof commitTreePanelStateSchema>;
export interface RevisionTreeCommit {
  commit: Commit;
  body: string;
  repository: { name: string; root: string };
}
export interface RevisionTreeChange {
  path: string;
  previousPath?: string;
  status: string;
  beforeMode: string;
  afterMode: string;
  beforeOid: string;
  afterOid: string;
}
export interface RevisionTreeChanges {
  revision: string;
  parent?: string;
  baseRevision?: string;
  files: RevisionTreeChange[];
}

export type RevisionTreeEntryType = 'tree' | 'blob' | 'symlink' | 'gitlink';

export interface RevisionTreeEntry {
  name: string;
  path: string;
  oid: string;
  mode: string;
  type: RevisionTreeEntryType;
  size?: number;
}

export interface RevisionTreeRequest {
  /** A full commit object ID. The host resolves and returns the immutable ID. */
  revision: string;
  path?: string;
  /** Internal full snapshot index; never bounded by the search result limit. */
  recursive?: boolean;
}

export interface RevisionTreeListing {
  revision: string;
  path: string;
  entries: RevisionTreeEntry[];
}

export interface RevisionTreeSearchRequest {
  revision: string;
  query: string;
  cursor?: number;
  limit?: number;
}

export interface RevisionTreeSearchPage {
  revision: string;
  query: string;
  entries: RevisionTreeEntry[];
  nextCursor?: number;
  /** True when the repository exceeded the bounded search scan. */
  truncated: boolean;
}

export interface RevisionTarget {
  revision: string;
  path: string;
}
