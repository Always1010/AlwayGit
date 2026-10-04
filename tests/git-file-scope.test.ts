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

it('stages, unstages and commits a selected gitlink while preserving unselected staged content', async () => {
  const { root, repo, service } = await fixtures.setup(), child = await fixtures.setup();
  await commitFile(child.root, 'child.txt', 'child base');
  await commitFile(root, 'other.txt', 'other base');
  await git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', child.root, 'sub');
  await git(root, 'commit', '-m', 'submodule');
  const sub = path.join(root, 'sub');
  await git(sub, 'config', 'user.name', 'Submodule Test'); await git(sub, 'config', 'user.email', 'sub@example.com');
  await git(sub, 'config', 'commit.gpgsign', 'false');
  const next = await commitFile(sub, 'child.txt', 'next child');
  await writeFile(path.join(root, 'other.txt'), 'unselected staged'); await git(root, 'add', 'other.txt');
  await service.execute(repo, { type: 'stage', paths: ['sub', 'other.txt'] });
  expect(await git(root, 'rev-parse', ':sub')).toBe(next);
  await service.execute(repo, { type: 'unstage', paths: ['sub'] });
  expect(await git(root, 'rev-parse', ':sub')).not.toBe(next);
  await service.execute(repo, { type: 'stage', paths: ['sub'] });
  const snapshot = await service.snapshot(repo);
  await service.execute(repo, { type: 'commit', message: 'sub only', files: [{ path: 'sub', area: 'staged' }], expectedHead: snapshot.head, expectedBranch: snapshot.branch });
  expect(await git(root, 'rev-parse', 'HEAD:sub')).toBe(next);
  expect(await git(root, 'show', 'HEAD:other.txt')).toBe('other base');
  expect(await git(root, 'show', ':other.txt')).toBe('unselected staged');
  await commitFile(sub, 'child.txt', 'another child');
  await expect(service.prepareDiscard(repo, { paths: ['sub'] })).rejects.toMatchObject({ code: 'FILE_SCOPE_CHANGED' });
  await expect(service.execute(repo, { type: 'stash.create', paths: ['sub'] })).rejects.toMatchObject({ code: 'UNSUPPORTED_STASH_STATE' });
  const index = await git(root, 'ls-files', '--stage');
  await rm(path.join(sub, '.git')); await writeFile(path.join(sub, 'unselected.txt'), 'preserve');
  await expect(service.execute(repo, { type: 'stage', paths: ['sub'] })).rejects.toMatchObject({ code: 'FILE_SCOPE_CHANGED' });
  expect(await git(root, 'ls-files', '--stage')).toBe(index);
}, 60000);

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
