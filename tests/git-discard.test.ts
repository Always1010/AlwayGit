import { afterEach, expect, it } from 'vitest';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gitFixtures, git } from './support/git-fixture';
import type { FileOperationProgress } from '../src/protocol/types';
import { runGitProcess } from '../src/git/runner';

const fixtures = gitFixtures('alwaygit-discard-test-');
afterEach(fixtures.cleanup);

it('discards more than 10,000 tracked files in one planned operation while retaining staged content', async () => {
  const { root, repo, service } = await fixtures.setup();
  const names = Array.from({ length: 10001 }, (_, index) => `file-${index}.txt`);
  await writeFile(path.join(root, names[0]), 'base');
  await service.execute(repo, { type: 'stage', paths: [names[0]] });
  await service.execute(repo, { type: 'commit', message: 'base' });
  const blob = await git(root, 'rev-parse', `HEAD:${names[0]}`);
  await runGitProcess({ args: ['-C', root, 'update-index', '--index-info'], env: process.env, input: Buffer.from(names.slice(1).map(name => `100644 ${blob}\t${name}\n`).join('')) });
  await service.execute(repo, { type: 'commit', message: 'large tree' });
  await writeFile(path.join(root, names[0]), 'staged');
  await service.execute(repo, { type: 'stage', paths: [names[0]] });
  // The other 10,000 tracked files are missing: Discard must recreate them from the Index.
  await writeFile(path.join(root, names[0]), 'unstaged');
  await writeFile(path.join(root, 'untracked [1].txt'), 'delete');
  const plan = await service.prepareDiscard(repo, { scope: 'unstaged' });
  expect(plan).toMatchObject({ tracked: 10001, untracked: 1, staged: 1 });
  const updates: FileOperationProgress[] = [];
  await service.execute(repo, { type: 'discard', paths: [], planToken: plan.token }, progress => updates.push(progress));
  expect(await readFile(path.join(root, names[0]), 'utf8')).toBe('staged');
  expect(await readFile(path.join(root, names.at(-1)!), 'utf8')).toBe('base');
  await expect(readFile(path.join(root, 'untracked [1].txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await git(root, 'diff', '--name-only')).toBe('');
  expect(await git(root, 'diff', '--cached', '--name-only')).toBe(names[0]);
  expect(updates.at(-1)).toMatchObject({ completed: 10002, total: 10002, phase: 'cleaning' });
  await expect(service.execute(repo, { type: 'discard', paths: [], planToken: plan.token })).rejects.toMatchObject({ code: 'DISCARD_CHANGED' });
}, 120000);

it('binds Discard to its repository and selection, and rejects changed Index content with the same status', async () => {
  const { root, repo, service } = await fixtures.setup();
  const other = await fixtures.setup();
  await writeFile(path.join(root, 'selected.txt'), 'base');
  await service.execute(repo, { type: 'stage', paths: ['selected.txt'] });
  await service.execute(repo, { type: 'commit', message: 'base' });
  await writeFile(path.join(root, 'selected.txt'), 'staged');
  await service.execute(repo, { type: 'stage', paths: ['selected.txt'] });
  await writeFile(path.join(root, 'selected.txt'), 'unstaged');
  await writeFile(path.join(root, 'keep.txt'), 'keep');
  const plan = await service.prepareDiscard(repo, { paths: ['selected.txt'] });
  await expect(service.execute(other.repo, { type: 'discard', paths: [], planToken: plan.token })).rejects.toMatchObject({ code: 'DISCARD_CHANGED' });
  await writeFile(path.join(root, 'selected.txt'), 'new staged');
  await service.execute(repo, { type: 'stage', paths: ['selected.txt'] });
  await writeFile(path.join(root, 'selected.txt'), 'new unstaged');
  await expect(service.execute(repo, { type: 'discard', paths: [], planToken: plan.token })).rejects.toMatchObject({ code: 'DISCARD_CHANGED' });
  expect(await readFile(path.join(root, 'selected.txt'), 'utf8')).toBe('new unstaged');
  const current = await service.prepareDiscard(repo, { paths: ['selected.txt'] });
  await service.execute(repo, { type: 'discard', paths: ['keep.txt'], planToken: current.token });
  expect(await readFile(path.join(root, 'selected.txt'), 'utf8')).toBe('new staged');
  expect(await readFile(path.join(root, 'keep.txt'), 'utf8')).toBe('keep');
  expect((await service.prepareDiscard(repo, { paths: ['selected.txt'] })).paths).toEqual([]);
});

it('discards the Index and Working Tree including staged additions, deletions and renames without moving HEAD', async () => {
  const { root, repo, service } = await fixtures.setup();
  for (const name of ['edit.txt', 'old [1].txt', 'deleted.txt']) await writeFile(path.join(root, name), 'base');
  await git(root, 'add', '-A'); await git(root, 'commit', '-m', 'base');
  const head = await git(root, 'rev-parse', 'HEAD');
  await writeFile(path.join(root, 'edit.txt'), 'staged');
  await rename(path.join(root, 'old [1].txt'), path.join(root, 'new [1].txt'));
  await git(root, 'rm', 'deleted.txt');
  await writeFile(path.join(root, 'added.txt'), 'added');
  await git(root, 'add', '-A');
  await writeFile(path.join(root, 'edit.txt'), 'unstaged');
  await writeFile(path.join(root, 'untracked.txt'), 'delete');
  await writeFile(path.join(root, '.git', 'info', 'exclude'), 'ignored.txt\n');
  await writeFile(path.join(root, 'ignored.txt'), 'keep');
  const plan = await service.prepareDiscard(repo, { scope: 'all' });
  expect(plan.paths).toContain('old [1].txt');
  const action = await service.prepareAction(repo, { type: 'discard', paths: [], planToken: plan.token });
  expect(action).toMatchObject({ mode: 'all' });
  await service.execute(repo, action);
  for (const name of ['edit.txt', 'old [1].txt', 'deleted.txt']) expect(await readFile(path.join(root, name), 'utf8')).toBe('base');
  for (const name of ['added.txt', 'new [1].txt', 'untracked.txt']) await expect(readFile(path.join(root, name))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(path.join(root, 'ignored.txt'), 'utf8')).toBe('keep');
  expect(await git(root, 'status', '--porcelain')).toBe('');
  expect(await git(root, 'rev-parse', 'HEAD')).toBe(head);
});

it('clears an unborn Index and deletes staged ignored additions while retaining unrelated ignored files', async () => {
  const { root, repo, service } = await fixtures.setup();
  await writeFile(path.join(root, '.git', 'info', 'exclude'), '*.cache\n');
  await writeFile(path.join(root, 'added.cache'), 'delete');
  await git(root, 'add', '-f', 'added.cache');
  await writeFile(path.join(root, 'untracked.txt'), 'delete');
  await writeFile(path.join(root, 'keep.cache'), 'keep');
  const plan = await service.prepareDiscard(repo, { scope: 'all' });
  expect(plan.head).toBeUndefined();
  await service.execute(repo, { type: 'discard', paths: [], planToken: plan.token });
  expect(await git(root, 'ls-files')).toBe('');
  await expect(readFile(path.join(root, 'added.cache'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(path.join(root, 'untracked.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(path.join(root, 'keep.cache'), 'utf8')).toBe('keep');
});

it('blocks global staged-content discard during an operation and reports protected nested repositories as incomplete', async () => {
  const { root, repo, service } = await fixtures.setup();
  await writeFile(path.join(root, 'untracked.txt'), 'keep');
  await writeFile(path.join(root, '.git', 'MERGE_HEAD'), 'a'.repeat(40));
  await expect(service.prepareDiscard(repo, { scope: 'all' })).rejects.toMatchObject({ code: 'OPERATION_ACTIVE' });
  expect(await readFile(path.join(root, 'untracked.txt'), 'utf8')).toBe('keep');
  const other = await fixtures.setup(), nested = path.join(other.root, 'nested');
  await mkdir(nested); await git(nested, 'init', '-b', 'main');
  await writeFile(path.join(nested, 'keep.txt'), 'nested repository');
  const plan = await other.service.prepareDiscard(other.repo, { scope: 'all' });
  await expect(other.service.execute(other.repo, { type: 'discard', paths: [], planToken: plan.token })).rejects.toMatchObject({ message: expect.stringContaining('nested') });
  expect(await readFile(path.join(nested, 'keep.txt'), 'utf8')).toBe('nested repository');
});
