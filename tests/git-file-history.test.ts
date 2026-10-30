import { afterEach, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { gitFixtures, git, commitFile } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-file-history-');
afterEach(fixtures.cleanup);

it('batches long file histories and pages after Git filtering rather than the loaded repository page', async () => {
  const { root, repo, service } = await fixtures.setup(),
    base = await commitFile(root, 'target.txt', 'base', 'base');
  let stream = '';
  for (let index = 1; index <= 300; index++) {
    const subject = `change ${index}`,
      content = `version ${index}\n`,
      name = index % 2 ? 'target.txt' : 'unrelated.txt';
    stream += `commit refs/heads/history\nmark :${index}\ncommitter Test <test@example.com> ${1700000000 + index} +0000\ndata ${Buffer.byteLength(subject)}\n${subject}\nfrom ${index === 1 ? base : `:${index - 1}`}\nM 100644 inline ${name}\ndata ${Buffer.byteLength(content)}\n${content}\n`;
  }
  await new Promise<void>((resolve, reject) => {
    const child = execFile('git', ['-C', root, 'fast-import', '--quiet'], (error) =>
      error ? reject(error) : resolve(),
    );
    child.stdin!.end(stream);
  });
  const tip = await git(root, 'rev-parse', 'history'),
    expected = (await git(root, 'rev-list', '--topo-order', 'history', '--', 'target.txt')).split(
      '\n',
    );
  const file = { path: 'target.txt', revision: tip };
  const first = await service.history(repo, { tips: ['history'], file, limit: 130 });
  const second = await service.history(repo, {
    tips: first.tips,
    file,
    offset: first.nextOffset,
    limit: 130,
  });
  expect([...first.commits, ...second.commits].map((commit) => commit.oid)).toEqual(expected);
  expect(first.commits).toHaveLength(130);
  expect(second.commits).toHaveLength(21);
  expect(second.hasMore).toBe(false);
  expect(first.commits.at(-1)?.fileHistory?.graphParents).toEqual([second.commits[0].oid]);
});

it('pages literal file history across hidden commits and keeps real parents and remote availability', async () => {
  const { root, repo, service } = await fixtures.setup(),
    name = 'file [1]*.txt';
  const first = await commitFile(root, name, 'first\n', 'first file change');
  await git(root, 'update-ref', 'refs/remotes/origin/main', first);
  const unrelated = await commitFile(root, 'other.txt', 'noise', 'unrelated');
  const last = await commitFile(root, name, 'first\nlast\n', 'last file change');
  const query = { tips: ['HEAD'], head: last, file: { path: name, revision: last }, limit: 1 };
  const page = await service.history(repo, query);
  expect(page).toMatchObject({ nextOffset: 1, hasMore: true, tips: [last], filePaths: [name] });
  expect(page.commits).toMatchObject([
    {
      oid: last,
      parents: [unrelated],
      pushed: false,
      fileHistory: { paths: [name], graphParents: [first] },
    },
  ]);
  const older = await service.history(repo, { ...query, tips: page.tips, offset: page.nextOffset });
  expect(older).toMatchObject({ nextOffset: 2, hasMore: false });
  expect(older.commits).toMatchObject([
    { oid: first, pushed: true, fileHistory: { graphParents: [] } },
  ]);
  expect(page.head?.oid).toBe(last);
  expect(
    (await service.history(repo, { ...query, tips: [unrelated], head: unrelated })).head,
  ).toBeUndefined();
  const search = await service.history(repo, { ...query, search: 'FIRST FILE' });
  expect(search.commits.map((commit) => commit.oid)).toEqual([first]);
  await git(root, 'update-ref', 'refs/remotes/origin/main', last);
  expect((await service.history(repo, query)).commits[0].pushed).toBe(true);
  expect((await service.history(repo, { ...query, tips: [] })).commits).toEqual([]);
});

it('follows each merge parent independently through a rename and preserves the changed parent for Diff', async () => {
  const { root, repo, service } = await fixtures.setup();
  const base = await commitFile(root, 'old.txt', 'one\ntwo\nthree\nfour\nfive\n', 'create');
  await git(root, 'checkout', '-b', 'topic');
  await git(root, 'mv', 'old.txt', 'new.txt');
  await git(root, 'commit', '-m', 'rename');
  const rename = await git(root, 'rev-parse', 'HEAD');
  const topic = await commitFile(
    root,
    'new.txt',
    'one\ntwo\nthree\nfour\nfive\nend\n',
    'topic edit',
  );
  await git(root, 'checkout', 'main');
  const main = await commitFile(
    root,
    'old.txt',
    'start\none\ntwo\nthree\nfour\nfive\n',
    'main edit',
  );
  await git(root, 'merge', '--no-ff', 'topic', '-m', 'merge file');
  const merge = await git(root, 'rev-parse', 'HEAD');
  const page = await service.history(repo, {
    tips: ['main'],
    head: merge,
    file: { path: 'new.txt', revision: merge },
  });
  expect(new Set(page.commits.map((commit) => commit.oid))).toEqual(
    new Set([base, rename, topic, main, merge]),
  );
  expect(page.commits[0]).toMatchObject({
    oid: merge,
    parents: [main, topic],
    fileHistory: { graphParents: [main, topic], paths: ['new.txt'], parent: main },
  });
  for (const [oid, name] of [
    [main, 'old.txt'],
    [topic, 'new.txt'],
    [rename, 'new.txt'],
    [base, 'old.txt'],
  ]) {
    const entry = page.commits.find((commit) => commit.oid === oid)!;
    expect(entry.fileHistory?.paths).toContain(name);
    expect(
      (await service.details(repo, oid, entry.fileHistory?.parent)).files.some(
        (file) => file.path === name,
      ),
    ).toBe(true);
  }
});

it('anchors an old pathname, finds later renames and sibling branches, and excludes independent pathname reuse', async () => {
  const { root, repo, service } = await fixtures.setup();
  const base = await commitFile(root, 'old.txt', 'original\n', 'original file');
  await git(root, 'branch', 'sibling');
  await git(root, 'mv', 'old.txt', 'new.txt');
  await git(root, 'commit', '-m', 'rename');
  const rename = await git(root, 'rev-parse', 'HEAD');
  const edit = await commitFile(root, 'new.txt', 'original\nmore\n', 'new edit');
  const reused = await commitFile(
    root,
    'old.txt',
    'independent replacement\n',
    'unrelated old name',
  );
  await git(root, 'checkout', 'sibling');
  const sibling = await commitFile(root, 'old.txt', 'original\nsibling\n', 'sibling edit');
  await git(root, 'checkout', 'main');
  const file = { path: 'old.txt', revision: base };
  const current = await service.history(repo, { tips: ['main'], head: reused, file });
  expect(current.commits.map((commit) => commit.oid)).toEqual([edit, rename, base]);
  expect(current.filePaths).toEqual(['new.txt']);
  const all = await service.history(repo, { tips: ['main', 'sibling'], head: reused, file });
  expect(new Set(all.commits.map((commit) => commit.oid))).toEqual(
    new Set([base, rename, edit, sibling]),
  );
  const onlySibling = await service.history(repo, {
    tips: ['sibling'],
    file: { path: 'new.txt', revision: edit },
  });
  expect(onlySibling.commits.map((commit) => commit.oid)).toEqual([sibling, base]);
  expect(all.commits.some((commit) => commit.oid === reused)).toBe(false);
});

it('opens deleted and uncommitted-renamed files without disk contents, and stops at a later independent creation', async () => {
  const { root, repo, service } = await fixtures.setup();
  const base = await commitFile(root, 'old.txt', 'original\n', 'create');
  await git(root, 'mv', 'old.txt', 'staged.txt');
  const staged = await service.history(repo, {
    tips: ['HEAD'],
    head: base,
    file: { path: 'staged.txt', anchorPath: 'old.txt', revision: base },
  });
  expect(staged.commits.map((commit) => commit.oid)).toEqual([base]);
  await git(root, 'reset', '--hard', 'HEAD');
  await git(root, 'rm', 'old.txt');
  await git(root, 'commit', '-m', 'delete');
  const deletion = await git(root, 'rev-parse', 'HEAD');
  const noise = await commitFile(root, 'other.txt', 'other', 'noise');
  expect(
    (
      await service.history(repo, {
        tips: ['HEAD'],
        head: noise,
        file: { path: 'old.txt', revision: deletion },
      })
    ).commits.map((commit) => commit.oid),
  ).toEqual([deletion, base]);
  const replacement = await commitFile(root, 'old.txt', 'new identity', 'recreate');
  expect(
    (
      await service.history(repo, {
        tips: ['HEAD'],
        file: { path: 'old.txt', revision: replacement },
      })
    ).commits.map((commit) => commit.oid),
  ).toEqual([replacement]);
  expect(
    (
      await service.history(repo, { tips: ['HEAD'], file: { path: 'old.txt', revision: deletion } })
    ).commits.map((commit) => commit.oid),
  ).toEqual([deletion, base]);
  expect(
    (
      await service.history(repo, {
        tips: ['HEAD'],
        file: { path: 'never.txt', revision: replacement },
      })
    ).commits,
  ).toEqual([]);
});

it('keeps unusual names literal, validates file scope and cancels read-only history without changing the repository', async () => {
  const { root, repo, service } = await fixtures.setup();
  await mkdir(path.join(root, 'folder'));
  const name = 'folder/line\nbreak.txt',
    head = await commitFile(root, name, 'text', 'unusual name');
  const before = await git(root, 'status', '--porcelain=v1');
  const result = await service.history(repo, {
    tips: ['HEAD'],
    file: { path: name, revision: head },
  });
  expect(result.commits[0].fileHistory?.paths).toEqual([name]);
  for (const invalid of ['../outside', '/absolute', '.git/config'])
    await expect(
      service.history(repo, { tips: ['HEAD'], file: { path: invalid } }),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  await expect(
    service.history(repo, { tips: ['HEAD'], file: { path: 'folder' } }),
  ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  const controller = new AbortController();
  controller.abort();
  await expect(
    service.withReadSignal(controller.signal, () =>
      service.history(repo, { tips: ['HEAD'], file: { path: name } }),
    ),
  ).rejects.toMatchObject({ code: 'ABORTED' });
  expect(await git(root, 'status', '--porcelain=v1')).toBe(before);
  expect(await git(root, 'rev-parse', 'HEAD')).toBe(head);
});
