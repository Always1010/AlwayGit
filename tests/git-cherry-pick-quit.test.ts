import { afterEach, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GitService } from '../src/git/service';
import { actionSchema } from '../src/protocol/validation';
import { commitFile, git, gitFixtures } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-cherry-quit-');
afterEach(fixtures.cleanup);

async function paused(batch = false) {
  const fixture = await fixtures.setup(),
    { root, repo, service } = fixture;
  await commitFile(root, 'file.txt', 'base\n');
  await git(root, 'switch', '-c', 'topic');
  const prefix = await commitFile(root, 'prefix.txt', 'prefix\n');
  await writeFile(path.join(root, 'file.txt'), 'incoming\n');
  await commitFile(root, 'clean.txt', 'staged incoming\n');
  // Include the conflicting file in the same commit as the cleanly applied file.
  await git(root, 'add', 'file.txt');
  await git(root, 'commit', '--amend', '--no-edit');
  const conflict = await git(root, 'rev-parse', 'HEAD');
  const suffix = await commitFile(root, 'suffix.txt', 'suffix\n');
  await git(root, 'switch', 'main');
  const original = await commitFile(root, 'file.txt', 'ours\n');
  await expect(
    service.execute(repo, {
      type: 'cherry-pick',
      commits: batch ? [prefix, conflict, suffix] : [conflict],
    }),
  ).rejects.toThrow();
  return { ...fixture, original, conflict };
}

async function contents(root: string) {
  return {
    head: await git(root, 'rev-parse', 'HEAD'),
    index: await git(root, 'ls-files', '--stage'),
    file: await readFile(path.join(root, 'file.txt'), 'utf8'),
    clean: await readFile(path.join(root, 'clean.txt'), 'utf8'),
    untracked: await readFile(path.join(root, 'notes.txt'), 'utf8'),
    status: await git(root, 'status', '--porcelain'),
  };
}

it.each(['single', 'batch', 'staged batch'])(
  'quits a %s Cherry-pick while preserving HEAD, Index, edits and untracked files',
  async (mode) => {
    const { root, repo, service } = await paused(mode !== 'single');
    await writeFile(path.join(root, 'clean.txt'), 'unstaged manual edit\n');
    await writeFile(path.join(root, 'notes.txt'), 'untracked notes\n');
    if (mode === 'staged batch') {
      await writeFile(path.join(root, 'file.txt'), 'resolved manually\n');
      await git(root, 'add', 'file.txt');
    }
    const operation = (await service.snapshot(repo)).operation;
    const before = await contents(root);
    await service.execute(repo, {
      type: 'operation.quit',
      kind: 'cherry-pick',
      quitToken: operation.quitToken!,
    });
    expect(await contents(root)).toEqual(before);
    const after = await service.snapshot(repo);
    expect(after.operation.kind).toBeUndefined();
    expect(after.operation.quitToken).toBeUndefined();
    expect(after.operation.conflicts).toBe(mode === 'staged batch' ? 0 : 1);
    await expect(git(root, 'rev-parse', '--verify', 'CHERRY_PICK_HEAD')).rejects.toThrow();
    await expect(readFile(path.join(root, 'suffix.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(path.join(root, 'file.txt'), 'final manual resolution\n');
    await service.execute(repo, {
      type: mode === 'staged batch' ? 'stage' : 'resolve-and-stage',
      paths: ['file.txt'],
    });
    await service.execute(repo, { type: 'commit', message: 'manual resolution after quit' });
    expect(await git(root, 'show', 'HEAD:file.txt')).toBe('final manual resolution');
    expect(await readFile(path.join(root, 'clean.txt'), 'utf8')).toBe('unstaged manual edit\n');
  },
);

it.each(['skip', 'abort'] as const)(
  'shows why %s looks identical for one commit but differs for a batch',
  async (command) => {
    for (const batch of [false, true]) {
      const { root, repo, service, original } = await paused(batch);
      const operation = (await service.snapshot(repo)).operation;
      await service.execute(
        repo,
        command === 'skip'
          ? { type: 'operation.skip', kind: 'cherry-pick', skipToken: operation.skipToken! }
          : { type: 'operation.abort', kind: 'cherry-pick' },
      );
      expect((await service.snapshot(repo)).operation.kind).toBeUndefined();
      expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('ours\n');
      if (batch && command === 'skip') {
        expect(await git(root, 'rev-parse', 'HEAD')).not.toBe(original);
        expect(await git(root, 'show', 'HEAD:prefix.txt')).toBe('prefix');
        expect(await git(root, 'show', 'HEAD:suffix.txt')).toBe('suffix');
      } else {
        expect(await git(root, 'rev-parse', 'HEAD')).toBe(original);
        expect(await git(root, 'status', '--porcelain')).toBe('');
      }
    }
  },
);

it('rejects Quit for missing identities, another operation kind or a restarted sequence', async () => {
  const { root, repo, service, conflict } = await paused();
  const quitToken = (await service.snapshot(repo)).operation.quitToken!;
  expect(actionSchema.safeParse({ type: 'operation.quit', kind: 'cherry-pick' }).success).toBe(
    false,
  );
  expect(actionSchema.safeParse({ type: 'operation.quit', kind: 'merge', quitToken }).success).toBe(
    false,
  );
  await git(root, 'cherry-pick', '--abort');
  await expect(git(root, 'cherry-pick', conflict)).rejects.toThrow();
  await expect(
    service.execute(repo, { type: 'operation.quit', kind: 'cherry-pick', quitToken }),
  ).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
  expect((await service.snapshot(repo)).operation.kind).toBe('cherry-pick');
});

it('rechecks the operation immediately before spawning Quit', async () => {
  const { root, repo, service, conflict } = await paused();
  const quitToken = (await service.snapshot(repo)).operation.quitToken!;
  let raced = false;
  const racing = new GitService({
    environment: async (_repo, args) => {
      if (!raced && args[0] === 'cherry-pick' && args[1] === '--quit') {
        raced = true;
        await git(root, 'cherry-pick', '--abort');
        await expect(git(root, 'cherry-pick', conflict)).rejects.toThrow();
      }
      return {};
    },
  });
  await expect(
    racing.execute(repo, { type: 'operation.quit', kind: 'cherry-pick', quitToken }),
  ).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
  expect(raced).toBe(true);
  expect((await service.snapshot(repo)).operation.kind).toBe('cherry-pick');
});
