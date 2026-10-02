import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GitService } from '../src/git/service';

const exec = promisify(execFile);
const fixtures: string[] = [];
const git = async (cwd: string, ...args: string[]) => (await exec('git', ['-C', cwd, ...args], {
  windowsHide: true,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' },
})).stdout.trim();

async function setup(files: Record<string, string>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-stash-'));
  fixtures.push(root);
  await git(root, 'init', '-b', 'main');
  await git(root, 'config', 'user.name', 'Stash Test');
  await git(root, 'config', 'user.email', 'stash@example.com');
  await git(root, 'config', 'commit.gpgsign', 'false');
  await git(root, 'config', 'core.autocrlf', 'false');
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(root, name), content);
  await git(root, 'add', '-A');
  await git(root, 'commit', '--allow-empty', '-m', 'base');
  const service = new GitService();
  return { root, service, repo: await service.discover(root) };
}

async function state(root: string, files: string[]) {
  return {
    head: await git(root, 'rev-parse', 'HEAD'),
    branch: await git(root, 'symbolic-ref', 'HEAD'),
    index: await git(root, 'ls-files', '--stage'),
    status: await git(root, 'status', '--porcelain=v1', '-uall'),
    stashes: await git(root, 'stash', 'list', '--format=%gd %H'),
    files: await Promise.all(files.map(async name => [name, await readFile(path.join(root, name))])),
  };
}

