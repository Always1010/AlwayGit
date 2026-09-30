export interface Repository { id: string; root: string; commonDir: string; name: string; mainRoot?: string }
export interface RepositoryStatus { repositoryId: string; branch: string; upstream?: string; ahead: number; unpushed: number }
export interface Change { path: string; originalPath?: string; indexStatus: string; worktreeStatus: string; conflict: boolean; untracked: boolean }
export interface GitRef { name: string; fullName: string; kind: 'local' | 'remote' | 'tag'; oid: string; targetType?: 'commit' | 'tree' | 'blob' | 'tag'; upstream?: string; symbolicTarget?: string }
export interface Stash { selector: string; oid: string; subject: string }
export interface Worktree { path: string; head: string; branch?: string; bare: boolean; detached: boolean; locked?: string; prunable?: string }
export type OperationKind = 'merge' | 'rebase' | 'cherry-pick' | 'revert';
export interface OperationState { kind?: OperationKind; conflicts: number; canContinue: boolean; canAbort: boolean; canSkip: boolean }
export interface PushTarget { localBranch: string; remote?: string; remoteBranch: string; configured: boolean }
export interface Snapshot { repository: Repository; branch: string; head?: string; upstream?: string; defaultBranch?: string; pushTarget?: PushTarget; ahead: number; behind: number; unpushed?: number; changes: Change[]; refs: GitRef[]; remotes?: string[]; stashes: Stash[]; worktrees: Worktree[]; operation: OperationState; version: number }
export interface Commit { oid: string; parents: string[]; author: string; email: string; timestamp: number; subject: string; pushed?: boolean }
export interface HistoryQuery { offset?: number; limit?: number; tips?: string[]; ref?: string; search?: string }
export interface HistoryPage { commits: Commit[]; nextOffset: number; hasMore: boolean; tips: string[] }
export interface CommitFile { path: string; previousPath?: string; status: string }
export interface CommitDetails { commit: Commit; body: string; files: CommitFile[]; parent?: string }
export interface CommitComparison { left: Commit; right: Commit; files: CommitFile[] }
export type GitAction =
  | { type: 'stage' | 'unstage' | 'discard'; paths: string[] }
  | { type: 'commit'; message: string; amend?: boolean }
  | { type: 'fetch'; remote?: string }
  | { type: 'pull'; strategy: 'ff-only' | 'merge' | 'rebase'; remote?: string }
  | { type: 'push'; remote?: string; branch?: string; remoteBranch?: string; setUpstream?: boolean; forceWithLease?: boolean }
  | { type: 'branch.create'; name: string; start?: string; checkout?: boolean }
  | { type: 'branch.checkout'; name: string }
  | { type: 'commit.checkout'; target: string }
  | { type: 'checkout.stash'; target: string; detached?: boolean; includeUntracked?: boolean }
  | { type: 'branch.delete'; names: string[]; force?: boolean; expectedOids?: Record<string,string> }
  | { type: 'tag.create'; name: string; target?: string; message?: string }
  | { type: 'tag.delete'; name: string }
  | { type: 'stash.create'; message?: string; includeUntracked?: boolean }
  | { type: 'stash.apply'; selector: string; pop?: boolean; expectedOid?: string }
  | { type: 'stash.drop'; selector: string; expectedOid?: string }
  | { type: 'worktree.add'; path: string; branch?: string; newBranch?: string; start?: string; detach?: boolean }
  | { type: 'worktree.remove'; path: string; force?: boolean }
  | { type: 'merge' | 'rebase'; target: string }
  | { type: 'cherry-pick' | 'revert'; commits: string[]; mainline?: number; expectedHead?: string; expectedBranch?: string }
  | { type: 'reset'; target: string; mode: 'soft' | 'mixed' | 'hard' }
  | { type: 'operation.continue' | 'operation.abort' | 'operation.skip'; kind: OperationKind };
export type ContentSource = { kind: 'revision'; revision: string; path: string } | { kind: 'index'; path: string; stage?: 0 | 1 | 2 | 3 } | { kind: 'empty' };
export type DiffTarget = { kind: 'change'; path: string; area: 'staged' | 'unstaged' | 'conflict' } | { kind: 'commit'; oid: string; path: string; parent?: string; previousPath?: string } | { kind: 'comparison'; left: string; right: string; path: string; previousPath?: string };
export interface DiffPreview { path: string; leftLabel: string; rightLabel: string; left: string; right: string; binary?: boolean; truncated?: boolean }
export interface CheckoutBlocker { reason: 'local-changes' | 'conflicts' | 'operation-active' | 'worktree-occupied' | 'checkout-failed'; paths: string[]; target: string; worktreePath?: string; stashOid?: string; stashCreated?: boolean }
export interface RpcRequest { id: string; method: 'repositories' | 'repositoryStatuses' | 'addRepository' | 'snapshot' | 'history' | 'details' | 'compare' | 'action' | 'diff' | 'diffPreview' | 'copyText' | 'openRepository' | 'openProject' | 'openFile' | 'openWorktree' | 'pickWorktree' | 'showLog' | 'saveSession'; repoId?: string; payload?: unknown }
/** Missing paths means the source cannot limit which working files changed. */
export interface RepositoryChanges { paths?: string[]; index?: boolean }
export type HostMessage = { type: 'response'; id: string; result?: unknown; error?: { message: string; code?: string; details?: CheckoutBlocker } } | { type: 'changed'; repoId: string; changes?: RepositoryChanges } | { type: 'activity'; repoId: string; busy: boolean; label: string } | { type: 'repositoriesChanged' } | { type: 'selectRepository'; repoId: string };
export interface GitServiceContract {
  discover(root: string): Promise<Repository>;
  repositoryStatus(repo: Repository): Promise<RepositoryStatus>;
  snapshot(repo: Repository): Promise<Snapshot>;
  history(repo: Repository, query?: HistoryQuery): Promise<HistoryPage>;
  details(repo: Repository, oid: string, parent?: string): Promise<CommitDetails>;
  compare(repo: Repository, left: string, right: string, preserveOrder?: boolean): Promise<CommitComparison>;
  content(repo: Repository, source: ContentSource, maxBytes?: number): Promise<Buffer>;
  execute(repo: Repository, action: GitAction): Promise<void>;
}
