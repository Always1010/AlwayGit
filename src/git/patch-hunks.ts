import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, lstat, mkdir, open, rename, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { message } from '../i18n';
import { safeWorkingPath } from '../editor/paths';
import type { Change, Repository } from '../protocol/types';
import type { PatchHunks, PatchHunk } from '../protocol/diff';
import type { StashExecution } from './stash';
import type { GitResult } from './runner';
import { GitError, GitTerminationError } from './error';

const LIMIT = 2 * 1024 * 1024,
  INDEX_LIMIT = 32 * 1024 * 1024,
  TTL = 5 * 60_000;
type Run = (
  args: string[],
  execution?: StashExecution & { maxOutputBytes?: number },
) => Promise<GitResult>;
type Target = { path: string; area: 'staged' | 'unstaged' };
type Status = { head?: string; branch: string; changes: Change[] };
type Context = {
  root: string;
  target: Target;
  fingerprint: string;
  expires: number;
  header: string;
  parts: (PatchHunk & { patch: string })[];
};
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const stale = () => new GitError(message('diff.hunkStale'), 'PATCH_CHANGED');
class Unsupported extends Error {}
async function boundedFile(filename: string, limit: number): Promise<Buffer | undefined> {
  let file;
  try {
    file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Unsupported();
    const data = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < data.length) {
      const result = await file.read(data, length, data.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await file.stat();
    if (
      length !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs ||
      after.size !== stat.size
    )
      throw stale();
    return data.subarray(0, length);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new Unsupported();
    throw error;
  } finally {
    await file?.close();
  }
}
function utf8(bytes: Buffer): string {
  if (bytes.includes(0)) throw new Unsupported();
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Unsupported();
  }
}
/** Preserve the original bytes outside the selected lines, including mixed line endings. */
function restoreBlock(
  working: Buffer,
  restored: Buffer,
  part: PatchHunk & { patch: string },
): Buffer {
  const lines = (bytes: Buffer) => utf8(bytes).match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const original = lines(working),
    result = lines(restored),
    start = part.afterStart - (part.afterCount ? 1 : 0);
  if (
    start < 0 ||
    start + part.afterCount > original.length ||
    start + part.beforeCount > result.length
  )
    throw stale();
  const normalize = (value: string[]) => value.join('').replaceAll('\r\n', '\n');
  if (
    normalize(original.slice(0, start)) !== normalize(result.slice(0, start)) ||
    normalize(original.slice(start + part.afterCount)) !==
      normalize(result.slice(start + part.beforeCount))
  )
    throw stale();
  const oldLines = part.patch.split('\n').filter((line) => line.startsWith('-'));
  const ending = (line: string | undefined) =>
    line?.endsWith('\r\n') ? '\r\n' : line?.endsWith('\n') ? '\n' : undefined;
  const replacement = result.slice(start, start + part.beforeCount).map((line, offset) => {
    // Git may smudge LF index content to CRLF even in an LF working file.
    // Retain the local ending for that conversion, but honor explicit CRLF in the original patch.
    if (line.endsWith('\r\n') && !oldLines[offset]?.endsWith('\r')) {
      const local =
        ending(original[start + Math.min(offset, Math.max(0, part.afterCount - 1))]) ??
        ending(original[start - 1]);
      if (local) return line.slice(0, -2) + local;
    }
    return line;
  });
  return Buffer.from(
    [...original.slice(0, start), ...replacement, ...original.slice(start + part.afterCount)].join(
      '',
    ),
    'utf8',
  );
}
/** Zero-context hunks match the contiguous change blocks used by the Diff index. */
function parsePatch(patch: string): { header: string; hunks: (PatchHunk & { patch: string })[] } {
  if (
    (patch.match(/^diff --git /gm) ?? []).length !== 1 ||
    /^(?:GIT binary patch|Binary files |old mode |new mode |rename |copy )/m.test(patch)
  )
    throw new Unsupported();
  const starts = [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*\n/gm)];
  if (!starts.length || starts.length > 1024) throw new Unsupported();
  const header = patch.slice(0, starts[0].index);
  return {
    header,
    hunks: starts.map((match, index) => ({
      id: randomUUID(),
      beforeStart: +match[1],
      beforeCount: +(match[2] ?? 1),
      afterStart: +match[3],
      afterCount: +(match[4] ?? 1),
      header: match[0].trimEnd(),
      patch: patch.slice(match.index, starts[index + 1]?.index),
    })),
  };
}

