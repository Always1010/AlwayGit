import { afterEach, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { GitService } from '../src/git/service';
import { actionSchema } from '../src/protocol/validation';
import { commitFile, git, gitFixtures } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-skip-');
afterEach(fixtures.cleanup);
async function pausedRebase() {
  const fixture = await fixtures.setup(), { root } = fixture;
  await commitFile(root, 'file.txt', 'base\n');
  await git(root, 'switch', '-c', 'incoming');
  await commitFile(root, 'file.txt', 'incoming\n');
  await git(root, 'switch', 'main');
  await commitFile(root, 'file.txt', 'first\n');
  await commitFile(root, 'file.txt', 'second\n');
  await expect(git(root, 'rebase', 'incoming')).rejects.toThrow();
  return fixture;
}
async function workingState(root: string) {
  return { head: await git(root, 'rev-parse', 'HEAD'), index: await git(root, 'ls-files', '--stage'), content: await readFile(path.join(root, 'file.txt'), 'utf8'), todo: await readFile(path.join(root, '.git/rebase-merge/git-rebase-todo'), 'utf8') };
}
it('binds Skip to the operation instance and step even when HEAD and kind stay unchanged', async () => {
  const { root, repo, service } = await pausedRebase();
  const first = (await service.snapshot(repo)).operation.skipToken!;
  expect((await service.snapshot(repo)).operation.skipToken).toBe(first);
  await git(root, 'rebase', '--abort');
  await expect(git(root, 'rebase', 'incoming')).rejects.toThrow();
  const restarted = (await service.snapshot(repo)).operation.skipToken!;
  expect(restarted).not.toBe(first);
  let before = await workingState(root);
  await expect(service.execute(repo, { type: 'operation.skip', kind: 'rebase', skipToken: first })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
  expect(await workingState(root)).toEqual(before);
  await expect(git(root, 'rebase', '--skip')).rejects.toThrow();
  const next = (await service.snapshot(repo)).operation.skipToken!;
  expect(next).not.toBe(restarted);
  expect(await git(root, 'rev-parse', 'HEAD')).toBe(before.head);
  before = await workingState(root);
  await expect(service.execute(repo, { type: 'operation.skip', kind: 'rebase', skipToken: restarted })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
  expect(await workingState(root)).toEqual(before);
  await service.execute(repo, { type: 'operation.skip', kind: 'rebase', skipToken: next });
  expect((await service.snapshot(repo)).operation.kind).toBeUndefined();
});
it('rejects cross-repository tokens and missing protocol identities before changing files', async () => {
  const first = await pausedRebase(), second = await pausedRebase();
  const skipToken = (await first.service.snapshot(first.repo)).operation.skipToken!;
  const before = await workingState(second.root);
  await expect(second.service.execute(second.repo, { type: 'operation.skip', kind: 'rebase', skipToken })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
  expect(await workingState(second.root)).toEqual(before);
  expect(actionSchema.safeParse({ type: 'operation.skip', kind: 'rebase' }).success).toBe(false);
  expect(actionSchema.safeParse({ type: 'operation.skip', kind: 'rebase', skipToken }).success).toBe(true);
});
it('rechecks the sequencer after command preparation immediately before spawning Skip', async () => {
  const { root, repo, service } = await pausedRebase();
  const skipToken = (await service.snapshot(repo)).operation.skipToken!;
  let raced = false;
  const racing = new GitService({ environment: async (_repo, args) => {
    if (!raced && args[0] === 'rebase' && args[1] === '--skip') {
      raced = true;
      await expect(git(root, 'rebase', '--skip')).rejects.toThrow();
    }
    return {};
  } });
  await expect(racing.execute(repo, { type: 'operation.skip', kind: 'rebase', skipToken })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
  expect(raced).toBe(true);
  expect((await service.snapshot(repo)).operation).toMatchObject({ kind: 'rebase', conflicts: 1 });
  expect(await git(root, 'show', '-s', '--format=%s', 'REBASE_HEAD')).toBe('file.txt');
  expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toContain('second');
});
