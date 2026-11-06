import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  GitAction,
  OperationReview,
  OperationState,
  Repository,
  Snapshot,
} from '../protocol/types';
import { message as localizeMessage } from '../i18n/index';
import { GitError } from './error';
import type { GitRun } from './execution';

type OperationStatus = Pick<Snapshot, 'head' | 'branch' | 'changes'>;
type RecoveryAction = Extract<
  GitAction,
  { type: 'operation.quit' | 'operation.continue' | 'operation.abort' | 'operation.skip' }
>;
interface OperationDependencies {
  run: GitRun;
  text(repo: Repository, args: string[]): Promise<string>;
  pathText(repo: Repository, args: string[]): Promise<string>;
  status(repo: Repository): Promise<OperationStatus>;
  snapshot(repo: Repository): Promise<Snapshot>;
  contentFingerprint(repo: Repository, status: OperationStatus): Promise<string>;
  decodePaths(buffer: Buffer): string;
  resumeRebase(
    repo: Repository,
    command: 'continue' | 'abort' | 'skip',
    keepEmpty: boolean | undefined,
    beforeDestructiveStep?: () => Promise<void>,
  ): Promise<boolean>;
}
const normalized = (value: string) =>
  process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

export async function readOperationFile(gitDir: string, name: string): Promise<string> {
  try {
    return await readFile(path.join(gitDir, name), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

/** Owns confirmation state and recovery policy; all Git commands use the host runner. */
export class OperationGuards {
  private readonly reviews = new Map<string, { token: string; fingerprint: string }>();
  private readonly aborts = new Map<string, { token: string; fingerprint: string }>();
  constructor(private readonly dependencies: OperationDependencies) {}
  invalidateForAction(repo: Repository, action: GitAction): void {
    if (action.type !== 'commit' && action.type !== 'operation.continue')
      this.reviews.delete(repo.id);
    if (action.type !== 'operation.abort') this.aborts.delete(repo.id);
  }
  async prepareAbort(
    repo: Repository,
    action: Extract<GitAction, { type: 'operation.abort' }>,
  ): Promise<Extract<GitAction, { type: 'operation.abort' }>> {
    const snapshot = await this.dependencies.snapshot(repo);
    if (snapshot.operation.kind !== action.kind)
      throw new GitError(
        localizeMessage('service.theSelectedGitOperationIsNoLongerActive'),
        'OPERATION_CHANGED',
      );
    const fingerprint = await this.abortFingerprint(repo, action.kind),
      token = randomUUID();
    this.aborts.set(repo.id, { token, fingerprint });
    return { ...action, abortToken: token };
  }
  /** Pin Skip and Quit to this worktree, operation instance and current sequencer step. */
  async skipFingerprint(
    repo: Repository,
    current: { head?: string; branch: string },
    kind: OperationState['kind'],
  ): Promise<string> {
    const gitDir = await this.dependencies.pathText(repo, [
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
    ]);
    const names = [
      'MERGE_HEAD',
      'CHERRY_PICK_HEAD',
      'REVERT_HEAD',
      'REBASE_HEAD',
      'sequencer/head',
      'sequencer/todo',
      'sequencer/abort-safety',
      'rebase-merge/head-name',
      'rebase-merge/orig-head',
      'rebase-merge/onto',
      'rebase-merge/done',
      'rebase-merge/git-rebase-todo',
      'rebase-merge/stopped-sha',
      'rebase-merge/msgnum',
      'rebase-apply/head-name',
      'rebase-apply/orig-head',
      'rebase-apply/onto',
      'rebase-apply/next',
      'rebase-apply/last',
      'rebase-apply/original-commit',
    ];
    const markers = await Promise.all(
      names.map(async (name) => {
        const filename = path.join(gitDir, name);
        try {
          const [content, info] = await Promise.all([readFile(filename, 'utf8'), lstat(filename)]);
          // Identical commits can be replayed by a restarted operation. File identity
          // and timestamps distinguish that new instance even when marker text matches.
          return [name, content, info.dev, info.ino, info.birthtimeMs, info.ctimeMs, info.mtimeMs];
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [name, null];
          throw error;
        }
      }),
    );
    return createHash('sha256')
      .update(
        JSON.stringify([
          repo.id,
          normalized(repo.root),
          normalized(gitDir),
          current.branch,
          current.head,
          kind,
          markers,
        ]),
      )
      .digest('hex');
  }
  /** Freeze both operation identity and the Index/working content Abort may discard. */
  private async abortFingerprint(repo: Repository, kind: OperationState['kind']): Promise<string> {
    const current = await this.dependencies.status(repo),
      operation = await this.skipFingerprint(repo, current, kind),
      index = await this.dependencies.run(repo, ['ls-files', '--stage', '-z']),
      content = await this.dependencies.contentFingerprint(repo, current),
      gitDir = await this.dependencies.pathText(repo, [
        'rev-parse',
        '--path-format=absolute',
        '--git-dir',
      ]),
      restoration = await Promise.all(
        ['ORIG_HEAD', 'MERGE_AUTOSTASH', 'rebase-merge/autostash', 'rebase-apply/autostash'].map(
          (name) => readOperationFile(gitDir, name),
        ),
      );
    return createHash('sha256')
      .update(JSON.stringify([operation, content, restoration]))
      .update(index.stdout)
      .digest('hex');
  }
  private async requireAbort(
    repo: Repository,
    action: Extract<GitAction, { type: 'operation.abort' }>,
  ): Promise<void> {
    const prepared = this.aborts.get(repo.id);
    if (
      !action.abortToken ||
      prepared?.token !== action.abortToken ||
      prepared.fingerprint !== (await this.abortFingerprint(repo, action.kind))
    )
      throw new GitError(
        localizeMessage('service.theSelectedGitOperationIsNoLongerActive'),
        'OPERATION_CHANGED',
      );
  }
  private async reviewFingerprint(
    repo: Repository,
    snapshot: Snapshot,
    tree: string,
  ): Promise<string> {
    const gitDir = await this.dependencies.pathText(repo, [
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
    ]);
    const markers = await Promise.all(
      [
        'MERGE_HEAD',
        'CHERRY_PICK_HEAD',
        'REVERT_HEAD',
        'sequencer/head',
        'sequencer/todo',
        'rebase-merge/onto',
        'rebase-merge/orig-head',
        'rebase-merge/done',
        'rebase-merge/git-rebase-todo',
        'rebase-apply/next',
        'rebase-apply/last',
        'rebase-apply/orig-head',
      ].map((name) => readOperationFile(gitDir, name)),
    );
    return createHash('sha256')
      .update(
        JSON.stringify([
          repo.id,
          snapshot.branch,
          snapshot.head,
          snapshot.operation.kind,
          tree,
          markers,
        ]),
      )
      .digest('hex');
  }
  async reviewOperation(repo: Repository): Promise<OperationReview> {
    const snapshot = await this.dependencies.snapshot(repo),
      kind = snapshot.operation.kind;
    if (!kind)
      throw new GitError(
        localizeMessage('service.theGitOperationIsNoLongerActiveRefreshBefore'),
        'OPERATION_CHANGED',
      );
    if (!snapshot.operation.canContinue)
      throw new GitError(localizeMessage('service.resolveConflictsBeforeContinuing'), 'CONFLICTS');
    // Scan an immutable tree, rather than working files or a truncated Diff preview.
    const tree = await this.dependencies.text(repo, ['write-tree']),
      fingerprint = await this.reviewFingerprint(repo, snapshot, tree);
    const paths = this.dependencies
      .decodePaths(
        (
          await this.dependencies.run(repo, [
            'diff',
            '--name-only',
            '--no-renames',
            '-z',
            snapshot.head!,
            tree,
            '--',
          ])
        ).stdout,
      )
      .split('\0')
      .filter(Boolean);
    const records = this.dependencies
      .decodePaths((await this.dependencies.run(repo, ['ls-tree', '-r', '-z', tree])).stdout)
      .split('\0');
    const entries = new Map(
      records.filter(Boolean).map((record) => {
        const tab = record.indexOf('\t');
        return [record.slice(tab + 1), record.slice(0, tab).split(' ')];
      }),
    );
    const files: OperationReview['files'] = [];
    let remaining = 16 * 1024 * 1024;
    for (const name of paths) {
      const entry = entries.get(name);
      if (!entry) continue; // Staged deletions contain no text.
      const file: OperationReview['files'][number] = { path: name, lines: [] };
      files.push(file);
      if (entry[1] !== 'blob') {
        file.skipped = 'submodule';
        continue;
      }
      const size = Number(await this.dependencies.text(repo, ['cat-file', '-s', entry[2]]));
      if (size > 2 * 1024 * 1024) {
        file.skipped = 'large';
        continue;
      }
      if (size > remaining) {
        file.skipped = 'limit';
        continue;
      }
      remaining -= size;
      const bytes = (
        await this.dependencies.run(repo, ['cat-file', 'blob', entry[2]], false, size + 1)
      ).stdout;
      if (bytes.includes(0)) {
        file.skipped = 'binary';
        continue;
      }
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        file.skipped = 'encoding';
        continue;
      }
      text.split(/\r?\n/).forEach((line, index) => {
        // Include diff3/zdiff3 base markers and non-default marker widths. A single
        // leftover marker is suspicious too; explicit confirmation allows literal text.
        if (/^(?:<{7,}(?: .*)?|\|{7,}(?: .*)?|={7,}|>{7,}(?: .*)?)$/.test(line)) {
          if (file.lines.length < 100) file.lines.push(index + 1);
          else file.more = true;
        }
      });
    }
    const current = await this.dependencies.snapshot(repo);
    if (
      !current.operation.canContinue ||
      fingerprint !==
        (await this.reviewFingerprint(
          repo,
          current,
          await this.dependencies.text(repo, ['write-tree']),
        ))
    )
      throw new GitError(
        localizeMessage('service.stagedContentOrTheOperationChangedDuringInspectionCheck'),
        'REVIEW_CHANGED',
      );
    const token = randomUUID();
    this.reviews.set(repo.id, { token, fingerprint });
    return { kind, token, files };
  }
  async requireReview(repo: Repository, snapshot: Snapshot, token?: string): Promise<void> {
    if (!snapshot.operation.kind) {
      if (token)
        throw new GitError(
          localizeMessage('service.theReviewedGitOperationIsNoLongerActiveRefresh'),
          'OPERATION_CHANGED',
        );
      return;
    }
    if (!snapshot.operation.canContinue)
      throw new GitError(localizeMessage('service.resolveConflictsBeforeContinuing'), 'CONFLICTS');
    const review = this.reviews.get(repo.id);
    if (!token || token !== review?.token)
      throw new GitError(
        localizeMessage('service.inspectTheStagedResultAndConfirmBeforeCompletingThis'),
        'REVIEW_REQUIRED',
      );
    if (
      review.fingerprint !==
      (await this.reviewFingerprint(
        repo,
        snapshot,
        await this.dependencies.text(repo, ['write-tree']),
      ))
    )
      throw new GitError(
        localizeMessage('service.stagedContentOrTheOperationChangedInspectTheResult'),
        'REVIEW_CHANGED',
      );
    this.reviews.delete(repo.id);
  }
  /** Called only from GitService.executeNow, after entering the shared write queue. */
  async executeRecovery(repo: Repository, action: RecoveryAction): Promise<void> {
    if (action.type === 'operation.quit') {
      const state = (await this.dependencies.snapshot(repo)).operation;
      if (state.kind !== 'cherry-pick' || !action.quitToken || state.quitToken !== action.quitToken)
        throw new GitError(
          localizeMessage('service.theSelectedGitOperationIsNoLongerActive'),
          'OPERATION_CHANGED',
        );
      await this.dependencies.run(repo, ['cherry-pick', '--quit'], false, undefined, {
        beforeSpawn: async () => {
          if (
            action.quitToken !==
            (await this.skipFingerprint(repo, await this.dependencies.status(repo), 'cherry-pick'))
          )
            throw new GitError(
              localizeMessage('service.theSelectedGitOperationIsNoLongerActive'),
              'OPERATION_CHANGED',
            );
        },
      });
      return;
    }
    const snapshot = await this.dependencies.snapshot(repo),
      state = snapshot.operation;
    if (!state.kind || state.kind !== action.kind)
      throw new GitError(
        localizeMessage('service.theSelectedGitOperationIsNoLongerActive'),
        'OPERATION_CHANGED',
      );
    const command = action.type.split('.')[1];
    if (command === 'skip' && !state.canSkip)
      throw new GitError(
        localizeMessage('service.thisOperationCannotBeSkipped'),
        'INVALID_ARGUMENT',
      );
    const verifySkip =
      action.type === 'operation.skip'
        ? async () => {
            if (
              !action.skipToken ||
              action.skipToken !==
                (await this.skipFingerprint(repo, await this.dependencies.status(repo), state.kind))
            ) {
              throw new GitError(
                localizeMessage('service.theSelectedGitOperationIsNoLongerActive'),
                'OPERATION_CHANGED',
              );
            }
          }
        : undefined;
    if (
      action.type === 'operation.skip' &&
      (!action.skipToken || action.skipToken !== state.skipToken)
    )
      throw new GitError(
        localizeMessage('service.theSelectedGitOperationIsNoLongerActive'),
        'OPERATION_CHANGED',
      );
    const verifyAbort =
      action.type === 'operation.abort' ? () => this.requireAbort(repo, action) : undefined;
    if (verifyAbort) await verifyAbort();
    const verifyDestructiveStep = verifyAbort ?? verifySkip;
    const beforeDestructiveStep = verifyDestructiveStep
      ? async () => {
          await verifyDestructiveStep();
          if (action.type === 'operation.abort') this.aborts.delete(repo.id);
        }
      : undefined;
    if (action.type === 'operation.continue')
      await this.requireReview(repo, snapshot, action.reviewToken);
    if (
      action.kind === 'rebase' &&
      state.managedRebase &&
      (await this.dependencies.resumeRebase(
        repo,
        command as 'continue' | 'abort' | 'skip',
        action.type === 'operation.continue' && action.keepEmpty,
        beforeDestructiveStep,
      ))
    )
      return;
    const args = [action.kind, `--${command}`];
    if (beforeDestructiveStep) {
      await this.dependencies.run(repo, args, false, undefined, {
        beforeSpawn: beforeDestructiveStep,
      });
      return;
    }
    await this.dependencies.run(repo, args);
  }
}
