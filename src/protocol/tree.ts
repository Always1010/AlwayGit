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
