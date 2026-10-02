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
