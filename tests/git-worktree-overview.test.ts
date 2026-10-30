import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { commitFile, git, gitFixtures } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-overview-');
afterEach(fixtures.cleanup);

describe('worktree overview', () => {
  it('inventories uncatalogued worktrees and reads overlapping counts, local upstream, detached, locked and missing paths without snapshots', async () => {
    const { root, repo, service } = await fixtures.setup();
    await commitFile(root, 'tracked.txt', 'base');
    const linked = path.join(root, 'linked tree'),
      missing = path.join(root, 'missing tree');
    await git(root, 'worktree', 'add', '-b', 'feature', linked);
    await git(root, 'worktree', 'add', '--detach', missing);
    await git(root, 'worktree', 'lock', '--reason', 'keep this tree', linked);
    await git(root, 'branch', '--set-upstream-to=main', 'feature');
    await commitFile(linked, 'ahead.txt', 'ahead');
    await writeFile(path.join(linked, 'tracked.txt'), 'staged');
    await git(linked, 'add', 'tracked.txt');
    await writeFile(path.join(linked, 'tracked.txt'), 'unstaged');
    await writeFile(path.join(linked, 'untracked.txt'), 'new');
    await rm(missing, { recursive: true });
    const snapshot = vi.spyOn(service, 'snapshot');
    const inventory = await service.worktreeOverview(repo);
    expect(inventory).toHaveLength(3);
    expect(inventory.every((entry) => entry.state === 'pending')).toBe(true);
    const rows = await service.worktreeOverview(repo, [root, linked, missing]);
    expect(rows.find((entry) => entry.path === linked)).toMatchObject({
      branch: 'feature',
      state: 'ready',
      staged: 1,
      unstaged: 1,
      untracked: 1,
      conflicts: 0,
      locked: 'keep this tree',
      upstream: 'main',
      ahead: 1,
      behind: 0,
    });
    expect(rows.find((entry) => entry.path === missing)).toMatchObject({
      detached: true,
      state: 'missing',
    });
    expect(rows.find((entry) => entry.path === root)).toMatchObject({ state: 'ready', staged: 0 });
    expect(snapshot).not.toHaveBeenCalled();
    expect(rows.every((entry) => !!entry.refreshedAt)).toBe(true);
  });

  it('isolates read errors and detects conflicts and per-worktree operation markers', async () => {
    const { root, repo, service } = await fixtures.setup();
    await commitFile(root, 'conflict.txt', 'base\n');
    const linked = path.join(root, 'linked');
    await git(root, 'worktree', 'add', '-b', 'feature', linked);
    await commitFile(linked, 'conflict.txt', 'feature\n');
    await commitFile(root, 'conflict.txt', 'main\n');
    await git(linked, 'merge', 'main').catch(() => {});
    const rows = await service.worktreeOverview(repo, [root, linked]);
    expect(rows.find((entry) => entry.path === linked)).toMatchObject({
      state: 'ready',
      operation: 'merge',
      conflicts: 1,
      staged: 0,
      unstaged: 0,
    });
    await rm(path.join(linked, '.git'));
    await mkdir(path.join(linked, '.git')); // A replaced directory must not silently resolve to its parent repository.
    const replaced = await service.worktreeOverview(repo, [root, linked]);
    expect(replaced.find((entry) => entry.path === linked)?.state).toBe('error');
    expect(replaced.find((entry) => entry.path === root)?.state).toBe('ready');
    await expect(
      service.worktreeOverview(repo, [path.join(root, 'arbitrary')]),
    ).rejects.toMatchObject({ code: 'INVALID_WORKTREE' });
  });
});
