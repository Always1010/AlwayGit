import { afterEach, expect, it } from 'vitest';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { GitService } from '../src/git/service';
import { commitFile, git, gitFixtures } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-branch-delete-');
afterEach(fixtures.cleanup);

it.each([false, true])('retains a branch advanced during atomic deletion (force=%s)', async force => {
  const { root, repo } = await fixtures.setup();
  const expected = await commitFile(root, 'base.txt', 'base');
  await git(root, 'branch', 'victim');
  await git(root, 'config', 'branch.victim.description', 'preserve this config on failure');
  const advanced = await commitFile(root, 'next.txt', 'next');
  let raced = false;
  const racing = new GitService({ environment: async (_repo, args) => {
    if (!raced && args[0] === 'update-ref' && args.includes('-d')) {
      raced = true;
      await git(root, 'update-ref', 'refs/heads/victim', advanced);
    }
    return {};
  } });
  await expect(racing.execute(repo, { type: 'branch.delete', names: ['victim'], force, expectedOids: { victim: expected } })).rejects.toMatchObject({ code: 'PARTIAL_FAILURE' });
  expect(raced).toBe(true);
  expect(await git(root, 'rev-parse', 'refs/heads/victim')).toBe(advanced);
  expect(await git(root, 'config', '--get', 'branch.victim.description')).toBe('preserve this config on failure');
});

it('preserves upstream merge checks, removes branch config and reflog, and reports partial deletion', async () => {
  const { root, repo, service } = await fixtures.setup();
  await commitFile(root, 'base.txt', 'base');
  await git(root, 'switch', '-c', 'topic');
  const topic = await commitFile(root, 'topic.txt', 'unmerged in main');
  await git(root, 'branch', 'unmerged');
  await git(root, 'switch', 'main');
  await git(root, 'remote', 'add', 'origin', path.join(root, 'remote.git'));
  await git(root, 'update-ref', 'refs/remotes/origin/topic', topic);
  await git(root, 'config', 'branch.topic.remote', 'origin');
  await git(root, 'config', 'branch.topic.merge', 'refs/heads/topic');
  await expect(service.execute(repo, { type: 'branch.delete', names: ['topic', 'unmerged'], expectedOids: { topic, unmerged: topic } })).rejects.toMatchObject({ code: 'PARTIAL_FAILURE', message: expect.stringContaining('1 branch(es) deleted; 1 failed') });
  await expect(git(root, 'show-ref', '--verify', 'refs/heads/topic')).rejects.toThrow();
  await expect(git(root, 'config', '--get', 'branch.topic.remote')).rejects.toThrow();
  await expect(access(path.join(root, '.git', 'logs', 'refs', 'heads', 'topic'))).rejects.toThrow();
  expect(await git(root, 'rev-parse', 'refs/heads/unmerged')).toBe(topic);
  await service.execute(repo, { type: 'branch.delete', names: ['unmerged'], force: true, expectedOids: { unmerged: topic } });
  await expect(git(root, 'show-ref', '--verify', 'refs/heads/unmerged')).rejects.toThrow();
});

it('retains branches checked out in the current or another worktree', async () => {
  const { root, repo, service } = await fixtures.setup();
  const head = await commitFile(root, 'base.txt', 'base');
  await git(root, 'worktree', 'add', '-b', 'linked', path.join(root, 'linked'));
  await expect(service.execute(repo, { type: 'branch.delete', names: ['main'], force: true, expectedOids: { main: head } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  await expect(service.execute(repo, { type: 'branch.delete', names: ['linked'], force: true, expectedOids: { linked: head } })).rejects.toMatchObject({ code: 'WORKTREE_OCCUPIED' });
  expect(await git(root, 'rev-parse', 'refs/heads/linked')).toBe(head);
});

it.each([false, true])('rechecks worktree occupancy after deletion preparation (linked=%s)', async linked => {
  const { root, repo } = await fixtures.setup();
  const head = await commitFile(root, 'base.txt', 'base');
  await git(root, 'branch', 'victim');
  let raced = false;
  const racing = new GitService({ environment: async (_repo, args) => {
    if (!raced && args[0] === 'update-ref' && args.includes('-d')) {
      raced = true;
      if (linked) await git(root, 'worktree', 'add', path.join(root, 'linked'), 'victim');
      else await git(root, 'switch', 'victim');
    }
    return {};
  } });
  await expect(racing.execute(repo, { type: 'branch.delete', names: ['victim'], force: true, expectedOids: { victim: head } })).rejects.toMatchObject({ code: 'PARTIAL_FAILURE' });
  expect(raced).toBe(true);
  expect(await git(root, 'rev-parse', 'refs/heads/victim')).toBe(head);
});

it('uses the current HEAD merge target if HEAD moves during deletion preparation', async () => {
  const { root, repo } = await fixtures.setup();
  const base = await commitFile(root, 'base.txt', 'base');
  const expected = await commitFile(root, 'next.txt', 'next');
  await git(root, 'branch', 'victim');
  let raced = false;
  const racing = new GitService({ environment: async (_repo, args) => {
    if (!raced && args[0] === 'update-ref' && args.includes('-d')) {
      raced = true;
      await git(root, 'update-ref', 'refs/heads/main', base);
    }
    return {};
  } });
  await expect(racing.execute(repo, { type: 'branch.delete', names: ['victim'], expectedOids: { victim: expected } })).rejects.toMatchObject({ code: 'PARTIAL_FAILURE' });
  expect(raced).toBe(true);
  expect(await git(root, 'rev-parse', 'refs/heads/victim')).toBe(expected);
});
