import type { MessageDescriptor } from '../i18n';
import type { TerminalEvent } from './terminal';
export interface Repository { id: string; root: string; commonDir: string; gitDir?: string; name: string; mainRoot?: string; collectionId?: string }
export type OpenProjectResult = { kind: 'current-window'; root: string; exactRoot: boolean } | { kind: 'other-window' };
export interface RepositoryCollection { id: string; name: string }
export interface RepositoryOrder { root: string[]; collections: Record<string, string[]> }
export interface ReorderRepository { key: string; targetKey: string; position: 'before' | 'after' }
export interface RepositoryDiscoveryCandidate { key: string; name: string; path: string; existing: boolean }
export interface RepositoryDiscoveryPreview { scanId: string; root: string; scanned: number; found: number; cancelled: boolean; candidates: RepositoryDiscoveryCandidate[]; issues: { path: string; message: string }[] }
export interface AddRepositoriesResult { added: number; existing: number; skipped: number; collection?: RepositoryCollection }
export interface RepositoryStatus { repositoryId: string; branch: string; upstream?: string; ahead: number; unpushed: number }
export interface Change { path: string; originalPath?: string; indexStatus: string; worktreeStatus: string; conflict: boolean; untracked: boolean }
export interface DiscardRequest { paths?: string[]; scope?: 'unstaged' | 'all' }
export interface DiscardPlan { token: string; scope: 'unstaged' | 'all'; paths: string[]; tracked: number; untracked: number; staged: number; branch: string; head?: string }
export interface FileOperationProgress { completed: number; total: number; phase: 'restoring' | 'cleaning' }
export interface NetworkOperationProgress {
  command: 'push' | 'fetch' | 'pull';
  phase: 'connecting' | 'counting' | 'compressing' | 'sending' | 'receiving' | 'resolving' | 'waiting' | 'updating' | 'integrating' | 'refreshing';
  startedAt: number; lastOutputAt?: number; remote?: boolean;
  percent?: number; completed?: number; total?: number; transferred?: string; speed?: string;
}
export interface GitRef { name: string; fullName: string; kind: 'local' | 'remote' | 'tag'; oid: string; refOid?: string; targetType?: 'commit' | 'tree' | 'blob' | 'tag'; upstream?: string; symbolicTarget?: string }
export interface RemoteTags { remote: string; destination: string; separatePush: boolean; refs: Record<string, string>; checkedAt: number }
export interface Stash { selector: string; oid: string; subject: string }
export interface Worktree { path: string; head: string; branch?: string; bare: boolean; detached: boolean; locked?: string; prunable?: string }
export type OperationKind = 'merge' | 'rebase' | 'cherry-pick' | 'revert';
export interface OperationState { kind?: OperationKind; conflicts: number; canContinue: boolean; canAbort: boolean; canSkip: boolean; skipToken?: string; originalHead?: string; managedRebase?: import('./interactive-rebase').ManagedRebaseState }
export interface OperationReview { kind: OperationKind; token: string; files: { path: string; lines: number[]; more?: boolean; skipped?: 'binary' | 'large' | 'encoding' | 'submodule' | 'limit' }[] }
export interface PushTarget { localBranch: string; remote?: string; remoteBranch: string; configured: boolean }
export interface PullTarget { localBranch: string; remote: string; remoteBranch: string }
export interface HostingRepository { url: string; label: string; provider?: 'github' | 'gitlab' }
export interface RemoteLinks { repositories: HostingRepository[]; defaultBranch?: string }
export interface PublishedRef {
  kind: 'branch' | 'tag'; name: string;
  status: 'published' | 'updated' | 'up-to-date' | 'deleted' | 'rejected';
  url?: string; requestUrl?: string; requestKind?: 'create' | 'view'; releaseUrl?: string;
}
export interface PushResult {
  kind: 'push'; outcome: 'success' | 'partial' | 'error'; remote?: string; localBranch?: string;
  destinations: { label: string; repository?: HostingRepository; refs: PublishedRef[]; unconfirmed?: boolean }[];
  error?: string; output: string;
}
export interface DeletionResult { kind: 'deletion'; target: 'worktree' | 'branch'; succeeded: string[]; failures: { target: string; message: string }[]; notAttempted?: string[] }
export interface ActionResponse { snapshot?: Snapshot; result?: PushResult | DeletionResult; refreshWarning?: string }
export interface Snapshot { repository: Repository; branch: string; head?: string; upstream?: string; defaultBranch?: string; pushTarget?: PushTarget; pullTarget?: PullTarget; ahead: number; behind: number; unpushed?: number; changes: Change[]; refs: GitRef[]; remotes?: string[]; remoteDestinations?: Record<string, string>; remoteReadDestinations?: Record<string, string>; stashes: Stash[]; worktrees: Worktree[]; operation: OperationState; version: number }
export interface Commit { oid: string; parents: string[]; author: string; email: string; timestamp: number; subject: string; pushed?: boolean; fileHistory?: { paths: string[]; parent?: string; graphParents: string[] } }
/** The revision pins the file identity; anchorPath handles an uncommitted rename. */
export interface FileHistoryFilter { path: string; revision?: string; anchorPath?: string }
export interface HistoryQuery { offset?: number; limit?: number; tips?: string[]; ref?: string; search?: string; head?: string; file?: FileHistoryFilter; filters?: import('./history-search').HistorySearchFilters }
export interface HistoryPage { commits: Commit[]; nextOffset: number; hasMore: boolean; tips: string[]; head?: Commit; filePaths?: string[] }
export interface CommitFile { path: string; previousPath?: string; status: string }
export interface CommitDetails { commit: Commit; body: string; files: CommitFile[]; parent?: string }
export type StashSection = 'working' | 'index' | 'untracked';
export interface StashDetails { commit: Commit; body: string; sections: { working: CommitDetails; index: CommitDetails; untracked?: CommitDetails }; totalFiles: number }
export interface BranchComparisonQuery { baseRef: string; targetRef: string; baseOid?: string; targetOid?: string; mode?: 'review' | 'snapshot'; mergeBase?: string; baseOffset?: number; targetOffset?: number; limit?: number }
export interface BranchComparisonPage { commits: Commit[]; total: number; nextOffset: number; hasMore: boolean }
export interface BranchComparison { baseRef: string; targetRef: string; baseOid: string; targetOid: string; mode: 'review' | 'snapshot'; mergeBases: string[]; mergeBase?: string; diffBase?: string; files: CommitFile[]; base: BranchComparisonPage; target: BranchComparisonPage }
export interface CommitComparison { left: Commit; right: Commit; files: CommitFile[] }
export interface CherryPickCheck { head: string; branch: string; included: string[] }
export type GitAction =
  | { type: 'conflict.choose'; token: string; side: 'ours' | 'theirs' }
  | import('./lfs').LfsAction
  | import('./interactive-rebase').InteractiveRebaseAction
  | { type: 'stage' | 'resolve-and-stage' | 'unstage'; paths: string[] }
  | { type: 'stage-hunk' | 'unstage-hunk' | 'discard-hunk'; token: string; hunkId: string }
  | { type: 'discard'; paths: string[]; planToken?: string; mode?: 'all' }
  | { type: 'commit'; message: string; amend?: boolean; reviewToken?: string; files?: CommitSelection[]; expectedHead?: string; expectedBranch?: string }
  | { type: 'fetch'; remote?: string }
  | { type: 'pull'; strategy: 'ff-only' | 'merge' | 'rebase'; remote?: string; remoteBranch?: string; expectedHead?: string; expectedBranch?: string }
  | { type: 'push'; remote?: string; branch?: string; remoteBranch?: string; setUpstream?: boolean; followTags?: boolean; forceWithLease?: boolean; expectedOid?: string; expectedDestination?: string }
  | { type: 'remote.add'; name: string; url: string }
  | { type: 'branch.create'; name: string; start?: string; checkout?: boolean }
  | { type: 'branch.track'; branches: { source: string; name: string; expectedOid?: string }[]; checkout?: boolean; stashFirst?: boolean; includeUntracked?: boolean }
  | { type: 'branch.checkout'; name: string }
  | { type: 'commit.checkout'; target: string }
  | { type: 'checkout.stash'; target: string; detached?: boolean; includeUntracked?: boolean }
  | { type: 'branch.delete'; names: string[]; force?: boolean; expectedOids?: Record<string,string> }
  | { type: 'remote.delete'; remote:string; branches:string[]; expectedOids?:Record<string,string>; expectedDestination?: string }
  | { type: 'tag.create'; name: string; target?: string; message?: string; pushRemote?: string }
  | { type: 'tag.push'; remote: string; names: string[]; expectedOids: Record<string, string> }
  | { type: 'tag.delete'; name: string; expectedOid?: string; remote?: string; expectedRemoteOid?: string; expectedDestination?: string }
  | { type: 'stash.create'; message?: string; includeUntracked?: boolean; paths?: string[] }
  | { type: 'stash.apply'; selector: string; pop?: boolean; expectedOid?: string }
  | { type: 'stash.drop'; selector: string; expectedOid?: string }
  | { type: 'worktree.add'; path: string; branch?: string; newBranch?: string; start?: string; detach?: boolean }
  | ({ type: 'worktree.remove'; force?: boolean } & ({ path: string; paths?: never } | { paths: string[]; path?: never }))
  | { type: 'merge' | 'rebase'; target: string; expectedHead?: string; expectedBranch?: string }
  | { type: 'cherry-pick' | 'revert'; commits: string[]; mainline?: number; expectedHead?: string; expectedBranch?: string; allowIncluded?: boolean }
  | { type: 'reset'; target: string; mode: 'soft' | 'mixed' | 'hard'; expectedHead?: string; expectedBranch?: string }
  | { type: 'operation.continue'; kind: OperationKind; reviewToken?: string; keepEmpty?: boolean }
  | { type: 'operation.abort'; kind: OperationKind }
  | { type: 'operation.skip'; kind: OperationKind; skipToken: string };
