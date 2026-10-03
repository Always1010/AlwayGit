import { randomUUID } from 'node:crypto';
import { copyFile, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { message } from '../i18n';
import type { Change, CommitSelection } from '../protocol/types';
import { GitError, GitReadTerminationError, GitTerminationError } from './error';
import type { GitResult } from './runner';
import type { StashExecution } from './stash';

type Run = (args: string[], execution?: StashExecution) => Promise<GitResult>;

/** Native commit with a private index; publish only selected paths back to the real index. */
export async function commitSelected(run: Run, selections: CommitSelection[], changes: Change[], head: string | undefined, commitArgs: string[], verifyContext: () => Promise<void>): Promise<void> {
  if (!selections.length && !commitArgs.includes('--amend')) throw new GitError(message('commit.chooseFiles'), 'INVALID_ARGUMENT');
  const byPath = new Map(changes.map(change => [change.path, change]));
  const unique = new Map<string, CommitSelection>();
  for (const selection of selections) {
    const change = byPath.get(selection.path);
    const available = change && !change.conflict && (selection.area === 'staged'
      ? !change.untracked && !!change.indexStatus && ![' ', '?'].includes(change.indexStatus)
      : change.untracked || !!change.worktreeStatus && change.worktreeStatus !== ' ');
    if (!available) throw new GitError(message('commit.selectionChanged'), 'OPERATION_CHANGED');
    if (unique.get(selection.path)?.area !== 'unstaged') unique.set(selection.path, selection);
  }
  const related = (selection: CommitSelection) => {
    const change = byPath.get(selection.path)!;
    return change.originalPath && (change.indexStatus === 'R' || selection.area === 'unstaged' && change.worktreeStatus === 'R')
      ? [selection.path, change.originalPath] : [selection.path];
  };
  const staged = [...unique.values()].filter(selection => selection.area === 'staged').flatMap(related);
  const unstaged = [...unique.values()].filter(selection => selection.area === 'unstaged').flatMap(related);
  const selectedPaths = [...new Set([...staged, ...unstaged])];
  const indexPath = (await run(['rev-parse', '--path-format=absolute', '--git-path', 'index'])).stdout.toString('utf8').trim();
  const token = randomUUID(), originalIndex = path.join(path.dirname(indexPath), `alwaygit-${token}-original.index`);
  const commitIndex = path.join(path.dirname(indexPath), `alwaygit-${token}-commit.index`);
  const lockPath = `${indexPath}.lock`;
  const lock = await open(lockPath, 'wx').catch(error => {
    if (error.code === 'EEXIST') throw new GitError(message('commit.indexBusy'), 'INDEX_LOCKED');
    throw error;
  });
  const originalEnv = { GIT_INDEX_FILE: originalIndex }, commitEnv = { GIT_INDEX_FILE: commitIndex };
  let committed = false, published = false, deferred = false;
  const cleanup = async () => {
    await lock.close();
    if (!published) await rm(lockPath, { force: true });
    await Promise.all([originalIndex, commitIndex, `${originalIndex}.lock`, `${commitIndex}.lock`].map(file => rm(file, { force: true })));
  };
  try {
    await verifyContext();
    try { await copyFile(indexPath, originalIndex); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await run(['read-tree', '--empty'], { env: originalEnv });
    }
    const stagedTree = (await run(['write-tree'], { env: originalEnv })).stdout.toString('utf8').trim();
    await run(head ? ['read-tree', head] : ['read-tree', '--empty'], { env: commitEnv });
    if (staged.length) await run(['restore', '--staged', `--source=${stagedTree}`, '--', ...staged], { env: commitEnv });
    if (unstaged.length) await run(['add', '-A', '--', ...unstaged], { env: commitEnv });
    await verifyContext();
    await run(commitArgs, { env: commitEnv });
    committed = true;
    // Start from the original index so unrelated staged entries (including partial hunks) survive.
    if (selectedPaths.length) await run(['reset', '-q', 'HEAD', '--', ...selectedPaths], { env: originalEnv });
    await lock.writeFile(await readFile(originalIndex));
    await lock.close();
    await rename(lockPath, indexPath);
    published = true;
  } catch (error) {
    if (error instanceof GitTerminationError || error instanceof GitReadTerminationError) {
      deferred = true;
      void error.completion.then(cleanup).catch(() => {});
      throw error;
    }
    if (committed) throw new GitError(message('commit.indexPublishFailed'), 'PARTIAL_FAILURE', '', error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    if (!deferred) await cleanup();
  }
}