export class PatchHunkStore {
  private readonly contexts = new Map<string, Context>();
  private prune(): void {
    for (const [key, context] of this.contexts)
      if (context.expires <= Date.now()) this.contexts.delete(key);
    while (this.contexts.size >= 8) this.contexts.delete(this.contexts.keys().next().value!);
  }
  private async capture(repo: Repository, target: Target, run: Run, status: () => Promise<Status>) {
    const current = await status(),
      change = current.changes.find((change) => change.path === target.path);
    if (
      !change ||
      change.conflict ||
      change.originalPath ||
      current.changes.some((change) => change.conflict) ||
      /[RTCU]/.test(change.indexStatus + change.worktreeStatus)
    )
      throw new Unsupported();
    if (
      target.area === 'staged'
        ? change.indexStatus === ' ' || change.untracked
        : change.worktreeStatus === ' ' && !change.untracked
    )
      throw new Unsupported();
    const gitDir = (await run(['rev-parse', '--path-format=absolute', '--git-dir'])).stdout
      .toString('utf8')
      .trim();
    for (const marker of [
      'MERGE_HEAD',
      'CHERRY_PICK_HEAD',
      'REVERT_HEAD',
      'rebase-merge',
      'rebase-apply',
      'sequencer',
    ]) {
      try {
        await lstat(path.join(gitDir, marker));
        throw new Unsupported();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const indexPath = (
      await run(['rev-parse', '--path-format=absolute', '--git-path', 'index'])
    ).stdout
      .toString('utf8')
      .trim();
    const indexBytes = await boundedFile(indexPath, INDEX_LIMIT);
    // Sparse/assume-unchanged entries have semantics that patch operations cannot preserve safely.
    const entries = (await run(['ls-files', '--stage', '-z', '--', target.path])).stdout
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
    if (
      entries.some(
        (record) =>
          record.slice(record.indexOf('\t') + 1) !== target.path ||
          !/^100(?:644|755) [a-f0-9]+ 0\t/.test(record),
      )
    )
      throw new Unsupported();
    const flags = (await run(['ls-files', '-v', '-z', '--', target.path])).stdout
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
    if (flags.some((record) => !record.startsWith('H '))) throw new Unsupported();
    const debug = (await run(['ls-files', '--debug', '-z', '--', target.path])).stdout
      .toString('utf8')
      .split('\0')
      .slice(1)
      .join('\0');
    const entryFlags = debug.match(/flags: ([0-9a-f]+)/i)?.[1];
    if (entryFlags && parseInt(entryFlags, 16) & 0x60000000) throw new Unsupported();
    const attrs = (
      await run([
        'check-attr',
        '-z',
        'filter',
        'working-tree-encoding',
        'ident',
        'diff',
        '--',
        target.path,
      ])
    ).stdout
      .toString('utf8')
      .split('\0');
    for (let i = 0; i + 2 < attrs.length; i += 3)
      if (!['unspecified', 'unset'].includes(attrs[i + 2])) throw new Unsupported();
    const workingPath = await safeWorkingPath(repo.root, target.path, false);
    let working: Buffer = Buffer.alloc(0),
      workingMode = 0,
      missing = false;
    try {
      const stat = await lstat(workingPath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Unsupported();
      workingMode = stat.mode;
      const bytes = await boundedFile(workingPath, LIMIT);
      if (!bytes) throw stale();
      working = bytes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') missing = true;
      else throw error;
    }
    utf8(working);
    const readBlob = async (oid: string) => {
      const size = +(await run(['cat-file', '-s', oid])).stdout.toString('utf8');
      if (size > LIMIT) throw new Unsupported();
      return (await run(['cat-file', 'blob', oid])).stdout;
    };
    const indexOid = entries[0]?.split(' ')[1],
      index = indexOid ? await readBlob(indexOid) : Buffer.alloc(0);
    let head: Buffer = Buffer.alloc(0);
    if (current.head) {
      const entry = (await run(['ls-tree', '-z', current.head, '--', target.path])).stdout
        .toString('utf8')
        .split('\0')
        .filter(Boolean);
      if (
        entry.some(
          (record) =>
            record.slice(record.indexOf('\t') + 1) !== target.path ||
            !/^100(?:644|755) blob /.test(record),
        )
      )
        throw new Unsupported();
      if (entry[0]) head = await readBlob(entry[0].split(' ')[2].split('\t')[0]);
    }
    const args = [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--no-renames',
      '--diff-algorithm=myers',
      '--no-indent-heuristic',
      '--unified=0',
      '--inter-hunk-context=0',
      '--output-indicator-new=+',
      '--output-indicator-old=-',
      '--output-indicator-context= ',
      '--src-prefix=a/',
      '--dst-prefix=b/',
    ];
    const patchResult = await run(
      change.untracked
        ? [...args, '--no-index', '--', '/dev/null', target.path]
        : [...args, ...(target.area === 'staged' ? ['--cached'] : []), '--', target.path],
      {
        maxOutputBytes: LIMIT,
        allowFailure: change.untracked,
        config: { 'core.quotePath': 'true', 'diff.suppressBlankEmpty': 'false' },
      },
    );
    const patch = utf8(patchResult.stdout);
    if (patchResult.stdout.length > LIMIT) throw new Unsupported();
    const parsed = parsePatch(patch),
      left = utf8(target.area === 'staged' ? head : index),
      right = utf8(target.area === 'staged' ? index : working);
    const fingerprint = hash(
      JSON.stringify([
        current.head,
        current.branch,
        change,
        indexBytes ? hash(indexBytes) : null,
        hash(working),
        workingMode,
        missing,
        attrs,
        hash(patch),
      ]),
    );
    return {
      ...parsed,
      fingerprint,
      indexPath,
      indexBytes,
      left,
      right,
      working,
      workingPath,
      workingMode,
      missing,
      indexMode: entries[0]?.split(' ')[0],
    };
  }
  async preview(
    repo: Repository,
    target: Target,
    run: Run,
    status: () => Promise<Status>,
  ): Promise<{ metadata: PatchHunks; left?: string; right?: string }> {
    this.prune();
    try {
      const first = await this.capture(repo, target, run, status);
      // Do not attach actions to text from a different read of the same file.
      const second = await this.capture(repo, target, run, status);
      if (first.fingerprint !== second.fingerprint) throw stale();
      const token = randomUUID();
      this.contexts.set(token, {
        root: repo.root,
        target,
        fingerprint: first.fingerprint,
        expires: Date.now() + TTL,
        header: first.header,
        parts: first.hunks,
      });
      return {
        metadata: { token, hunks: first.hunks.map(({ patch: _patch, ...hunk }) => hunk) },
        left: first.left,
        right: first.right,
      };
    } catch (error) {
      if (
        error instanceof Unsupported ||
        (error instanceof GitError && error.code === 'OUTPUT_LIMIT')
      )
        return { metadata: { hunks: [], unavailable: 'unsupported' } };
      if (error instanceof GitError && error.code === 'PATCH_CHANGED')
        return { metadata: { hunks: [], unavailable: 'changed' } };
      throw error;
    }
  }
  async apply(
    repo: Repository,
    action: { type: 'stage-hunk' | 'unstage-hunk' | 'discard-hunk'; token: string; hunkId: string },
    run: Run,
    status: () => Promise<Status>,
  ): Promise<void> {
    const context = this.contexts.get(action.token);
    if (
      !context ||
      context.root !== repo.root ||
      context.expires <= Date.now() ||
      (context.target.area === 'staged') !== (action.type === 'unstage-hunk')
    )
      throw stale();
    const part = context.parts.find((part) => part.id === action.hunkId);
    if (!part) throw stale();
    const indexPath = (
      await run(['rev-parse', '--path-format=absolute', '--git-path', 'index'])
    ).stdout
      .toString('utf8')
      .trim();
    const lockPath = indexPath + '.lock',
      temporary = indexPath + '.alwaygit-' + randomUUID();
    // The real index lock excludes cooperating Git writers during revalidation and publication.
    const lock = await open(lockPath, 'wx', 0o600).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new GitError(
          message('service.anotherGitProcessIsUsingThisRepositoryFinishIt'),
          'INDEX_LOCKED',
        );
      throw error;
    });
    let published = false,
      deferred = false,
      workingTemporary: string | undefined;
    const cleanup = async () => {
      await lock.close().catch(() => {});
      if (!published) await rm(lockPath, { force: true });
      await rm(temporary, { force: true });
      await rm(temporary + '.lock', { force: true });
      if (workingTemporary) await rm(workingTemporary, { force: true });
    };
    try {
      let captured;
      try {
        captured = await this.capture(repo, context.target, run, status);
      } catch (error) {
        if (error instanceof Unsupported) throw stale();
        throw error;
      }
      if (captured.indexPath !== indexPath || captured.fingerprint !== context.fingerprint)
        throw stale();
      if (captured.indexBytes) {
        const file = await open(temporary, 'wx', 0o600);
        try {
          await file.writeFile(captured.indexBytes);
        } finally {
          await file.close();
        }
      }
      const env = { GIT_INDEX_FILE: temporary },
        input = Buffer.from(context.header + part.patch, 'utf8'),
        discard = action.type === 'discard-hunk';
      if (discard) {
        // Trial the inverse against the current Working Tree in an isolated Index.
        // Git performs its own clean/smudge conversions; the real Index is never published.
        if (captured.missing)
          await run(['update-index', '--force-remove', '--', context.target.path], { env });
        else {
          const oid = (
            await run(['hash-object', '-w', `--path=${context.target.path}`, '--stdin'], {
              env,
              input: captured.working,
            })
          ).stdout
            .toString('utf8')
            .trim();
          await run(
            [
              'update-index',
              '--add',
              '--cacheinfo',
              captured.indexMode ?? (captured.workingMode & 0o111 ? '100755' : '100644'),
              oid,
              context.target.path,
            ],
            { env },
          );
        }
      }
      const args = [
        'apply',
        '--cached',
        '--unidiff-zero',
        '--whitespace=nowarn',
        ...(action.type !== 'stage-hunk' ? ['--reverse'] : []),
      ];
      await run([...args, '--check', '-'], { env, input });
      await run([...args, '-'], { env, input });
      let restored: Buffer | undefined;
      if (discard) {
        const entry = (
          await run(['ls-files', '--stage', '-z', '--', context.target.path], { env })
        ).stdout
          .toString('utf8')
          .split('\0')
          .find(Boolean);
        if (entry) {
          const oid = entry.split(' ')[1];
          const bytes = (
            await run(['cat-file', '--filters', `--path=${context.target.path}`, oid], {
              env,
              maxOutputBytes: LIMIT,
            })
          ).stdout;
          restored = restoreBlock(captured.working, bytes, part);
          await mkdir(path.dirname(captured.workingPath), { recursive: true });
          await safeWorkingPath(repo.root, context.target.path, false);
          workingTemporary = path.join(
            path.dirname(captured.workingPath),
            '.alwaygit-hunk-' + randomUUID(),
          );
          const file = await open(workingTemporary, 'wx', 0o600);
          try {
            await file.writeFile(restored);
            await file.sync();
          } finally {
            await file.close();
          }
          await chmod(
            workingTemporary,
            captured.missing
              ? parseInt(captured.indexMode ?? '100644', 8) & 0o777
              : captured.workingMode & 0o777,
          );
        }
      }
      // Recheck HEAD/working bytes after the trial. External working-tree writes cannot be locked.
      let latest;
      try {
        latest = await this.capture(repo, context.target, run, status);
      } catch (error) {
        if (error instanceof Unsupported) throw stale();
        throw error;
      }
      if (latest.fingerprint !== context.fingerprint) throw stale();
      if (discard) {
        const destination = await safeWorkingPath(repo.root, context.target.path, false);
        // For a missing target, a hard link publishes atomically without overwriting a new external file.
        if (restored === undefined) await unlink(destination);
        else if (captured.missing) await link(workingTemporary!, destination);
        else await rename(workingTemporary!, destination);
      } else {
        const result = await boundedFile(temporary, INDEX_LIMIT);
        if (!result) throw stale();
        await lock.writeFile(result);
        await lock.sync();
        await lock.close();
        await rename(lockPath, indexPath);
        published = true;
      }
      for (const [token, entry] of this.contexts)
        if (entry.root === repo.root) this.contexts.delete(token);
    } catch (error) {
      // Never release the real index lock while an unconfirmed Git writer may still run.
      if (error instanceof GitTerminationError) {
        deferred = true;
        void error.completion.then(cleanup).catch(() => {});
      }
      if (error instanceof Unsupported) throw stale();
      throw error;
    } finally {
      if (!deferred) await cleanup();
    }
  }
}
