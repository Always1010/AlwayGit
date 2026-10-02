import { afterEach, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GitService } from '../src/git/service';
import { assertGitArgumentBudget, prepareGitArguments, splitCleanArguments } from '../src/git/arguments';
import { gitFixtures, git } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-arguments-test-');
afterEach(fixtures.cleanup);

it('prepares literal paths and messages without passing their payload in argv', () => {
  const names = ['-leading.txt', 'spaces [literal].txt', '汉字.txt'];
  const prepared = prepareGitArguments(['add', '--', ...names]);
  expect(prepared.args).toEqual(['add', '--pathspec-from-file=-', '--pathspec-file-nul']);
  expect(prepared.input).toEqual(Buffer.from(`${names.join('\0')}\0`));
  const description = 'long "quoted" message\n'.repeat(3000);
  expect(prepareGitArguments(['commit', '-m', description])).toEqual({ args: ['commit', '--file=-'], input: Buffer.from(description) });
  expect(prepareGitArguments(['tag', '-a', '-m', description, 'v1'])).toEqual({ args: ['tag', '-a', '--file=-', 'v1'], input: Buffer.from(description) });
  expect(() => prepareGitArguments(['tag', '-a', '-m', 'truncated\0message', 'v1'])).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  const clean = ['clean', '-f', '--', ...Array.from({ length: 220 }, (_, index) => `${index}-${'x'.repeat(150)}`)];
  const batches = splitCleanArguments('git', ['-C', '/repo', '--literal-pathspecs'], clean);
  expect(batches.length).toBeGreaterThan(1);
  expect(batches.flatMap(batch => batch.slice(3))).toEqual(clean.slice(3));
  for (const batch of batches) assertGitArgumentBudget('git', ['-C', '/repo', '--literal-pathspecs', ...batch]);
  expect(() => splitCleanArguments('git', [], ['clean', '-f', '--', 'valid', 'x'.repeat(24000)])).toThrow(expect.objectContaining({ code: 'ARGUMENT_LIMIT' }));
});

it('handles file selections above Windows argv limits and long Commit and Tag messages', async () => {
  const { root, repo, service } = await fixtures.setup();
  const names = Array.from({ length: 220 }, (_, index) => `file ${index}-${'x'.repeat(145)} [literal].txt`);
  names.push('-leading.txt', '汉字 [1].txt');
  await Promise.all(names.map(name => writeFile(path.join(root, name), 'base')));
  await writeFile(path.join(root, 'not selected.txt'), 'keep');
  await service.execute(repo, { type: 'stage', paths: names });
  expect((await git(root, 'ls-files', '-z')).split('\0').filter(Boolean)).toHaveLength(names.length);
  await service.execute(repo, { type: 'unstage', paths: names });
  expect(await git(root, 'ls-files')).toBe('');
  await service.execute(repo, { type: 'stage', paths: names });
  const message = `Long message\n\n${'中文 "quoted" \\ text\n'.repeat(3000)}`;
  await service.execute(repo, { type: 'commit', message });
  expect(await git(root, 'show', '-s', '--format=%B', 'HEAD')).toBe(message.trimEnd());
  await service.execute(repo, { type: 'tag.create', name: 'long-note', message });
  const tag = await git(root, 'cat-file', 'tag', 'refs/tags/long-note');
  expect(tag.slice(tag.indexOf('\n\n') + 2)).toBe(message.trimEnd());
  await Promise.all(names.map(name => writeFile(path.join(root, name), 'edited')));
  await service.execute(repo, { type: 'discard', paths: names });
  expect(await readFile(path.join(root, names[0]), 'utf8')).toBe('base');
  // With a HEAD, Unstage exercises restore's stdin pathspec support.
  await writeFile(path.join(root, names[0]), 'staged edit');
  await service.execute(repo, { type: 'stage', paths: names });
  await service.execute(repo, { type: 'unstage', paths: names });
  expect(await git(root, 'diff', '--cached', '--name-only')).toBe('');
  expect(await readFile(path.join(root, names[0]), 'utf8')).toBe('staged edit');
  expect(await readFile(path.join(root, 'not selected.txt'), 'utf8')).toBe('keep');
});

it('preflights every clean batch and reports previously completed batches on failure', async () => {
  const { root, repo } = await fixtures.setup();
  const names = Array.from({ length: 220 }, (_, index) => `untracked ${index}-${'x'.repeat(145)}.txt`);
  await Promise.all(names.map(name => writeFile(path.join(root, name), 'remove')));
  let clean = 0;
  const service = new GitService({ environment: async (_repo, args) => {
    if (args[0] === 'clean' && ++clean === 2) throw new Error('simulated second clean batch failure');
    return {};
  } });
  await expect(service.execute(repo, { type: 'discard', paths: names })).rejects.toMatchObject({ code: 'PARTIAL_FAILURE', message: expect.stringContaining('1 clean batch(es) completed') });
  expect(await readFile(path.join(root, names.at(-1)!), 'utf8')).toBe('remove');
  await expect(readFile(path.join(root, names[0]))).rejects.toMatchObject({ code: 'ENOENT' });
});