export type ContentSource = { kind: 'revision'; revision: string; path: string } | { kind: 'index'; path: string; stage?: 0 | 1 | 2 | 3 } | { kind: 'empty' };
export interface CommitSelection { path: string; area: 'staged' | 'unstaged' }
export type DiffTarget = ({ kind: 'snapshot' } & import('./tree').RevisionTarget) | { kind: 'change'; path: string; area: 'staged' | 'unstaged' | 'conflict' } | { kind: 'commit'; oid: string; path: string; parent?: string; previousPath?: string; treeComparison?: true } | { kind: 'comparison'; left: string; right: string; path: string; previousPath?: string } | { kind: 'stash-working'; stashOid: string; path: string } | ({ kind: 'revision' } & import('./tree').RevisionTarget);
export interface DiffImage { mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string; byteLength: number; width: number; height: number }
export interface HistoricalLfsPreviewObject { side: 'left' | 'right'; revision?: string; path: string; oid: string; size: number; localObject: 'available' | 'missing' | 'unknown'; resolved: boolean; downloadable: boolean }
interface DiffPreviewBase { path: string; leftLabel: string; rightLabel: string; lfs?: HistoricalLfsPreviewObject[] }
export type DiffPreview =
  | DiffPreviewBase & { kind: 'text'; left: string; right: string; truncated?: boolean; patchHunks?: import('./diff').PatchHunks; index?: import('./diff').DiffIndex }
  | DiffPreviewBase & { kind: 'image'; left?: DiffImage; right?: DiffImage }
  | DiffPreviewBase & { kind: 'binary'; reason: 'unsupported' | 'image-too-large' | 'image-dimensions-too-large' | 'lfs-missing' | 'lfs-too-large' | 'lfs-unavailable' };