afterEach(async () => {
  for (const root of fixtures.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('alwaygit-stash-')) {
      throw new Error('Unsafe cleanup target');
    }
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

describe('Stash saved state and restore preflight', () => {
  it('saves only selected literal paths in both trees and leaves excluded local state untouched', async () => {
    const { root, service, repo } = await setup({ 'selected [1].txt': 'selected base', 'other.txt': 'other base' });
    await writeFile(path.join(root, 'selected [1].txt'), 'selected index');
    await writeFile(path.join(root, 'other.txt'), 'other index');
    await git(root, 'add', '-A');
    await writeFile(path.join(root, 'selected [1].txt'), 'selected worktree');
    await writeFile(path.join(root, 'other.txt'), 'other worktree');
    await writeFile(path.join(root, 'selected 1.txt'), 'unselected untracked');

    await service.execute(repo, { type: 'stash.create', paths: ['selected [1].txt'], includeUntracked: true });
    const saved = (await service.snapshot(repo)).stashes[0];
    expect(await git(root, 'show', `${saved.oid}^2:selected [1].txt`)).toBe('selected index');
    expect(await git(root, 'show', `${saved.oid}:selected [1].txt`)).toBe('selected worktree');
    expect(await git(root, 'show', `${saved.oid}^2:other.txt`)).toBe('other base');
    expect(await git(root, 'show', `${saved.oid}:other.txt`)).toBe('other base');
    expect(await git(root, 'show', ':selected [1].txt')).toBe('selected base');
    expect(await readFile(path.join(root, 'selected [1].txt'), 'utf8')).toBe('selected base');
    expect(await git(root, 'show', ':other.txt')).toBe('other index');
    expect(await readFile(path.join(root, 'other.txt'), 'utf8')).toBe('other worktree');
    expect(await readFile(path.join(root, 'selected 1.txt'), 'utf8')).toBe('unselected untracked');
    expect((await service.stashDetails(repo, saved.oid)).totalFiles).toBe(1);
  });

  it('includes selected untracked files and restores them without consuming the saved entry', async () => {
    const { root, service, repo } = await setup({ 'base.txt': 'base' });
    await writeFile(path.join(root, 'saved.txt'), 'saved notes');
    await writeFile(path.join(root, 'keep.txt'), 'keep notes');
    await service.execute(repo, { type: 'stash.create', paths: ['saved.txt'], includeUntracked: true });
    const saved = (await service.snapshot(repo)).stashes[0];
    expect(await git(root, 'ls-tree', '--name-only', `${saved.oid}^3`)).toBe('saved.txt');
    await expect(readFile(path.join(root, 'saved.txt'))).rejects.toThrow();
    expect(await readFile(path.join(root, 'keep.txt'), 'utf8')).toBe('keep notes');
    await service.execute(repo, { type: 'stash.apply', selector: saved.selector, expectedOid: saved.oid });
    expect(await readFile(path.join(root, 'saved.txt'), 'utf8')).toBe('saved notes');
    expect(await git(root, 'ls-files', '--others', '--exclude-standard')).toBe('keep.txt\nsaved.txt');
    expect((await service.snapshot(repo)).stashes).toEqual([saved]);
  });

  it('restores distinct index and working contents by default and keeps the Stash', async () => {
    const { root, service, repo } = await setup({ 'same.txt': 'base' });
    await writeFile(path.join(root, 'same.txt'), 'staged content');
    await git(root, 'add', '--', 'same.txt');
    await writeFile(path.join(root, 'same.txt'), 'working content');
    await service.execute(repo, { type: 'stash.create' });
    const saved = (await service.snapshot(repo)).stashes[0];
    await service.execute(repo, { type: 'stash.apply', selector: saved.selector, expectedOid: saved.oid });
    expect(await git(root, 'show', ':same.txt')).toBe('staged content');
    expect(await readFile(path.join(root, 'same.txt'), 'utf8')).toBe('working content');
    expect((await service.snapshot(repo)).changes).toEqual([expect.objectContaining({ path: 'same.txt', indexStatus: 'M', worktreeStatus: 'M' })]);
    expect((await service.snapshot(repo)).stashes).toEqual([saved]);
  });

  it('roundtrips both sides of a selected staged rename and the later working edit', async () => {
    const base = 'one\ntwo\nthree\nfour\nfive\n';
    const { root, service, repo } = await setup({ 'old [1].txt': base, 'neighbor.txt': 'base' });
    await rename(path.join(root, 'old [1].txt'), path.join(root, 'new [1].txt'));
    await git(root, 'add', '-A');
    await writeFile(path.join(root, 'new [1].txt'), `${base}later working edit\n`);
    await service.execute(repo, { type: 'stash.create', paths: ['new [1].txt'] });
    const saved = (await service.snapshot(repo)).stashes[0];
    expect(await readFile(path.join(root, 'old [1].txt'), 'utf8')).toBe(base);
    await expect(readFile(path.join(root, 'new [1].txt'))).rejects.toThrow();
    await service.execute(repo, { type: 'stash.apply', selector: saved.selector, expectedOid: saved.oid });
    await expect(readFile(path.join(root, 'old [1].txt'))).rejects.toThrow();
    expect(await git(root, 'show', ':new [1].txt')).toBe(base.trim());
    expect(await readFile(path.join(root, 'new [1].txt'), 'utf8')).toBe(`${base}later working edit\n`);
    expect((await service.snapshot(repo)).changes).toEqual([expect.objectContaining({ path: 'new [1].txt', originalPath: 'old [1].txt', indexStatus: 'R', worktreeStatus: 'M' })]);
  });

  it('saves and restores an index-only difference when working contents equal HEAD', async () => {
    const { root, service, repo } = await setup({ 'same.txt': 'base' });
    await writeFile(path.join(root, 'same.txt'), 'index edit');
    await git(root, 'add', '--', 'same.txt');
    await writeFile(path.join(root, 'same.txt'), 'base');
    await service.execute(repo, { type: 'stash.create', paths: ['same.txt'] });
    const saved = (await service.snapshot(repo)).stashes[0];
    expect(saved).toBeDefined();
    expect(await git(root, 'show', `${saved.oid}^2:same.txt`)).toBe('index edit');
    expect(await git(root, 'show', `${saved.oid}:same.txt`)).toBe('base');
    expect((await service.snapshot(repo)).changes).toEqual([]);
    await service.execute(repo, { type: 'stash.apply', selector: saved.selector, expectedOid: saved.oid });
    expect(await git(root, 'show', ':same.txt')).toBe('index edit');
    expect(await readFile(path.join(root, 'same.txt'), 'utf8')).toBe('base');
  });

  it('blocks a worktree merge conflict before restoring any clean neighboring file', async () => {
    const { root, service, repo } = await setup({ 'a.txt': 'base a', 'b.txt': 'base b', 'local.txt': 'base local' });
    await writeFile(path.join(root, 'a.txt'), 'saved a');
    await writeFile(path.join(root, 'b.txt'), 'saved b');
    await service.execute(repo, { type: 'stash.create' });
    const saved = (await service.snapshot(repo)).stashes[0];
    await writeFile(path.join(root, 'a.txt'), 'advanced a');
    await git(root, 'add', '--', 'a.txt');
    await git(root, 'commit', '-m', 'advance conflicting file');
    await writeFile(path.join(root, 'local.txt'), 'local index');
    await git(root, 'add', '--', 'local.txt');
    await writeFile(path.join(root, 'local.txt'), 'local working');
    await writeFile(path.join(root, 'notes.txt'), 'untracked notes');
    const files = ['a.txt', 'b.txt', 'local.txt', 'notes.txt'];
    const before = await state(root, files);
    await expect(service.execute(repo, { type: 'stash.apply', selector: saved.selector, expectedOid: saved.oid })).rejects.toMatchObject({
      code: 'STASH_RESTORE_BLOCKED',
      details: { kind: 'stash-apply', reason: 'restore-conflict', paths: expect.arrayContaining(['a.txt']), stashOid: saved.oid, workingTreeUnchanged: true, stashRetained: true },
    });
    expect(await state(root, files)).toEqual(before);
  });

  it('blocks an index restoration conflict while preserving HEAD, local edits and the saved entry', async () => {
    const { root, service, repo } = await setup({ 'same.txt': 'base', 'other.txt': 'base other' });
    await writeFile(path.join(root, 'same.txt'), 'saved index');
    await git(root, 'add', '--', 'same.txt');
    await writeFile(path.join(root, 'other.txt'), 'saved working');
    await service.execute(repo, { type: 'stash.create' });
    const saved = (await service.snapshot(repo)).stashes[0];
    await writeFile(path.join(root, 'same.txt'), 'current index');
    await git(root, 'add', '--', 'same.txt');
    await writeFile(path.join(root, 'same.txt'), 'current working');
    const before = await state(root, ['same.txt', 'other.txt']);
    await expect(service.execute(repo, { type: 'stash.apply', selector: saved.selector, expectedOid: saved.oid })).rejects.toMatchObject({
      code: 'STASH_RESTORE_BLOCKED',
      details: { kind: 'stash-apply', reason: 'restore-conflict', workingTreeUnchanged: true, stashRetained: true },
    });
    expect(await state(root, ['same.txt', 'other.txt'])).toEqual(before);
  });

  it('blocks Git index restore failure caused by unrelated staged and working edits without changing them', async () => {
    const { root, service, repo } = await setup({ 'saved.txt': 'base saved', 'local.txt': 'base local' });
    await writeFile(path.join(root, 'saved.txt'), 'saved index');
    await git(root, 'add', '--', 'saved.txt');
    await writeFile(path.join(root, 'saved.txt'), 'saved working');
    await service.execute(repo, { type: 'stash.create' });
    const saved = (await service.snapshot(repo)).stashes[0];
    await writeFile(path.join(root, 'local.txt'), 'local index');
    await git(root, 'add', '--', 'local.txt');
    await writeFile(path.join(root, 'local.txt'), 'local working');
    const before = await state(root, ['saved.txt', 'local.txt']);
    await expect(service.execute(repo, { type: 'stash.apply', selector: saved.selector, expectedOid: saved.oid })).rejects.toMatchObject({
      code: 'STASH_RESTORE_BLOCKED', details: { workingTreeUnchanged: true, stashRetained: true },
    });
    expect(await state(root, ['saved.txt', 'local.txt'])).toEqual(before);
    expect(await git(root, 'show', ':local.txt')).toBe('local index');
    expect(await readFile(path.join(root, 'local.txt'), 'utf8')).toBe('local working');
    expect((await service.snapshot(repo)).stashes).toEqual([saved]);
  });

  it('preserves UTF-16 raw working bytes and canonical blobs using repository-local attributes', async () => {
    const { root, service, repo } = await setup({ 'base.txt': 'base' });
    await writeFile(path.join(root, '.git', 'info', 'attributes'), 'encoded.txt text working-tree-encoding=UTF-16LE-BOM eol=lf\n');
    const encoded = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    const base = encoded('原始内容\n'), staged = encoded('暂存内容\n'), working = encoded('现场内容\n');
    await writeFile(path.join(root, 'encoded.txt'), base);
    await git(root, 'add', '--', 'encoded.txt');
    await git(root, 'commit', '-m', 'encoded base');
    await writeFile(path.join(root, 'encoded.txt'), staged);
    await git(root, 'add', '--', 'encoded.txt');
    await writeFile(path.join(root, 'encoded.txt'), working);

    await service.execute(repo, { type: 'stash.create', paths: ['encoded.txt'] });
    const saved = (await service.snapshot(repo)).stashes[0];
    expect(await service.content(repo, { kind: 'revision', revision: `${saved.oid}^2`, path: 'encoded.txt' })).toEqual(Buffer.from('暂存内容\n'));
    expect(await service.content(repo, { kind: 'revision', revision: saved.oid, path: 'encoded.txt' })).toEqual(Buffer.from('现场内容\n'));
    expect(await readFile(path.join(root, 'encoded.txt'))).toEqual(base);
    await service.execute(repo, { type: 'stash.apply', selector: saved.selector, expectedOid: saved.oid });
    expect(await readFile(path.join(root, 'encoded.txt'))).toEqual(working);
    expect(await service.content(repo, { kind: 'index', path: 'encoded.txt' })).toEqual(Buffer.from('暂存内容\n'));
    expect((await service.snapshot(repo)).stashes).toEqual([saved]);
  });

  it.each(['external-filter', 'merge-default'] as const)('blocks %s during restore inspection without changing project state', async driver => {
    const { root, service, repo } = await setup({ 'saved.txt': 'base saved', 'local.txt': 'base local' });
    await writeFile(path.join(root, 'saved.txt'), 'saved working');
    await service.execute(repo, { type: 'stash.create' });
    const saved = (await service.snapshot(repo)).stashes[0];
    await writeFile(path.join(root, 'local.txt'), 'local index');
    await git(root, 'add', '--', 'local.txt');
    await writeFile(path.join(root, 'local.txt'), 'local working');
    await writeFile(path.join(root, 'notes.txt'), 'local notes');
    if (driver === 'external-filter') {
      await git(root, 'config', 'filter.external.clean', 'cat');
      await git(root, 'config', 'filter.external.smudge', 'cat');
      await writeFile(path.join(root, '.git', 'info', 'attributes'), 'saved.txt filter=external\n');
    } else {
      await git(root, 'config', 'merge.default', 'external');
      await git(root, 'config', 'merge.external.driver', 'true');
    }
    const files = ['saved.txt', 'local.txt', 'notes.txt'];
    const before = await state(root, files);
    const index = await readFile(path.join(root, '.git', 'index'));
    await expect(service.execute(repo, { type: 'stash.apply', selector: saved.selector, expectedOid: saved.oid })).rejects.toMatchObject({
      code: 'STASH_RESTORE_BLOCKED',
      details: { kind: 'stash-apply', reason: 'restore-blocked', workingTreeUnchanged: true, stashRetained: true },
    });
    expect(await readFile(path.join(root, '.git', 'index'))).toEqual(index);
    expect(await state(root, files)).toEqual(before);
  });

  it('saves and restores selected untracked files after an empty commit with no existing index', async () => {
    const { root, service, repo } = await setup({});
    await rm(path.join(root, '.git', 'index'), { force: true });
    await expect(readFile(path.join(root, '.git', 'index'))).rejects.toThrow();
    await writeFile(path.join(root, 'notes.txt'), 'saved notes');
    await service.execute(repo, { type: 'stash.create', paths: ['notes.txt'], includeUntracked: true });
    const saved = (await service.snapshot(repo)).stashes[0];
    expect(await git(root, 'show', `${saved.oid}^3:notes.txt`)).toBe('saved notes');
    await expect(readFile(path.join(root, 'notes.txt'))).rejects.toThrow();
    await service.execute(repo, { type: 'stash.apply', selector: saved.selector, expectedOid: saved.oid });
    expect(await readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('saved notes');
    expect(await git(root, 'ls-files', '--stage')).toBe('');
    expect((await service.snapshot(repo)).stashes).toEqual([saved]);
  });

  it('isolates a conflicting trial when the service environment points Git at the source index and worktree', async () => {
    const { root, service, repo } = await setup({ 'a.txt': 'base a', 'b.txt': 'base b', 'local.txt': 'base local' });
    await writeFile(path.join(root, 'a.txt'), 'saved a');
    await writeFile(path.join(root, 'b.txt'), 'saved b');
    await service.execute(repo, { type: 'stash.create' });
    const saved = (await service.snapshot(repo)).stashes[0];
    await writeFile(path.join(root, 'a.txt'), 'advanced a');
    await git(root, 'add', '--', 'a.txt');
    await git(root, 'commit', '-m', 'advance conflicting file');
    await writeFile(path.join(root, 'local.txt'), 'local index');
    await git(root, 'add', '--', 'local.txt');
    await writeFile(path.join(root, 'local.txt'), 'local working');
    await writeFile(path.join(root, 'notes.txt'), 'local notes');
    const files = ['a.txt', 'b.txt', 'local.txt', 'notes.txt'];
    const before = await state(root, files);
    const index = await readFile(path.join(root, '.git', 'index'));
    const directedService = new GitService({ environment: {
      GIT_DIR: path.join(root, '.git'),
      GIT_WORK_TREE: root,
      GIT_INDEX_FILE: path.join(root, '.git', 'index'),
    } });
    await expect(directedService.execute(repo, { type: 'stash.apply', selector: saved.selector, expectedOid: saved.oid })).rejects.toMatchObject({
      code: 'STASH_RESTORE_BLOCKED',
      details: { kind: 'stash-apply', reason: 'restore-conflict', workingTreeUnchanged: true, stashRetained: true },
    });
    expect(await readFile(path.join(root, '.git', 'index'))).toEqual(index);
    expect(await state(root, files)).toEqual(before);
  });
});
