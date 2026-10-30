/** A zero-context Git hunk. Starts use Git's one-based/empty-range convention. */
export interface TextDiffHunk {
  beforeStart: number;
  beforeCount: number;
  afterStart: number;
  afterCount: number;
}
export interface DiffRow {
  before?: string;
  after?: string;
  beforeLine?: number;
  afterLine?: number;
  changed: boolean;
}
export interface DiffChangeRange {
  start: number;
  end: number;
}
export interface DiffChangeSummary {
  added: number;
  modified: number;
  removed: number;
}
export interface DiffIndex {
  token: string;
  rowCount: number;
  changes: DiffChangeRange[];
  summary: DiffChangeSummary;
  columns: number;
}
export interface DiffPage {
  token: string;
  start: number;
  rows: DiffRow[];
}

/** Host-issued zero-context patches for individual contiguous change blocks. */
export interface PatchHunk extends TextDiffHunk {
  id: string;
  header: string;
}
export interface PatchHunks {
  token?: string;
  hunks: PatchHunk[];
  unavailable?: 'unsupported' | 'changed';
}
