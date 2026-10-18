import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { git, gitFixtures } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-tree-');
afterEach(() => fixtures.cleanup());

describe('historical repository tree', () => {
  it('lists directories lazily and classifies symbolic links and gitlinks without following them', async () => {
    const { root, repo, service } = await fixtures.setup();
    await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'src', 'app.ts'), 'app');
    await writeFile(path.join(root, 'src', 'nested', 'deep.ts'), 'deep');
    await git(root, 'add', '-A'); await git(root, 'commit', '-m', 'base');
    const base = await git(root, 'rev-parse', 'HEAD');

    await writeFile(path.join(root, 'link'), '../outside');
    const linkBlob = await git(root, 'hash-object', '-w', '--', 'link');
    await git(root, 'update-index', '--add', '--cacheinfo', `120000,${linkBlob},link`);
    await git(root, 'update-index', '--add', '--cacheinfo', `160000,${base},vendor/module`);
    await git(root, 'commit', '-m', 'special entries');
    const revision = await git(root, 'rev-parse', 'HEAD');

    const rootTree = await service.revisionTree(repo, { revision });
    expect(rootTree).toMatchObject({ revision, path: '' });
    expect(rootTree.entries.map(entry => [entry.path, entry.type])).toEqual([
      ['link', 'symlink'], ['src', 'tree'], ['vendor', 'tree'],
    ]);
    expect(rootTree.entries.some(entry => entry.path === 'src/app.ts')).toBe(false);

    const src = await service.revisionTree(repo, { revision, path: 'src' });
    expect(src.entries.map(entry => [entry.path, entry.type])).toEqual([
      ['src/app.ts', 'blob'], ['src/nested', 'tree'],
    ]);
    const vendor = await service.revisionTree(repo, { revision, path: 'vendor' });
    expect(vendor.entries).toEqual([expect.objectContaining({ path: 'vendor/module', type: 'gitlink', oid: base, mode: '160000' })]);
  });

  it('searches all paths independently of expanded directories and pages bounded results', async () => {
    const { root, repo, service } = await fixtures.setup();
    await mkdir(path.join(root, 'one', 'two'), { recursive: true });
    await writeFile(path.join(root, 'one', 'match.txt'), 'one');
    await writeFile(path.join(root, 'one', 'two', 'match.txt'), 'two');
    await writeFile(path.join(root, 'other.txt'), 'other');
    await git(root, 'add', '-A'); await git(root, 'commit', '-m', 'tree');
    const revision = await git(root, 'rev-parse', 'HEAD');

    const first = await service.searchRevisionTree(repo, { revision, query: 'MATCH.TXT', limit: 1 });
    expect(first.entries).toHaveLength(1); expect(first.nextCursor).toBeTypeOf('number'); expect(first.truncated).toBe(false);
    const second = await service.searchRevisionTree(repo, { revision, query: 'match.txt', limit: 1, cursor: first.nextCursor });
    expect([...first.entries, ...second.entries].map(entry => entry.path)).toEqual(['one/match.txt', 'one/two/match.txt']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('requires an immutable commit ID and reads the result tree of a merge commit', async () => {
    const { root, repo, service } = await fixtures.setup();
    await writeFile(path.join(root, 'base.txt'), 'base'); await git(root, 'add', '-A'); await git(root, 'commit', '-m', 'base');
    await git(root, 'switch', '-c', 'topic'); await writeFile(path.join(root, 'topic.txt'), 'topic'); await git(root, 'add', '-A'); await git(root, 'commit', '-m', 'topic');
    await git(root, 'switch', 'main'); await writeFile(path.join(root, 'main.txt'), 'main'); await git(root, 'add', '-A'); await git(root, 'commit', '-m', 'main');
    await git(root, 'merge', '--no-ff', '-m', 'merge', 'topic');
    const revision = await git(root, 'rev-parse', 'HEAD');

    await expect(service.revisionTree(repo, { revision: 'HEAD' })).rejects.toThrow('fixed Commit ID');
    expect((await service.revisionTree(repo, { revision })).entries.map(entry => entry.path)).toEqual(['base.txt', 'main.txt', 'topic.txt']);
  });
});
