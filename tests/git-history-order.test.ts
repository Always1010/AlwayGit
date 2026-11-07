import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { GitService } from '../src/git/service';
import { layoutGraph } from '../webview/graph/layout';
import { buildHistoryItems } from '../webview/historyItems';
import { gitFixtures, git, commitFile } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-history-order-');
afterEach(fixtures.cleanup);

it('prioritizes an older current branch across pages, checkout, filters and file history', async () => {
  const { root, repo } = await fixtures.setup();
  const base = await commitFile(root, 'target.txt', 'base', 'base');
  let stream = '';
  for (const [index, branch, parent] of [
    [1, 'topic', base],
    [2, 'topic', ':1'],
    [3, 'main', base],
    [4, 'main', ':3'],
  ] as const) {
    const subject = `${branch}-${index}`;
    stream += `commit refs/heads/${branch}\nmark :${index}\ncommitter Test <test@example.com> ${1700000000 + index} +0000\ndata ${subject.length}\n${subject}\nfrom ${parent}\nM 100644 inline target.txt\ndata ${subject.length}\n${subject}\n`;
  }
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      'git',
      ['-C', root, 'fast-import', '--quiet'],
      { windowsHide: true },
      (error) => (error ? reject(error) : resolve()),
    );
    child.stdin!.end(stream);
  });
  const topic = await git(root, 'rev-parse', 'topic');
  const main = await git(root, 'rev-parse', 'main');
  await git(root, 'checkout', '-f', 'topic');
  await git(root, 'update-ref', 'refs/remotes/origin/main', base);
  let topologyReads = 0;
  const service = new GitService({
    environment: async (_repo, args) => {
      if (args[0] === 'rev-list' && args.includes('--parents')) topologyReads++;
      return {};
    },
  });
  const query = { tips: ['main', 'topic'], head: topic, limit: 2 };
  const first = await service.history(repo, query);
  expect(first.commits.map((commit) => commit.subject)).toEqual(['topic-2', 'topic-1']);
  // Move a selected ref and checkout another branch after the first page.
  await git(root, 'checkout', 'main');
  await commitFile(root, 'later.txt', 'later');
  const second = await service.history(repo, {
    ...query,
    tips: first.tips,
    offset: first.nextOffset,
  });
  const third = await service.history(repo, {
    ...query,
    tips: first.tips,
    offset: second.nextOffset,
  });
  const commits = [...first.commits, ...second.commits, ...third.commits];
  expect(commits.map((commit) => commit.subject)).toEqual([
    'topic-2',
    'topic-1',
    'main-4',
    'main-3',
    'base',
  ]);
  expect(topologyReads).toBe(1);
  expect(third.hasMore).toBe(false);
  expect(commits.map((commit) => commit.pushed)).toEqual([false, false, false, false, true]);
  expect(commits[0].timestamp).toBeLessThan(commits[2].timestamp);

  const items = buildHistoryItems(commits, first.head);
  const whole = layoutGraph(items);
  expect(whole.rows.map((row) => row.lane)).toEqual([0, 0, 0, 1, 1, 0]);
  for (let boundary = 0; boundary <= items.length; boundary++) {
    const start = layoutGraph(items.slice(0, boundary));
    const end = layoutGraph(items.slice(boundary), start.endState);
    expect([...start.rows, ...end.rows]).toEqual(whole.rows);
  }
  const pinned = { tips: first.tips, head: topic, limit: 100 };
  expect((await service.history(repo, pinned)).commits).toEqual(commits);
  const switched = await service.history(repo, { ...pinned, head: main });
  expect(switched.commits.map((commit) => commit.subject)).toEqual([
    'main-4',
    'main-3',
    'topic-2',
    'topic-1',
    'base',
  ]);
  expect(
    (await service.history(repo, { ...pinned, tips: [main] })).commits.map((commit) => commit.oid),
  ).not.toContain(topic);
  expect(
    (await service.history(repo, { ...pinned, search: 'main-' })).commits.map(
      (commit) => commit.subject,
    ),
  ).toEqual(['main-4', 'main-3']);
  expect(
    (await service.history(repo, { ...pinned, filters: { author: 'test@example.com' } })).commits,
  ).toEqual(commits);
  const file = await service.history(repo, {
    ...pinned,
    file: { path: 'target.txt', revision: topic },
  });
  expect(file.commits.map((commit) => commit.oid)).toEqual(commits.map((commit) => commit.oid));
  const switchedFile = await service.history(repo, {
    ...pinned,
    head: main,
    file: { path: 'target.txt', revision: topic },
  });
  expect(switchedFile.commits.map((commit) => commit.oid)).toEqual(
    switched.commits.map((commit) => commit.oid),
  );
  await git(root, 'update-ref', 'refs/remotes/origin/main', main);
  const fetched = await service.history(repo, pinned);
  expect(fetched.commits.map((commit) => commit.oid)).toEqual(commits.map((commit) => commit.oid));
  expect(fetched.commits.map((commit) => commit.pushed)).toEqual([false, false, true, true, true]);
});
