import { z } from 'zod';
import type { Commit } from './types';

export const commitTreeTargetSchema = z.object({ repoId: z.string().min(1).max(4096), revision: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/) }).strict();
export const commitTreePanelStateSchema = z.object({ commitTree: commitTreeTargetSchema }).strict();
export type CommitTreeTarget = z.infer<typeof commitTreeTargetSchema>;
export type CommitTreePanelState = z.infer<typeof commitTreePanelStateSchema>;
export interface RevisionTreeCommit { commit: Commit; body: string; repository: { name: string; root: string } }

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
