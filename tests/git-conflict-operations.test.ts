import { afterEach, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { commitFile, git, gitFixtures } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-conflict-operations-');
afterEach(fixtures.cleanup);
type Kind = 'rebase' | 'cherry-pick' | 'revert';

async function pauseOperation(kind: Kind) {
  const fixture = await fixtures.setup(), { root, service, repo } = fixture;
  await git(root, 'config', 'core.autocrlf', 'false');
  const base = await commitFile(root, 'file.txt', 'base\n', 'base');
  if (kind !== 'revert') await git(root, 'checkout', '-b', 'incoming');
  const target = await commitFile(root, 'file.txt', 'incoming\n', 'incoming change');
  if (kind !== 'revert') await git(root, 'checkout', 'main');
  const original = await commitFile(root, 'file.txt', 'ours\n', 'current change');
  const originalIndex = await git(root, 'ls-files', '--stage');
  const action = kind === 'rebase'
    ? await service.prepareAction(repo, { type: 'rebase', target: 'incoming' })
    : { type: kind, commits: [target] };
  await expect(service.execute(repo, action)).rejects.toThrow();
  expect((await service.snapshot(repo)).operation).toMatchObject({ kind, conflicts: 1, canContinue: false, canAbort: true });
  return { ...fixture, base, target, original, originalIndex };
}

it.each(['rebase', 'cherry-pick', 'revert'] as const)('resolves a real %s conflict with operation-specific sides, explicit staging and reviewed continuation', async kind => {
  const { root, repo, service, base, target, original } = await pauseOperation(kind);
  const details = await service.conflictDetails(repo, 'file.txt');
  // During rebase, ours is the onto branch and theirs is the replayed commit.
  // During revert, theirs is the reverted commit's parent, not its own tree.
  const expectedOurs = kind === 'rebase' ? 'incoming\n' : 'ours\n';
  const expectedTheirs = kind === 'rebase' ? 'ours\n' : kind === 'revert' ? 'base\n' : 'incoming\n';
  expect(details).toMatchObject({ status: 'UU', operation: kind, canChoose: true, canMerge: true,
    head: kind === 'rebase' ? target : original, incoming: kind === 'rebase' ? original : target });
  expect(await git(root, 'cat-file', 'blob', details.ours!.oid)).toBe(expectedOurs.trimEnd());
  expect(await git(root, 'cat-file', 'blob', details.theirs!.oid)).toBe(expectedTheirs.trimEnd());
  expect(details.base?.oid).toBe(await git(root, 'rev-parse', `${kind === 'revert' ? target : base}:file.txt`));

  const indexPath = path.join(repo.gitDir!, 'index'), index = await readFile(indexPath);
  const unmerged = await git(root, 'ls-files', '--unmerged', '--', 'file.txt');
  await service.execute(repo, { type: 'conflict.choose', token: details.token, side: 'theirs' });
  expect(await readFile(path.join(root, 'file.txt'))).toEqual(Buffer.from(expectedTheirs));
  expect(await readFile(indexPath)).toEqual(index);
  expect(await git(root, 'ls-files', '--unmerged', '--', 'file.txt')).toBe(unmerged);
  await expect(service.execute(repo, { type: 'operation.continue', kind })).rejects.toMatchObject({ code: 'CONFLICTS' });

  await service.execute(repo, { type: 'resolve-and-stage', paths: ['file.txt'] });
  expect(await git(root, 'ls-files', '--unmerged')).toBe('');
  expect((await service.snapshot(repo)).operation).toMatchObject({ kind, conflicts: 0, canContinue: true });
  await expect(service.execute(repo, { type: 'operation.continue', kind })).rejects.toMatchObject({ code: 'REVIEW_REQUIRED' });
  const review = await service.reviewOperation(repo);
  expect(review.kind).toBe(kind); expect(review.files.every(file => file.lines.length === 0)).toBe(true);
  await service.execute(repo, { type: 'operation.continue', kind, reviewToken: review.token });
  const completed = await service.snapshot(repo);
  expect(completed.operation.kind).toBeUndefined(); expect(completed.branch).toBe('main');
  expect(completed.changes).toEqual([]);
  expect(await readFile(path.join(root, 'file.txt'))).toEqual(Buffer.from(expectedTheirs));
  expect(await git(root, 'rev-parse', 'HEAD^')).toBe(kind === 'rebase' ? target : original);
});

it('aborts a real rebase after choosing a side and restores the original branch, Index content and Working Tree', async () => {
  const { root, repo, service, original, originalIndex } = await pauseOperation('rebase');
  const details = await service.conflictDetails(repo, 'file.txt');
  await service.execute(repo, { type: 'conflict.choose', token: details.token, side: 'ours' });
  expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('incoming\n');
  const stale = await service.conflictDetails(repo, 'file.txt');
  await service.execute(repo, { type: 'operation.abort', kind: 'rebase' });
  const restored = await service.snapshot(repo);
  expect(restored).toMatchObject({ branch: 'main', head: original, changes: [] });
  expect(restored.operation.kind).toBeUndefined();
  expect(await git(root, 'ls-files', '--stage')).toBe(originalIndex);
  expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('ours\n');
  await expect(service.execute(repo, { type: 'conflict.choose', token: stale.token, side: 'theirs' })).rejects.toMatchObject({ code: 'CONFLICT_CHANGED' });
  expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('ours\n');
});
