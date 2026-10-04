import { afterEach, expect, it } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { commitFile, git, gitFixtures } from './support/git-fixture';
import type { GitAction } from '../src/protocol/types';

const fixtures = gitFixtures('alwaygit-file-scope-');
afterEach(fixtures.cleanup);

it.each([
  { operation: 'commit', stagedChildren: false }, { operation: 'commit', stagedChildren: true },
  { operation: 'stash', stagedChildren: false }, { operation: 'stash', stagedChildren: true },
  { operation: 'discard', stagedChildren: false }, { operation: 'discard', stagedChildren: true },
  { operation: 'stage', stagedChildren: false }, { operation: 'stage', stagedChildren: true },
  { operation: 'unstage', stagedChildren: false }, { operation: 'unstage', stagedChildren: true },
])('blocks $operation when a selected file becomes a directory (staged children=$stagedChildren)', async ({ operation, stagedChildren }) => {
  const { root, repo, service } = await fixtures.setup();
  await commitFile(root, 'target', 'base');
  await commitFile(root, 'other.txt', 'other base');
  await writeFile(path.join(root, 'other.txt'), 'unselected staged');
  await git(root, 'add', 'other.txt');
  await rm(path.join(root, 'target')); await mkdir(path.join(root, 'target'));
  await writeFile(path.join(root, 'target', 'keep.txt'), 'unselected child');
  await writeFile(path.join(root, '.git', 'info', 'exclude'), 'target/ignored.txt\n');
  await writeFile(path.join(root, 'target', 'ignored.txt'), 'unselected ignored child');
  if (stagedChildren) await git(root, 'add', '-A', '--', 'target');
  const snapshot = await service.snapshot(repo), index = await git(root, 'ls-files', '--stage');
  const pending = operation === 'stage' || operation === 'unstage'
    ? service.execute(repo, { type: operation, paths: ['target'] })
    : operation === 'commit'
    ? service.execute(repo, { type: 'commit', message: 'selected only', files: [{ path: 'target', area: stagedChildren ? 'staged' : 'unstaged' }], expectedHead: snapshot.head, expectedBranch: snapshot.branch })
    : operation === 'stash'
      ? service.execute(repo, { type: 'stash.create', paths: ['target'] })
      : stagedChildren
        ? service.execute(repo, { type: 'discard', paths: ['target'] })
        : service.prepareDiscard(repo, { paths: ['target'] });
  await expect(pending).rejects.toMatchObject({ code: 'FILE_SCOPE_CHANGED' });
  expect(await readFile(path.join(root, 'target', 'keep.txt'), 'utf8')).toBe('unselected child');
  expect(await readFile(path.join(root, 'target', 'ignored.txt'), 'utf8')).toBe('unselected ignored child');
  expect(await git(root, 'rev-parse', 'HEAD')).toBe(snapshot.head);
  expect(await git(root, 'ls-files', '--stage')).toBe(index);
  expect(await git(root, 'stash', 'list')).toBe('');
});

it('rejects a confirmed Discard after its selected file becomes a directory', async () => {
  const { root, repo, service } = await fixtures.setup();
  await commitFile(root, 'target', 'base');
  await writeFile(path.join(root, 'target'), 'working');
  const plan = await service.prepareDiscard(repo, { paths: ['target'] });
  await rm(path.join(root, 'target')); await mkdir(path.join(root, 'target'));
  await writeFile(path.join(root, 'target', 'keep.txt'), 'unselected child');
  await expect(service.execute(repo, { type: 'discard', paths: [], planToken: plan.token })).rejects.toMatchObject({ code: 'FILE_SCOPE_CHANGED' });
  expect(await readFile(path.join(root, 'target', 'keep.txt'), 'utf8')).toBe('unselected child');
  expect(await git(root, 'show', ':target')).toBe('base');
});

it.each(['commit', 'stage'] as const)('blocks %s of a selected child that would evict an unselected tracked ancestor', async operation => {
  const { root, repo, service } = await fixtures.setup();
  await commitFile(root, 'target', 'base');
  await rm(path.join(root, 'target')); await mkdir(path.join(root, 'target'));
  await writeFile(path.join(root, 'target', 'child.txt'), 'child');
  const snapshot = await service.snapshot(repo);
  const action: GitAction = operation === 'stage' ? { type: operation, paths: ['target/child.txt'] }
    : { type: operation, message: 'child only', files: [{ path: 'target/child.txt', area: 'unstaged' }], expectedHead: snapshot.head, expectedBranch: snapshot.branch };
  await expect(service.execute(repo, action)).rejects.toMatchObject({ code: 'FILE_SCOPE_CHANGED' });
  expect(await git(root, 'rev-parse', 'HEAD')).toBe(snapshot.head);
  expect(await git(root, 'show', ':target')).toBe('base');
  expect(await readFile(path.join(root, 'target', 'child.txt'), 'utf8')).toBe('child');
});
