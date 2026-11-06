import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { commitFile, git, gitFixtures } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-path-operations-');
afterEach(fixtures.cleanup);
type Layout = 'working directory' | 'separate Git directory';
async function setup(layout: Layout) {
  const { root: parent, service } = await fixtures.setup(),
    root = path.join(parent, layout === 'working directory' ? 'working ' : 'working');
  await mkdir(root);
  await git(
    root,
    'init',
    '-b',
    'main',
    ...(layout === 'separate Git directory'
      ? [`--separate-git-dir=${path.join(parent, 'metadata ')}`]
      : []),
  );
  await git(root, 'config', 'user.name', 'Path Test');
  await git(root, 'config', 'user.email', 'path@example.com');
  await git(root, 'config', 'commit.gpgsign', 'false');
  return { root, parent, service, repo: await service.discover(root) };
}

describe
  .skipIf(process.platform === 'win32')
  .each<Layout>(['working directory', 'separate Git directory'])(
  'Git operations with trailing spaces in the %s',
  (layout) => {
    it('saves, restores and drops a selected Stash without changing excluded Index or worktree content', async () => {
      const { root, repo, service } = await setup(layout);
      await commitFile(root, 'selected.txt', 'selected base');
      await commitFile(root, 'other.txt', 'other base');
      await writeFile(path.join(root, 'selected.txt'), 'selected index');
      await git(root, 'add', 'selected.txt');
      await writeFile(path.join(root, 'selected.txt'), 'selected worktree');
      await writeFile(path.join(root, 'other.txt'), 'other worktree');
      await service.execute(repo, { type: 'stash.create', paths: ['selected.txt'] });
      const saved = (await service.snapshot(repo)).stashes[0];
      expect(saved).toBeDefined();
      expect(await readFile(path.join(root, 'selected.txt'), 'utf8')).toBe('selected base');
      expect(await git(root, 'show', ':other.txt')).toBe('other base');
      expect(await readFile(path.join(root, 'other.txt'), 'utf8')).toBe('other worktree');
      await service.execute(repo, {
        type: 'stash.apply',
        selector: saved.selector,
        expectedOid: saved.oid,
      });
      expect(await git(root, 'show', ':selected.txt')).toBe('selected index');
      expect(await readFile(path.join(root, 'selected.txt'), 'utf8')).toBe('selected worktree');
      expect(await git(root, 'show', ':other.txt')).toBe('other base');
      expect(await readFile(path.join(root, 'other.txt'), 'utf8')).toBe('other worktree');
      await service.execute(repo, {
        type: 'stash.drop',
        selector: saved.selector,
        expectedOid: saved.oid,
      });
      expect((await service.snapshot(repo)).stashes).toEqual([]);
      expect(await readFile(path.join(root, 'selected.txt'), 'utf8')).toBe('selected worktree');
    });

    it('recovers managed Rebase context, continues a reviewed step and aborts the remaining conflict', async () => {
      const { root, repo, service } = await setup(layout);
      await commitFile(root, 'file.txt', 'base\n');
      const first = await commitFile(root, 'file.txt', 'first\n'),
        second = await commitFile(root, 'file.txt', 'second\n');
      const plan = await service.prepareInteractiveRebase(repo, first);
      await expect(
        service.execute(repo, {
          type: 'rebase.interactive',
          token: plan.token,
          steps: [
            { oid: second, action: 'pick' },
            { oid: first, action: 'pick' },
          ],
          acknowledgePublished: false,
        }),
      ).rejects.toThrow();
      expect((await service.snapshot(repo)).operation.managedRebase?.pause).toBe('conflict');
      await writeFile(path.join(root, 'file.txt'), 'second\n');
      await service.execute(repo, { type: 'resolve-and-stage', paths: ['file.txt'] });
      const review = await service.reviewOperation(repo);
      await expect(
        service.execute(repo, {
          type: 'operation.continue',
          kind: 'rebase',
          reviewToken: review.token,
        }),
      ).rejects.toThrow();
      expect(await git(root, 'rev-parse', 'REBASE_HEAD')).toBe(first);
      expect((await service.snapshot(repo)).operation.managedRebase?.pause).toBe('conflict');
      await service.execute(
        repo,
        await service.prepareAction(repo, { type: 'operation.abort', kind: 'rebase' }),
      );
      expect(await git(root, 'rev-parse', 'HEAD')).toBe(plan.head);
      expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('second\n');
      expect((await service.snapshot(repo)).operation.kind).toBeUndefined();
    });

    it('stages a hunk and commits selected content through hooks whose directory ends with a space', async () => {
      const { root, parent, repo, service } = await setup(layout);
      await commitFile(root, 'file.txt', 'base\n');
      await commitFile(root, 'other.txt', 'other base\n');
      const hooks = path.join(parent, 'hooks ');
      await mkdir(hooks);
      await writeFile(path.join(hooks, 'pre-commit'), '#!/bin/sh\nprintf ran > hook-ran\n');
      await chmod(path.join(hooks, 'pre-commit'), 0o755);
      await git(root, 'config', 'core.hooksPath', hooks);
      await writeFile(path.join(root, 'file.txt'), 'selected edit\n');
      await writeFile(path.join(root, 'other.txt'), 'excluded edit\n');
      const { metadata: hunks } = await service.patchHunks(repo, {
        path: 'file.txt',
        area: 'unstaged',
      });
      expect(hunks.unavailable).toBeUndefined();
      await service.execute(repo, {
        type: 'stage-hunk',
        token: hunks.token!,
        hunkId: hunks.hunks[0].id,
      });
      const snapshot = await service.snapshot(repo);
      await service.execute(repo, {
        type: 'commit',
        message: 'selected with preserved paths',
        files: [{ path: 'file.txt', area: 'staged' }],
        expectedBranch: snapshot.branch,
        expectedHead: snapshot.head,
      });
      expect(await git(root, 'show', 'HEAD:file.txt')).toBe('selected edit');
      expect(await git(root, 'show', 'HEAD:other.txt')).toBe('other base');
      expect(await readFile(path.join(root, 'other.txt'), 'utf8')).toBe('excluded edit\n');
      expect(await readFile(path.join(root, 'hook-ran'), 'utf8')).toBe('ran');
    });
  },
);
