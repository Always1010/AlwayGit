import { message as localizeMessage, translate } from '../i18n/index';
import type {
  CheckoutBlocker,
  DeletionResult,
  GitAction,
  Repository,
  Snapshot,
  Worktree,
} from '../protocol/types';
import {
  branchNameConflict,
  branchNameConflictMessage,
  branchNameProblem,
  branchNameProblemMessage,
} from '../protocol/ref-name';
import { gitToken as token } from './arguments';
import { GitError, GitTerminationError } from './error';
import type { GitRun } from './execution';
import { mapGitQueries } from './query-map';

interface BranchDependencies {
  run: GitRun;
  text(repo: Repository, args: string[]): Promise<string>;
  oid(repo: Repository, revision: string): Promise<string>;
  snapshot(repo: Repository): Promise<Snapshot>;
  status(repo: Repository): Promise<Pick<Snapshot, 'head' | 'changes'>>;
  worktrees(repo: Repository): Promise<Worktree[]>;
  requireDetachedHead(): void;
  samePath(left: string, right: string): boolean;
}

/** Branch mutations are dispatched only through GitService's verified write queue. */
export class BranchOperations {
  constructor(private readonly git: BranchDependencies) {}
  async refName(repo: Repository, name: string): Promise<string> {
    const problem = branchNameProblem(name);
    if (problem) throw new GitError(branchNameProblemMessage(problem), 'INVALID_BRANCH_NAME');
    await this.git.run(repo, ['check-ref-format', `refs/heads/${name}`]);
    return name;
  }
  async checkout(
    repo: Repository,
    target: string,
    detached = false,
    stashFirst = false,
    includeUntracked = false,
    createFrom?: { oid: string; upstream: string },
  ): Promise<void> {
    if (detached) this.git.requireDetachedHead();
    const resolved = detached ? await this.git.oid(repo, target) : await this.refName(repo, target);
    if (!detached && !createFrom) await this.git.oid(repo, `refs/heads/${resolved}`);
    const snapshot = await this.git.snapshot(repo);
    const conflictPaths = snapshot.changes
      .filter((change) => change.conflict)
      .map((change) => change.path);
    if (conflictPaths.length || snapshot.operation.kind) {
      throw new GitError(
        conflictPaths.length
          ? translate('en', 'service.resolveConflictsOrAbortTheActiveGitOperationBefore')
          : translate('en', 'service.continueOrAbortTheActiveBeforeCheckout', {
              kind: snapshot.operation.kind,
            }),
        'CHECKOUT_BLOCKED',
        '',
        '',
        {
          reason: conflictPaths.length ? 'conflicts' : 'operation-active',
          paths: conflictPaths,
          target,
        },
      );
    }
    const occupied =
      !detached &&
      snapshot.worktrees.find(
        (tree) => tree.branch === target && !this.git.samePath(tree.path, repo.root),
      );
    if (occupied)
      throw new GitError(
        localizeMessage('service.branchIsCheckedOutInOpenThatWorktreeTo', {
          target: target,
          path: occupied.path,
        }),
        'WORKTREE_OCCUPIED',
        '',
        '',
        { reason: 'worktree-occupied', paths: [], target, worktreePath: occupied.path },
      );
    let branchCreated = false;
    if (createFrom) {
      // Create the ref before touching the Index or Working Tree. switch -c can
      // update both even when an external ref namespace collision makes it fail.
      await this.git.run(repo, ['branch', '--no-track', '--', resolved, createFrom.oid]);
      branchCreated = true;
      try {
        await this.git.run(repo, [
          'branch',
          `--set-upstream-to=${createFrom.upstream}`,
          '--',
          resolved,
        ]);
      } catch (error) {
        throw new GitError(
          localizeMessage('service.branchWasCreatedAndRetainedButUpstreamConfigurationFailed', {
            resolved: resolved,
            value: error instanceof Error ? error.message : String(error),
          }),
          'PARTIAL_FAILURE',
          '',
          '',
          { reason: 'checkout-failed', target, paths: [], branchCreated: true },
        );
      }
    }
    let stashOid: string | undefined;
    if (detached) this.git.requireDetachedHead();
    if (stashFirst) {
      const previous = snapshot.stashes[0]?.oid;
      await this.git.run(repo, [
        'stash',
        'push',
        ...(includeUntracked ? ['--include-untracked'] : []),
        '-m',
        translate('en', 'service.alwayGitBeforeCheckout', { target: target }),
      ]);
      const top = await this.git.run(repo, ['rev-parse', '--verify', 'refs/stash'], true);
      const saved = top.code ? undefined : top.stdout.toString('utf8').trim();
      if (saved !== previous) stashOid = saved;
    }
    try {
      if (detached) this.git.requireDetachedHead();
      await this.git.run(repo, [
        '-c',
        'core.quotePath=false',
        'switch',
        ...(detached ? ['--detach'] : []),
        '--',
        resolved,
      ]);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      const blocked = /would be overwritten|local changes|needs merge|unmerged/i.test(cause);
      const listed = cause
        .split(/\r?\n/)
        .filter((line) => /^\t/.test(line))
        .map((line) => line.slice(1));
      const current = await this.git.status(repo).catch(() => ({ changes: snapshot.changes }));
      // Porcelain paths are authoritative even for filenames which Git quotes in its diagnostic.
      const affected = listed.length
        ? current.changes
            .filter(
              (change) =>
                listed.includes(change.path) || listed.includes(change.originalPath ?? ''),
            )
            .map((change) => change.path)
        : [];
      const paths = blocked
        ? affected.length
          ? affected
          : current.changes.map((change) => change.path)
        : [];
      const details: CheckoutBlocker = {
        reason: blocked ? 'local-changes' : 'checkout-failed',
        paths,
        target,
        ...(branchCreated ? { branchCreated: true } : {}),
        ...(stashOid
          ? { stashCreated: true, stashOid }
          : stashFirst
            ? { stashCreated: false }
            : {}),
      };
      const message = `${branchCreated ? translate('en', 'service.retainedCheckoutBranch', { branch: resolved }) : ''}${cause}${stashOid ? translate('en', 'service.retainedCheckoutStash', { oid: stashOid }) : ''}`;
      throw new GitError(
        message,
        blocked ? 'CHECKOUT_BLOCKED' : error instanceof GitError ? error.code : 'CHECKOUT_FAILED',
        error instanceof GitError ? error.stdout : '',
        error instanceof GitError ? error.stderr : '',
        details,
      );
    }
  }
  async trackBranches(
    repo: Repository,
    action: Extract<GitAction, { type: 'branch.track' }>,
  ): Promise<void> {
    if (
      !action.branches.length ||
      action.branches.length > 1000 ||
      (action.checkout && action.branches.length !== 1) ||
      (action.stashFirst && !action.checkout)
    )
      throw new GitError(
        localizeMessage('service.selectUpTo1000BranchesCheckoutAndStashRequire'),
        'INVALID_ARGUMENT',
      );
    // Re-read full ref names under the common-directory write queue. Short names
    // are ambiguous across remotes and upstreams may have changed since the UI opened.
    const [output, remoteOutput] = await Promise.all([
      this.git.text(repo, [
        'for-each-ref',
        '--format=%(refname)%00%(objectname)%00%(upstream)%00%(symref)%00%(objecttype)',
        'refs/heads',
        'refs/remotes',
      ]),
      this.git.text(repo, ['remote']),
    ]);
    const refs = new Map(
      output
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [fullName, oid, upstream, symbolicTarget, type] = line.split('\0');
          return [fullName, { oid, upstream, symbolicTarget, type }] as const;
        }),
    );
    const remotes = remoteOutput.split('\n').filter(Boolean);
    const plan: { source: string; oid: string; name: string; exists: boolean }[] = [];
    const names = new Map<string, string>();
    for (const branch of action.branches) {
      const name = await this.refName(repo, branch.name),
        source = token(branch.source, 'remote reference');
      const remoteRef = refs.get(source);
      if (
        !source.startsWith('refs/remotes/') ||
        !remotes.some((remote) => source.startsWith(`refs/remotes/${remote}/`)) ||
        !remoteRef ||
        remoteRef.symbolicTarget ||
        remoteRef.type !== 'commit'
      )
        throw new GitError(
          localizeMessage('service.selectAnExistingRemoteBranchRatherThanASymbolic', {
            source: source,
          }),
          'INVALID_ARGUMENT',
        );
      if (branch.expectedOid && remoteRef.oid !== branch.expectedOid)
        throw new GitError(
          localizeMessage('service.remoteBranchChangedRefreshAndSelectItAgain', { source: source }),
          'OPERATION_CHANGED',
        );
      const prior = names.get(name);
      if (prior && prior !== source)
        throw new GitError(
          localizeMessage('service.multipleRemoteBranchesWouldUseTheSameLocalName', { name: name }),
          'BRANCH_EXISTS',
        );
      if (prior) continue;
      names.set(name, source);
      const local = refs.get(`refs/heads/${name}`);
      if (local && (local.symbolicTarget || local.upstream !== source))
        throw new GitError(
          localizeMessage('service.localBranchAlreadyExistsAndDoesNotTrackChoose', {
            name: name,
            value: source.replace('refs/remotes/', ''),
          }),
          'BRANCH_EXISTS',
        );
      // refs/heads/feature and refs/heads/feature/a cannot coexist. Detect this
      // before creating any branch, including collisions within the batch.
      const collision = branchNameConflict(
        name,
        [...refs.keys()]
          .filter((ref) => ref.startsWith('refs/heads/'))
          .map((ref) => ref.slice('refs/heads/'.length))
          .concat([...names.keys()])
          .filter((other) => other !== name),
      );
      if (collision)
        throw new GitError(branchNameConflictMessage(name, collision), 'BRANCH_EXISTS');
      plan.push({ source, oid: remoteRef.oid, name, exists: !!local });
    }
    if (action.checkout) {
      const branch = plan[0];
      try {
        await this.checkout(
          repo,
          branch.name,
          false,
          action.stashFirst,
          action.includeUntracked,
          branch.exists ? undefined : { oid: branch.oid, upstream: branch.source },
        );
      } catch (error) {
        if (error instanceof GitError && error.details && 'target' in error.details)
          throw new GitError(error.message, error.code, error.stdout, error.stderr, {
            ...error.details,
            trackBranches: action.branches,
          });
        throw error;
      }
      return;
    }
    let created = 0;
    for (const branch of plan) {
      if (branch.exists) continue;
      try {
        await this.git.run(repo, ['branch', '--no-track', '--', branch.name, branch.oid]);
        created++;
        await this.git.run(repo, [
          'branch',
          `--set-upstream-to=${branch.source}`,
          '--',
          branch.name,
        ]);
      } catch (error) {
        // An external Git process can race the preflight. Report exactly how far
        // this operation got; never roll back refs which the user may now be using.
        if (!created) throw error;
        throw new GitError(
          localizeMessage('service.localBranchEsCreatedCreationStoppedAtRefreshBefore', {
            created: created,
            name: branch.name,
            value: error instanceof Error ? error.message : String(error),
          }),
          'PARTIAL_FAILURE',
        );
      }
    }
  }
  async create(
    repo: Repository,
    action: Extract<GitAction, { type: 'branch.create' }>,
  ): Promise<void> {
    const name = await this.refName(repo, action.name);
    // Re-read inside the common-directory write queue; the dialog snapshot may be stale.
    const localNames = (
      await this.git.text(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads'])
    )
      .split('\n')
      .filter(Boolean)
      .map((ref) => ref.slice('refs/heads/'.length));
    const collision = branchNameConflict(name, localNames);
    if (collision) throw new GitError(branchNameConflictMessage(name, collision), 'BRANCH_EXISTS');
    const start = await this.git.oid(repo, action.start ?? 'HEAD'),
      upstream = action.start?.startsWith('refs/remotes/') ? action.start : undefined;
    if (upstream) await this.git.run(repo, ['show-ref', '--verify', '--', upstream]);
    // switch -c can change Index/Working Tree before a ref creation failure.
    // Create the ref first so even an external race cannot start Checkout on failure.
    await this.git.run(repo, ['branch', '--no-track', '--', name, start]);
    if (upstream) {
      try {
        await this.git.run(repo, ['branch', `--set-upstream-to=${upstream}`, '--', name]);
      } catch (error) {
        throw new GitError(
          localizeMessage(
            'service.branchWasCreatedAndRetainedButUpstreamConfigurationFailedVariant2',
            { name: name, value: error instanceof Error ? error.message : String(error) },
          ),
          'PARTIAL_FAILURE',
        );
      }
    }
    if (action.checkout) {
      try {
        await this.checkout(repo, name);
      } catch (error) {
        const details: CheckoutBlocker = {
          ...(error instanceof GitError && error.details && 'target' in error.details
            ? error.details
            : { reason: 'checkout-failed' as const, paths: [], target: name }),
          branchCreated: true,
        };
        throw new GitError(
          localizeMessage('service.branchWasCreatedAndRetainedButCheckoutDidNotVariant2', {
            name: name,
            value: error instanceof Error ? error.message : String(error),
          }),
          error instanceof GitError ? error.code : 'CHECKOUT_FAILED',
          error instanceof GitError ? error.stdout : '',
          error instanceof GitError ? error.stderr : '',
          details,
        );
      }
    }
    return;
  }
  async delete(
    repo: Repository,
    action: Extract<GitAction, { type: 'branch.delete' }>,
  ): Promise<DeletionResult> {
    const names = await mapGitQueries([...new Set(action.names)], (name) =>
      this.refName(repo, name),
    );
    if (!names.length)
      throw new GitError(localizeMessage('service.selectAtLeastOneBranch'), 'INVALID_ARGUMENT');
    const state = await this.git.snapshot(repo),
      current = state.branch,
      occupied = new Set(
        state.worktrees.map((tree) => tree.branch?.replace(/^refs\/heads\//, '')).filter(Boolean),
      );
    if (current && names.includes(current))
      throw new GitError(
        localizeMessage('service.theCurrentBranchCannotBeDeleted', { current: current }),
        'INVALID_ARGUMENT',
      );
    const inUse = names.find((name) => occupied.has(name));
    if (inUse)
      throw new GitError(
        localizeMessage('service.branchIsUsedByAWorktree', { inUse: inUse }),
        'WORKTREE_OCCUPIED',
      );
    const expectedOids = new Map<string, string>();
    for (const name of names) {
      const oid = await this.git.oid(repo, `refs/heads/${name}`),
        expected = action.expectedOids?.[name];
      if (expected !== undefined && expected !== oid)
        throw new GitError(
          localizeMessage('service.branchChangedBeforeDeletion', { name }),
          'OPERATION_CHANGED',
        );
      expectedOids.set(name, oid);
    }
    const failures: string[] = [];
    let deleted = 0;
    const deletion: DeletionResult = {
      kind: 'deletion',
      target: 'branch',
      succeeded: [],
      failures: [],
    };
    for (const name of names) {
      try {
        const expected = expectedOids.get(name)!;
        // The ref transaction compares the old object while holding its lock.
        // It also deletes the reflog, without touching a symbolic ref's target.
        const result = await this.git.run(
          repo,
          ['update-ref', '--no-deref', '-d', `refs/heads/${name}`, expected],
          true,
          undefined,
          {
            beforeSpawn: async () => {
              const occupied = (await this.git.worktrees(repo)).find(
                (tree) => tree.branch === name,
              );
              if (occupied)
                throw new GitError(
                  localizeMessage('service.branchIsUsedByAWorktree', { inUse: name }),
                  'WORKTREE_OCCUPIED',
                );
              if (!action.force) {
                // Match native branch -d: use a valid upstream, otherwise current HEAD.
                const upstream = await this.git.text(repo, [
                  'for-each-ref',
                  '--format=%(upstream)',
                  `refs/heads/${name}`,
                ]);
                const upstreamOid = upstream
                  ? await this.git.run(
                      repo,
                      ['rev-parse', '--verify', `${upstream}^{commit}`],
                      true,
                    )
                  : undefined;
                const mergeTarget =
                  upstreamOid?.code === 0
                    ? upstreamOid.stdout.toString('utf8').trim()
                    : (await this.git.status(repo)).head;
                const merged = mergeTarget
                  ? await this.git.run(
                      repo,
                      ['merge-base', '--is-ancestor', expected, mergeTarget],
                      true,
                    )
                  : undefined;
                if (!merged || merged.code === 1)
                  throw new GitError(
                    localizeMessage('service.branchNotMerged', { name }),
                    'BRANCH_NOT_MERGED',
                  );
                if (merged.code)
                  throw new GitError(merged.stderr.toString('utf8').trim(), 'GIT_FAILED');
              }
            },
          },
        );
        if (result.code)
          throw new GitError(
            localizeMessage('service.branchChangedBeforeDeletion', { name }),
            'OPERATION_CHANGED',
            result.stdout.toString('utf8'),
            result.stderr.toString('utf8'),
          );
        deleted++;
        deletion.succeeded.push(name);
        // A newly recreated branch owns its own configuration.
        const recreated = await this.git.run(
          repo,
          ['show-ref', '--verify', '--quiet', '--', `refs/heads/${name}`],
          true,
        );
        if (!recreated.code) continue;
        if (recreated.code !== 1)
          throw new GitError(recreated.stderr.toString('utf8').trim(), 'GIT_FAILED');
        const config = await this.git.run(
          repo,
          ['config', '--remove-section', `branch.${name}`],
          true,
        );
        if (config.code) {
          const pattern = `^branch\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`;
          const remaining = await this.git.run(repo, ['config', '--get-regexp', pattern], true);
          // Git versions differ in the missing-section exit code. Only
          // confirmed absence makes failed cleanup harmless.
          if (remaining.code !== 1)
            throw new GitError(config.stderr.toString('utf8').trim(), 'GIT_FAILED');
        }
      } catch (error) {
        failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        deletion.failures.push({
          target: name,
          message: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof GitTerminationError) {
          deletion.notAttempted = names.slice(names.indexOf(name) + 1);
          error.deletionResult = deletion;
          throw error;
        }
      }
    }
    if (failures.length) {
      const error = new GitError(
        localizeMessage('service.branchEsDeletedFailed', {
          deleted,
          count: failures.length,
          value: failures.join('\n'),
        }),
        'PARTIAL_FAILURE',
      );
      error.deletionResult = deletion;
      throw error;
    }
    return deletion;
  }
}
