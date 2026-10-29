import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { git, gitFixtures } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-tree-');
afterEach(() => fixtures.cleanup());

describe('historical repository tree', () => {
  it('indexes the complete snapshot without including working files or relying on a parent diff', async () => {
    const { root, repo, service } = await fixtures.setup();
    await mkdir(path.join(root, 'deep', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'deep', 'nested', '文件 [1].txt'), 'original');
    await git(root, 'add', '-A'); await git(root, 'commit', '-m', 'snapshot');
    const revision = await git(root, 'rev-parse', 'HEAD');
    await writeFile(path.join(root, 'deep', 'nested', '文件 [1].txt'), 'working change');
    await writeFile(path.join(root, 'untracked.txt'), 'not committed');
    const tree = await service.revisionTree(repo, { revision, recursive: true });
    expect(tree.entries.map(entry => entry.path)).toEqual(['deep', 'deep/nested', 'deep/nested/文件 [1].txt']);
    expect(tree.entries.at(-1)).toMatchObject({ name: '文件 [1].txt', size: 8 });
    expect(await service.revisionTreeCommit(repo, revision)).toMatchObject({ commit: { oid: revision, parents: [], subject: 'snapshot' }, repository: { root: repo.root } });
    await writeFile(path.join(root, 'second.txt'), 'second');
    await git(root, 'add', '-A'); await git(root, 'commit', '-m', 'second');
    const shallow = await git(root, 'rev-parse', 'HEAD');
    // Simulate a shallow boundary without deleting any objects or altering the working tree.
    const gitDirectory = await git(root, 'rev-parse', '--absolute-git-dir');
    await writeFile(path.join(gitDirectory, 'shallow'), `${shallow}\n`);
    expect((await service.revisionTreeCommit(repo, shallow)).commit.parents).toEqual([revision]);
    await expect(service.details(repo, shallow, revision)).rejects.toThrow();
    expect((await service.revisionTreeChanges(repo, shallow)).parent).toBe(revision);
    expect((await service.revisionTree(repo, { revision: shallow, recursive: true })).entries.some(entry => entry.path === 'second.txt')).toBe(true);
    await rm(path.join(gitDirectory, 'objects', revision.slice(0, 2), revision.slice(2)));
    await expect(service.revisionTreeChanges(repo, shallow)).rejects.toThrow();
    expect((await service.revisionTree(repo, { revision: shallow, recursive: true })).entries.some(entry => entry.path === 'second.txt')).toBe(true);
  });
  it('reports root additions and typed changes against an explicit parent', async () => {
    const { root, repo, service } = await fixtures.setup();
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'modified.txt'), 'before');
    await writeFile(path.join(root, 'src', 'deleted.txt'), 'delete me');
    await writeFile(path.join(root, 'before.txt'), 'rename this exact and unique content');
    await writeFile(path.join(root, 'type.txt'), 'link text');
    await git(root, 'add', '-A'); await git(root, 'commit', '-m', 'base');
    const base = await git(root, 'rev-parse', 'HEAD');
    expect((await service.revisionTreeChanges(repo, base)).files.every(file => file.status === 'A')).toBe(true);
    await writeFile(path.join(root, 'src', 'modified.txt'), 'after');
    await rm(path.join(root, 'src', 'deleted.txt'));
    await rename(path.join(root, 'before.txt'), path.join(root, 'after.txt'));
    await writeFile(path.join(root, 'added.txt'), 'new content');
    await git(root, 'add', '-A');
    const blob = await git(root, 'rev-parse', `${base}:type.txt`);
    await git(root, 'update-index', '--cacheinfo', `120000,${blob},type.txt`);
    await git(root, 'commit', '-m', 'changes');
    const revision = await git(root, 'rev-parse', 'HEAD');
    const changes = await service.revisionTreeChanges(repo, revision);
    expect(changes).toMatchObject({ revision, parent: base });
    expect(changes.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'added.txt', status: 'A', beforeMode: '000000' }),
      expect.objectContaining({ path: 'src/deleted.txt', status: 'D', beforeMode: '100644', afterMode: '000000' }),
      expect.objectContaining({ path: 'src/modified.txt', status: 'M' }),
      expect.objectContaining({ path: 'after.txt', previousPath: 'before.txt', status: 'R100' }),
      expect.objectContaining({ path: 'type.txt', status: 'T', beforeMode: '100644', afterMode: '120000' }),
    ]));
    await expect(service.revisionTreeChanges(repo, revision, revision)).rejects.toMatchObject({ code: 'INVALID_PARENT' });
  });
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
    const { commit } = await service.revisionTreeCommit(repo, revision);
    expect((await service.revisionTreeChanges(repo, revision)).files.map(file => file.path)).toEqual(['topic.txt']);
    expect((await service.revisionTreeChanges(repo, revision, commit.parents[1])).files.map(file => file.path)).toEqual(['main.txt']);
  });
});
