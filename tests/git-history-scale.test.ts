import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { GitService } from '../src/git/service';
import { mapGitQueries } from '../src/git/query-map';
import type { Repository } from '../src/protocol/types';
import type { GitResult } from '../src/git/runner';
import { gitFixtures, git, commitFile } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-history-scale-');
afterEach(fixtures.cleanup);

it('bounds reference work while keeping the result order', async () => {
  let active = 0, maximum = 0;
  const releases: Array<() => void> = [];
  const pending = mapGitQueries(Array.from({ length: 10 }, (_, index) => index), async index => {
    active++; maximum = Math.max(maximum, active);
    await new Promise<void>(resolve => releases.push(resolve));
    active--; return index * 2;
  });
  expect(releases).toHaveLength(4);
  while (releases.length) { for (const release of releases.splice(0)) release(); await new Promise(resolve => setImmediate(resolve)); }
  expect(await pending).toEqual(Array.from({ length: 10 }, (_, index) => index * 2));
  expect(maximum).toBe(4);
});

it.each(['local', 'remote'] as const)('bounds bulk %s branch validation, deduplicates first and preserves deletion order', async destination => {
  const { root, repo } = await fixtures.setup(), head = await commitFile(root, 'base.txt', 'base');
  const names = Array.from({ length: 12 }, (_, index) => `bulk-${index}`);
  const target = destination === 'local' ? root : path.join(root, 'remote.git');
  if (destination === 'remote') {
    await mkdir(target); await git(target, 'init', '--bare');
    await git(root, 'remote', 'add', 'origin', target);
    await git(root, 'push', 'origin', 'main');
  }
  for (const name of names) await git(target, 'update-ref', `refs/heads/${name}`, head);
  let active = 0, maximum = 0, validations = 0;
  const deleted: string[] = [];
  const service = new GitService({ environment: async (_repo, args) => {
    if (args[0] === 'branch' && args[1] === '-d') deleted.push(args.at(-1)!);
    if (args[0] === 'push') deleted.push(args.at(-1)!.replace(':refs/heads/', ''));
    if (args[0] !== 'check-ref-format') return {};
    validations++; active++; maximum = Math.max(maximum, active);
    return { env: {}, dispose: () => { active--; } };
  } });
  const repeated = [...names, ...names];
  if (destination === 'local') await service.execute(repo, { type: 'branch.delete', names: repeated });
  else {
    const snapshot = await service.snapshot(repo);
    await service.execute(repo, { type: 'remote.delete', remote: 'origin', branches: repeated,
      expectedOids: Object.fromEntries(names.map(name => [name, head])), expectedDestination: snapshot.remoteDestinations!.origin });
  }
  expect(validations).toBe(names.length);
  expect(maximum).toBeGreaterThan(0);
  expect(maximum).toBeLessThanOrEqual(4);
  expect(active).toBe(0);
  expect(deleted).toEqual(names);
  expect(await git(target, 'for-each-ref', '--format=%(refname)', 'refs/heads')).toBe('refs/heads/main');
}, 60000);

