import { afterEach, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitService } from '../src/git/service';
import { historySearchSchema } from '../src/protocol/history-search';
import { sessionSchema } from '../src/protocol/session';
import { gitFixtures, git, commitFile } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-history-search-'), exec = promisify(execFile);
afterEach(fixtures.cleanup);

async function datedCommit(root: string, name: string, code: string, message: string, date: string) {
  await writeFile(path.join(root, name), code); await git(root, 'add', '--', name);
  await exec('git', ['-C', root, 'commit', '-m', message], { windowsHide: true, env: { ...process.env,
    GIT_AUTHOR_NAME: 'Literal [Alice]', GIT_AUTHOR_EMAIL: 'alice@example.com', GIT_AUTHOR_DATE: '2001-01-01T12:00:00Z', GIT_COMMITTER_DATE: date } });
  return git(root, 'rev-parse', 'HEAD');
}

it('combines literal author, message, path and UTC committer dates across the whole history before paging', async () => {
  const { root, repo, service } = await fixtures.setup();
  await mkdir(path.join(root, 'dir [1]'));
  const first = await datedCommit(root, 'dir [1]/a.txt', 'alpha', 'match initial', '2024-02-01T00:00:00Z');
  const second = await datedCommit(root, 'dir [1]/a.txt', 'beta', 'match later', '2024-02-01T23:59:59Z');
  // Non-monotonic dates must not stop walking at the newest commit.
  await datedCommit(root, 'other.txt', 'noise', 'match noise', '2020-01-01T12:00:00Z');
  const query = { tips: ['HEAD'], search: 'MATCH', filters: { author: '[Alice]', path: 'dir [1]', committerAfter: '2024-02-01', committerBefore: '2024-02-01' }, limit: 1 };
  const page = await service.history(repo, query), next = await service.history(repo, { ...query, tips: page.tips, offset: page.nextOffset });
  expect(page).toMatchObject({ commits: [{ oid: second }], nextOffset: 1, hasMore: true });
  expect(next).toMatchObject({ commits: [{ oid: first }], nextOffset: 2, hasMore: false });
  expect((await service.history(repo, { ...query, filters: { ...query.filters, author: 'alice@EXAMPLE.com' } })).commits[0].oid).toBe(second);
  expect((await service.history(repo, { ...query, filters: { ...query.filters, author: '--all' } })).commits).toEqual([]);
  expect((await service.history(repo, { ...query, filters: { ...query.filters, path: 'dir *' } })).commits).toEqual([]);
});

it('finds added and removed literal code even when occurrence counts stay the same, with opt-in Git regex', async () => {
  const { root, repo, service } = await fixtures.setup();
  const first = await commitFile(root, 'a.txt', 'call(value[0]); // before\n', 'initial');
  const second = await commitFile(root, 'a.txt', 'call(value[0]); // after\n', 'replace');
  const third = await commitFile(root, 'a.txt', 'gone\n', 'remove');
  const page = await service.history(repo, { tips: ['HEAD'], filters: { code: 'value[0]' } });
  expect(page.commits.map(commit => commit.oid)).toEqual([third, second, first]);
  expect((await service.history(repo, { tips: ['HEAD'], filters: { code: 'value\\[[0-9]\\]', codeRegex: true } })).commits.map(commit => commit.oid)).toEqual([third, second, first]);
  expect((await service.history(repo, { tips: ['HEAD'], filters: { code: 'value[0]', codeRegex: true } })).commits).toEqual([]);
  await expect(service.history(repo, { tips: ['HEAD'], filters: { code: '[', codeRegex: true } })).rejects.toThrow();
});

