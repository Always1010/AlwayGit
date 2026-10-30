import { randomUUID } from 'node:crypto';
import type { Repository } from '../protocol/types';
import {
  reflogQuerySchema,
  type ReflogEntry,
  type ReflogPage,
  type ReflogQuery,
  type RecoveryRef,
} from '../protocol/reflog';
import { message } from '../i18n';
import { GitError } from './error';
import type { GitResult } from './runner';
type Run = (args: string[], allowFailure?: boolean) => Promise<GitResult>;
interface Cached {
  repo: string;
  ref: string;
  entries: ReflogEntry[];
  recoveries: RecoveryRef[];
  checkedAt: number;
  truncated: boolean;
}
/** Stable bounded snapshots: new reflog entries cannot shift a previously loaded page. */
export class ReflogReader {
  private readonly snapshots = new Map<string, Cached>();
  async read(repo: Repository, raw: ReflogQuery, run: Run): Promise<ReflogPage> {
    const query = reflogQuerySchema.parse(raw),
      now = Date.now();
    for (const [key, value] of this.snapshots)
      if (now - value.checkedAt > 600000) this.snapshots.delete(key);
    let token = query.token,
      cached = token ? this.snapshots.get(token) : undefined;
    if (token && (!cached || cached.repo !== repo.root || cached.ref !== query.ref))
      throw new GitError(message('reflog.expired'), 'OPERATION_CHANGED');
    if (!cached) {
      if (
        query.ref !== 'HEAD' &&
        (!query.ref.startsWith('refs/heads/') ||
          /[\0\r\n]/.test(query.ref) ||
          (await run(['check-ref-format', query.ref], true)).code !== 0)
      )
        throw new GitError(message('reflog.invalidRef'), 'INVALID_ARGUMENT');
      const exists = await run(['reflog', 'exists', query.ref], true);
      if (exists.code > 1) throw new GitError(exists.stderr.toString('utf8'), 'GIT_FAILED');
      const entries: ReflogEntry[] = [];
      if (!exists.code) {
        const output = (
          await run([
            'reflog',
            'show',
            '--no-abbrev',
            '-z',
            '--date=iso-strict',
            '--format=%H%x00%gD%x00%gs%x00%gn%x00%ge',
            '--max-count=5001',
            query.ref,
            '--',
          ])
        ).stdout
          .toString('utf8')
          .split('\0');
        if (output.at(-1) === '') output.pop();
        if (output.length % 5) throw new GitError(message('reflog.malformed'), 'PARSE_ERROR');
        for (let i = 0; i < output.length; i += 5) {
          const [oid, selector, description, actor, email] = output.slice(i, i + 5);
          if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid))
            throw new GitError(message('reflog.malformed'), 'PARSE_ERROR');
          entries.push({
            oid,
            selector,
            description,
            actor,
            email,
            date: /@\{(.+)\}$/.exec(selector)?.[1],
          });
        }
      }
      const refs = (
        await run([
          'for-each-ref',
          '--format=%(refname)%00%(objectname)',
          'refs/alwaygit/rebase-backups/',
        ])
      ).stdout
        .toString('utf8')
        .trim();
      const recoveries = refs
        ? refs.split('\n').map((line) => {
            const [ref, oid] = line.split('\0');
            return { ref, oid };
          })
        : [];
      cached = {
        repo: repo.root,
        ref: query.ref,
        entries: entries.slice(0, 5000),
        recoveries,
        checkedAt: now,
        truncated: entries.length > 5000,
      };
      while (this.snapshots.size >= 16) this.snapshots.delete(this.snapshots.keys().next().value!);
      token = randomUUID();
      this.snapshots.set(token, cached);
    }
    const entries = cached.entries.slice(query.offset, query.offset + query.limit),
      nextOffset = query.offset + entries.length;
    return {
      token: token!,
      ref: cached.ref,
      entries,
      recoveries: cached.recoveries,
      nextOffset,
      hasMore: nextOffset < cached.entries.length,
      truncated: cached.truncated,
      checkedAt: cached.checkedAt,
    };
  }
}