it('bounds nested tag and remote destination resolution in snapshots while preserving identities', async () => {
  const { root, repo } = await fixtures.setup(), head = await commitFile(root, 'base.txt', 'base');
  await git(root, 'tag', '-a', 'inner', '-m', 'inner', head);
  await git(root, 'tag', '-a', 'outer', '-m', 'outer', 'inner');
  const inner = await git(root, 'rev-parse', 'refs/tags/inner');
  const outer = await git(root, 'rev-parse', 'refs/tags/outer');
  const names = Array.from({ length: 12 }, (_, index) => `nested-${index}`);
  for (const name of names) {
    await git(root, 'update-ref', `refs/tags/${name}`, outer);
    await git(root, 'remote', 'add', name, root);
  }
  await git(root, 'tag', '-d', 'inner', 'outer');
  let active = 0, maximum = 0, queries = 0;
  const service = new GitService({ environment: async (_repo, args) => {
    const nested = args[0] === 'cat-file' && args[1] === '-t' || args[0] === 'rev-parse' && args[1] === '--verify' && args.at(-1)?.startsWith('refs/tags/');
    const remote = args[0] === 'remote' && args[1] === 'get-url';
    if (!nested && !remote) return {};
    active++; queries++; maximum = Math.max(maximum, active);
    return { env: {}, dispose: () => { active--; } };
  } });
  // Exercise the extra-query path even when the installed Git fully peels tags
  // in for-each-ref. Only its starred fields are adapted; subsequent reads use Git.
  const runtime = service as unknown as { run(repo: Repository, args: string[], ...options: unknown[]): Promise<GitResult> };
  const run = runtime.run.bind(service);
  const wrapped = vi.spyOn(runtime, 'run').mockImplementation(async (repo, args, ...options) => {
    const result = await run(repo, args, ...options);
    if (args[0] !== 'for-each-ref') return result;
    const lines = result.stdout.toString('utf8').split('\n').map(line => {
      const fields = line.split('\0');
      if (fields[0].startsWith('refs/tags/')) { fields[3] = inner; fields[4] = 'tag'; }
      return fields.join('\0');
    });
    return { ...result, stdout: Buffer.from(lines.join('\n')) };
  });
  let snapshot;
  try { snapshot = await service.snapshot(repo); }
  finally { wrapped.mockRestore(); }
  expect(queries).toBe(names.length * 3);
  expect(maximum).toBeGreaterThan(0);
  expect(maximum).toBeLessThanOrEqual(4);
  expect(active).toBe(0);
  expect(snapshot.refs.filter(ref => ref.kind === 'tag').map(ref => ref.name)).toEqual([...names].sort());
  expect(snapshot.refs.filter(ref => ref.kind === 'tag').every(ref => ref.oid === head && ref.refOid === outer && ref.targetType === 'commit')).toBe(true);
  expect(Object.keys(snapshot.remoteDestinations!)).toEqual([...names].sort());
  expect(new Set(Object.values(snapshot.remoteDestinations!)).size).toBe(1);
}, 60000);

it('queries hundreds of real refs with duplicate tips and preserves paging and remote exclusion', async () => {
  const { root, repo } = await fixtures.setup(), base = await commitFile(root, 'base.txt', 'base');
  await git(root, 'update-ref', 'refs/remotes/origin/main', base);
  // One fast-import constructs a real commit graph and 310 branch refs, without
  // spawning hundreds of fixture processes or changing the checked-out branch.
  let stream = '';
  for (let index = 1; index <= 310; index++) {
    const message = `bulk-${index}`;
    stream += `commit refs/heads/bulk-${String(index).padStart(3, '0')}\nmark :${index}\ncommitter History Test <test@example.com> ${1700000000 + index} +0000\ndata ${Buffer.byteLength(message)}\n${message}\nfrom ${index === 1 ? base : `:${index - 1}`}\n\n`;
  }
  await new Promise<void>((resolve, reject) => {
    const child = execFile('git', ['-C', root, 'fast-import', '--quiet'], { windowsHide: true }, error => error ? reject(error) : resolve());
    child.stdin!.end(stream);
  });
  const knownTips = (await git(root, 'rev-list', '--topo-order', '--all')).split('\n');
  let active = 0, maximum = 0, resolutions = 0;
  const service = new GitService({ environment: async (_repo, args) => {
    if (args[0] !== 'rev-parse' || args[1] !== '--verify') return {};
    resolutions++; active++; maximum = Math.max(maximum, active);
    return { env: {}, dispose: () => { active--; } };
  } });
  const page = await service.history(repo, { limit: 5, head: 'HEAD' });
  expect(page.tips).toHaveLength(knownTips.length);
  expect(page.commits.map(commit => commit.oid)).toEqual(knownTips.slice(0, 5));
  expect(page.commits.every(commit => commit.pushed === false)).toBe(true);
  expect(page.head).toMatchObject({ oid: base, pushed: true });
  expect(page.hasMore).toBe(true);
  await commitFile(root, 'later.txt', 'later');
  const duplicateTips = [...page.tips, ...page.tips.slice(0, 100)];
  const next = await service.history(repo, { tips: duplicateTips, offset: page.nextOffset, limit: 5 });
  expect(maximum).toBeLessThanOrEqual(4);
  expect(resolutions).toBeLessThan(duplicateTips.length);
  expect(next.commits.map(commit => commit.oid)).toEqual(knownTips.slice(5, 10));
  const all = await service.history(repo, { limit: 1000 });
  expect(all.commits).toHaveLength(knownTips.length + 1);
  expect(all.commits.find(commit => commit.oid === base)?.pushed).toBe(true);
  expect(all.commits.filter(commit => commit.oid !== base).every(commit => commit.pushed === false)).toBe(true);
});