it('deduplicates merge parent matches before pagination and includes manual merge resolution', async () => {
  const { root, repo, service } = await fixtures.setup();
  await commitFile(root, 'base.txt', 'base\n'); await git(root, 'branch', 'topic');
  const left = await commitFile(root, 'left.txt', 'needle\n');
  await git(root, 'checkout', 'topic'); const right = await commitFile(root, 'right.txt', 'needle\n');
  await git(root, 'checkout', 'main'); await git(root, 'merge', '--no-ff', '--no-commit', 'topic');
  await writeFile(path.join(root, 'resolution.txt'), 'manual resolution\n'); await git(root, 'add', 'resolution.txt'); await git(root, 'commit', '-m', 'merge');
  const merge = await git(root, 'rev-parse', 'HEAD'), found: string[] = [];
  for (let offset = 0; offset < 4; offset++) {
    const page = await service.history(repo, { tips: ['main'], filters: { code: 'needle' }, offset, limit: 1 });
    found.push(...page.commits.map(commit => commit.oid)); if (!page.hasMore) break;
  }
  expect(found[0]).toBe(merge); expect(new Set(found)).toEqual(new Set([merge, left, right])); expect(found).toHaveLength(3);
  expect((await service.history(repo, { tips: ['main'], filters: { code: 'manual resolution' } })).commits.map(commit => commit.oid)).toEqual([merge]);
});