export interface CheckoutBlocker { reason: 'local-changes' | 'conflicts' | 'operation-active' | 'worktree-occupied' | 'checkout-failed'; paths: string[]; target: string; worktreePath?: string; stashOid?: string; stashCreated?: boolean; branchCreated?: boolean; trackBranches?: { source: string; name: string; expectedOid?: string }[] }
export interface StashApplyBlocker { kind: 'stash-apply'; reason: 'untracked-path-exists' | 'restore-conflict' | 'restore-blocked' | 'state-changed'; paths: string[]; conflictPaths?: string[]; selector: string; stashOid: string; stashRetained: true; workingTreeUnchanged: true; output?: string }
export type ActionBlocker = CheckoutBlocker | StashApplyBlocker;
export interface OperationSettings { allowDetachedHead: boolean; pushFollowTags: boolean; pushTagAfterCreate: boolean; defaultResetMode: 'soft' | 'mixed' | 'hard'; forceDeleteUnmergedBranches: boolean; forceRemoveDirtyWorktrees: boolean; deletionDefaultScopes?: { branch: 'user' | 'workspace'; worktree: 'user' | 'workspace' }; scope: 'workspace' | 'user'; workspaceAvailable?: boolean; overridden?: boolean }
/** File counts overlap: a tracked file may be both staged and unstaged. */
export interface WorktreeOverviewEntry extends Worktree {
  state: 'pending' | 'ready' | 'missing' | 'error' | 'bare';
  refreshedAt?: number; error?: string;
  staged?: number; unstaged?: number; untracked?: number; conflicts?: number;
  upstream?: string; ahead?: number; behind?: number;
  operation?: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'sequencer';
}
export interface RpcRequest { id: string; method: 'localCacheList' | 'localCacheClear' | 'treeExpansionHintRead' | 'treeExpansionHintDismiss' | 'treeExpansionRead' | 'treeExpansionPatch' | 'treeExpansionReset' | 'treeCompareOrder' | 'revisionTreeCompare' | 'revisionTreeChanges' | 'openCommitTree' | 'revisionTreeIndex' | 'revisionTreeCommit' | 'worktreeOverview' | 'terminalCreate' | 'terminalList' | 'terminalSync' | 'terminalClipboard' | 'terminalAck' | 'terminalInput' | 'terminalResize' | 'terminalClose' | 'terminalStop' | 'terminalRestart' | 'terminalRename' | 'repositories' | 'repositoryCollections' | 'repositoryOrder' | 'reorderRepository' | 'repositoryStatuses' | 'pickRepositoryDirectory' | 'discoverRepositories' | 'cancelRepositoryDiscovery' | 'addRepository' | 'removeRepositories' | 'createRepositoryCollection' | 'renameRepositoryCollection' | 'deleteRepositoryCollection' | 'moveRepositories' | 'snapshot' | 'operationReview' | 'conflictDetails' | 'openMergeEditor' | 'prepareDiscard' | 'copyCommitDetails' | 'tagTargetDetails' | 'amendDetails' | 'inspectDetails' | 'lfsStatus' | 'lfsHistoricalStatus' | 'lfsDestinations' | 'lfsTrackPreview' | 'reflog' | 'prepareInteractiveRebase' | 'history' | 'details' | 'stashDetails' | 'compare' | 'branchComparison' | 'cherryPickCheck' | 'revisionTree' | 'revisionTreeSearch' | 'cancelQuery' | 'action' | 'diff' | 'isolatedDiffPreview' | 'isolatedDiffPage' | 'diffPreview' | 'diffPage' | 'diffRelease' | 'copyText' | 'openExternal' | 'remoteLinks' | 'remoteTags' | 'openWorkbench' | 'openRepository' | 'openProject' | 'openFile' | 'openRevision' | 'openWorktree' | 'pickWorktree' | 'openKeyboardShortcuts' | 'showLog' | 'workbenchReady' | 'captureWorkbench' | 'workbenchLocationsReady' | 'workbenchLocationsClosed' | 'saveWorkbenchLocations' | 'workbenchOpenModeSettings' | 'saveSession' | 'interfaceSettings' | 'saveInterfaceSettings' | 'operationSettings' | 'saveOperationSettings'; repoId?: string; payload?: unknown }
/** Missing paths means the source cannot limit which working files changed. */
export interface RepositoryChanges { paths?: string[]; index?: boolean }
export type HostMessage = { type: 'treeExpansionChanged'; repoId: string; cleared?: boolean; preferences: import('./tree-expansion').TreeExpansionPreferences } | { type: 'showWorkbenchLocations'; locations: import('./workbench-host').WorkbenchLocations; language: import('../i18n').Language } | { type: 'captureWorkbench'; token: string } | TerminalEvent | { type: 'interfaceSettingsChanged'; settings: import('./interface-settings').InterfacePreferences } | { type: 'operationSettingsChanged'; settings: OperationSettings } | { type: 'response'; id: string; result?: unknown; error?: { message: string; code?: string; details?: ActionBlocker; localizedMessage?: MessageDescriptor; pushResult?: PushResult; deletionResult?: DeletionResult } } | { type: 'changed'; repoId: string; changes?: RepositoryChanges; snapshot?: Snapshot } | { type: 'activity'; repoId: string; busy: boolean; label: string } | { type: 'networkOperationProgress'; repoId: string; requestId: string; progress: NetworkOperationProgress } | { type: 'fileOperationProgress'; repoId: string; progress: FileOperationProgress } | { type: 'repositoriesChanged' } | { type: 'selectRepository'; repoId: string } | { type: 'repositoryDiscoveryProgress'; scanId: string; scanned: number; found: number };
export interface GitServiceContract {
  conflictDetails?(repo: Repository, path: string): Promise<import('./conflicts').ConflictDetails>;
  lfsStatus?(repo: Repository): Promise<import('./lfs').LfsStatus>;
  lfsDestinations?(repo: Repository): Promise<import('./lfs').LfsDestinations>;
  lfsHistoricalObject?(repo: Repository, request: import('./lfs').LfsHistoricalRequest, maxBytes?: number): Promise<import('./lfs').LfsHistoricalObject>;
  lfsIndexObject?(repo: Repository, request: import('./lfs').LfsIndexRequest, maxBytes?: number): Promise<import('./lfs').LfsIndexObject>;
  lfsCachedObject?(repo: Repository, pointer: { oid: string; size: number }, maxBytes?: number): Promise<import('./lfs').LfsCachedObject>;
  lfsTrackPreview?(repo: Repository, request: import('./lfs').LfsTrackRequest): Promise<import('./lfs').LfsTrackPreview>;
  withReadSignal?<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T>;
  discover(root: string): Promise<Repository>;
  repositoryStatus(repo: Repository): Promise<RepositoryStatus>;
  worktreeOverview?(repo: Repository, paths?: string[]): Promise<WorktreeOverviewEntry[]>;
  snapshot(repo: Repository): Promise<Snapshot>;
  trackedPaths?(repo: Repository, paths: string[]): Promise<string[]>;
  reviewOperation(repo: Repository): Promise<OperationReview>;
  prepareInteractiveRebase?(repo: Repository, start?: string): Promise<import('./interactive-rebase').RebasePlan>;
  reflog?(repo: Repository, query?: import('./reflog').ReflogQuery): Promise<import('./reflog').ReflogPage>;
  history(repo: Repository, query?: HistoryQuery): Promise<HistoryPage>;
  details(repo: Repository, oid: string, parent?: string): Promise<CommitDetails>;
  revisionTreeCompare(repo: Repository, revision: string, baseRevision: string): Promise<import('./tree').RevisionTreeChanges>;
  revisionTreeChanges(repo: Repository, revision: string, parent?: string): Promise<import('./tree').RevisionTreeChanges>;
  revisionTreeCommit(repo: Repository, revision: string): Promise<import('./tree').RevisionTreeCommit>;
  revisionTree(repo: Repository, request: import('./tree').RevisionTreeRequest): Promise<import('./tree').RevisionTreeListing>;
  searchRevisionTree(repo: Repository, request: import('./tree').RevisionTreeSearchRequest): Promise<import('./tree').RevisionTreeSearchPage>;
  stashDetails(repo: Repository, oid: string): Promise<StashDetails>;
  branchComparison?(repo: Repository, query: BranchComparisonQuery): Promise<BranchComparison>;
  compare(repo: Repository, left: string, right: string, preserveOrder?: boolean): Promise<CommitComparison>;
  cherryPickCheck(repo: Repository, commits: string[], context?: { expectedHead: string; expectedBranch: string }): Promise<CherryPickCheck>;
  content(repo: Repository, source: ContentSource, maxBytes?: number): Promise<Buffer>;
  textDiffHunks(repo: Repository, left: string, right: string): Promise<import('./diff').TextDiffHunk[]>;
  patchHunks?(repo: Repository, target: { path: string; area: 'staged' | 'unstaged' }): Promise<{ metadata: import('./diff').PatchHunks; left?: string; right?: string }>;
  throwIfReadCancelled?(): void;
  prepareAction(repo: Repository, action: GitAction): Promise<GitAction>;
  prepareDiscard(repo: Repository, request: DiscardRequest): Promise<DiscardPlan>;
  remoteLinks?(repo: Repository, remote?: string, branch?: string): Promise<RemoteLinks>;
  remoteTags?(repo: Repository, remote: string, expectedDestination: string): Promise<RemoteTags>;
  execute(repo: Repository, action: GitAction, onProgress?: (progress: FileOperationProgress) => void, onNetworkProgress?: (progress: NetworkOperationProgress) => void): Promise<void | PushResult | DeletionResult>;
}
