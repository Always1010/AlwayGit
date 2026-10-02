import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { GitService } from '../src/git/service';
import { mapGitQueries } from '../src/git/query-map';
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