it('validates exact commit IDs, intersects selected scope and retains rename-aware file history', async () => {
  const { root, repo, service } = await fixtures.setup();
  const first = await commitFile(root, 'old.txt', 'keep\n'); await git(root, 'branch', 'other');
  await git(root, 'mv', 'old.txt', 'new.txt'); await git(root, 'commit', '-m', 'rename'); const head = await git(root, 'rev-parse', 'HEAD');
  const page = await service.history(repo, { tips: ['main'], file: { path: 'new.txt', revision: head }, filters: { author: 'test@example.com' } });
  expect(page.commits.map(commit => commit.oid)).toContain(first);
  expect(page.commits.find(commit => commit.oid === first)?.fileHistory?.paths).toContain('old.txt');
  expect((await service.history(repo, { tips: ['main'], filters: { commitId: first.slice(0, 12) } })).commits.map(commit => commit.oid)).toEqual([first]);
  await git(root, 'branch', first.slice(0, 12), head);
  expect((await service.history(repo, { tips: ['main'], filters: { commitId: first.slice(0, 12) } })).commits.map(commit => commit.oid)).toEqual([first]);
  expect((await service.history(repo, { tips: ['other'], filters: { commitId: head } })).commits).toEqual([]);
  await expect(service.history(repo, { filters: { commitId: 'HEAD~1' } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  await expect(service.history(repo, { filters: { commitId: '0'.repeat(40) } })).rejects.toThrow();
});

it('restricts code to each file identity historical path and excludes unrelated changes in the same commit', async () => {
  const { root, repo } = await fixtures.setup();
  const first = await commitFile(root, 'old.txt', 'needle\none\ntwo\nthree\nfour\n');
  await writeFile(path.join(root, 'old.txt'), 'needle\none\ntwo\nthree\nfour\nordinary change\n');
  await writeFile(path.join(root, 'unrelated.txt'), 'other file keyword\n');
  await git(root, 'add', '.'); await git(root, 'commit', '-m', 'both files');
  await git(root, 'mv', 'old.txt', 'new.txt'); await git(root, 'commit', '-m', 'rename');
  const last = await commitFile(root, 'new.txt', 'needle\none\ntwo\nthree\nfour\nordinary change\nneedle again\n');
  let broadCodeScans = 0, scopedCodeScans = 0;
  const service = new GitService({ environment: async (_repo, args) => {
    if (args[0] === 'log' && args.some(arg => arg.startsWith('-G'))) {
      if (args.includes('--topo-order')) broadCodeScans++;
      if (args.includes('--no-walk=unsorted')) scopedCodeScans++;
    }
    return {};
  } });
  const query = { tips: ['HEAD'], file: { path: 'new.txt', revision: last } };
  expect((await service.history(repo, { ...query, filters: { code: 'other file keyword' } })).commits).toEqual([]);
  const page = await service.history(repo, { ...query, filters: { code: 'needle' }, limit: 1 });
  const scansAfterFirstPage = scopedCodeScans;
  const next = await service.history(repo, { ...query, tips: page.tips, filters: { code: 'needle' }, limit: 1, offset: page.nextOffset });
  expect([...page.commits, ...next.commits].map(commit => commit.oid)).toEqual([last, first]);
  expect(scopedCodeScans).toBe(scansAfterFirstPage);
  expect((await service.history(repo, { ...query, filters: { code: 'needle', path: 'unrelated.txt' } })).commits).toEqual([]);
  expect(broadCodeScans).toBe(0);
  expect(scopedCodeScans).toBeGreaterThan(0);
});

it('reuses complete advanced matches across pages without caching a failed request', async () => {
  const { root, repo } = await fixtures.setup();
  await commitFile(root, 'a.txt', 'one\n'); await commitFile(root, 'a.txt', 'two\n'); await commitFile(root, 'a.txt', 'three\n');
  let fullScans = 0, failMetadata = true;
  const service = new GitService({ environment: async (_repo, args) => {
    if (args[0] === 'log' && args.includes('--topo-order') && args.includes('--format=%H')) fullScans++;
    if (failMetadata && args[0] === 'log' && args.includes('--no-walk=unsorted') && args.includes('-z')) { failMetadata = false; throw new Error('metadata failed'); }
    return {};
  } });
  const query = { tips: ['HEAD'], filters: { author: 'test@example.com' }, limit: 1 };
  await expect(service.history(repo, query)).rejects.toThrow('metadata failed');
  const page = await service.history(repo, query);
  const next = await service.history(repo, { ...query, tips: page.tips, offset: page.nextOffset });
  expect(page.commits).toHaveLength(1); expect(next.commits).toHaveLength(1);
  expect(fullScans).toBe(2);
});

it.runIf(process.platform === 'win32')('normalizes Windows separators before intersecting file-history code paths', async () => {
  const { root, repo, service } = await fixtures.setup(); await mkdir(path.join(root, 'dir'));
  await commitFile(root, 'dir/old.txt', 'needle\nbase\n');
  await git(root, 'mv', 'dir/old.txt', 'dir/new.txt'); await git(root, 'commit', '-m', 'rename'); const renamed = await git(root, 'rev-parse', 'HEAD');
  const last = await commitFile(root, 'dir/new.txt', 'needle\nbase\nneedle again\n');
  const page = await service.history(repo, { tips: ['HEAD'], file: { path: 'dir/new.txt', revision: last }, filters: { path: 'dir\\new.txt', code: 'needle' } });
  expect(page.commits.map(commit => commit.oid)).toEqual([last, renamed]);
});

it('rejects invalid structured filters, preserves old sessions and fails visibly at the output limit', async () => {
  expect(historySearchSchema.safeParse({ committerAfter: '2024-02-30' }).success).toBe(false);
  expect(historySearchSchema.safeParse({ committerAfter: '2024-03-01', committerBefore: '2024-02-01' }).success).toBe(false);
  expect(historySearchSchema.safeParse({ code: 'line\nline' }).success).toBe(false);
  expect(historySearchSchema.safeParse({ args: '--all' }).success).toBe(false);
  expect(sessionSchema.parse({ views: { repo: { tab: 'history', search: '', historyFilters: { author: 'Alice' } } } }).views?.repo.historyFilters).toEqual({ author: 'Alice' });
  expect(sessionSchema.parse({ views: { repo: { tab: 'history', search: '' } } }).views?.repo.historyFilters).toBeUndefined();
  const { root, repo } = await fixtures.setup(); await commitFile(root, 'a.txt', 'needle');
  const cap = Buffer.byteLength(repo.commonDir) + 10;
  for (let index = 0; index < Math.ceil(cap / 41); index++) await commitFile(root, 'a.txt', `needle ${index}`);
  let scanned = false;
  const service = new GitService({ maxOutputBytes: cap, environment: async (_repo, args) => {
    if (args[0] === 'log' && args.includes('--format=%H')) scanned = true;
    return {};
  } });
  await expect(service.history(repo, { tips: [await git(root, 'rev-parse', 'HEAD')], filters: { code: 'needle' } })).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
  expect(scanned).toBe(true);
  const controller = new AbortController(), cancelled = new GitService({ environment: async (_repo, args) => {
    if (args[0] === 'log' && args.includes('--format=%H')) controller.abort();
    return {};
  } });
  await expect(cancelled.withReadSignal(controller.signal, () => cancelled.history(repo, { tips: ['HEAD'], filters: { code: 'needle' } }))).rejects.toMatchObject({ code: 'ABORTED' });
  expect(await git(root, 'status', '--porcelain')).toBe('');
});
