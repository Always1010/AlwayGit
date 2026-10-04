import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dropStash } from '../src/git/stash-drop';
import { GitError } from '../src/git/error';
import { message } from '../src/i18n';
import type { Repository } from '../src/protocol/types';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename), rm: vi.fn(actual.rm) };
});

const exec = promisify(execFile), fixtures: string[] = [];
const git = async (root: string, ...args: string[]) => (await exec('git', ['-C', root, ...args], { windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout.trim();
async function setup(options: string[] = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alwaygit-stash-drop-')); fixtures.push(root);
  await git(root, 'init', '-b', 'main', ...options);
  await git(root, 'config', 'user.name', 'Stash Drop Test');
  await git(root, 'config', 'user.email', 'stash@example.com');
  await git(root, 'config', 'commit.gpgsign', 'false');
  await git(root, 'config', 'core.autocrlf', 'false');
  await fs.writeFile(path.join(root, 'file.txt'), 'base');
  await git(root, 'add', 'file.txt'); await git(root, 'commit', '-m', 'base');
  const commonDir = await git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  const repo: Repository = { id: root, root, commonDir, name: 'test' };
  const run = async (args: string[]) => {
    try { return { stdout: Buffer.from(await git(repo.root, ...args)), code: 0 }; }
    catch (error) { const failure = error as { stdout: string; code: number }; return { stdout: Buffer.from(failure.stdout ?? ''), code: failure.code }; }
  };
  const save = async (name: string) => { await fs.writeFile(path.join(root, 'file.txt'), name); await git(root, 'stash', 'push', '-m', name); return git(root, 'rev-parse', 'refs/stash'); };
  return { root, repo, run, save, ref: path.join(commonDir, 'refs/stash'), log: path.join(commonDir, 'logs/refs/stash'), packed: path.join(commonDir, 'packed-refs') };
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.open).mockReset(); vi.mocked(fs.rename).mockReset(); vi.mocked(fs.rm).mockReset();
  for (const root of fixtures.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('alwaygit-stash-drop-')) throw new Error('Unsafe fixture cleanup');
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

describe('Stash reflog deletion under Git locks', () => {
  it('removes a non-top identity and preserves all retained record bytes after the old OID', async () => {
    const fixture = await setup(), { root, repo, run, save, log } = fixture;
    const first = await save('first'), middle = await save('中间存档'), newest = await save('newest');
    const before = (await fs.readFile(log)).toString('utf8').trimEnd().split('\n');
    await dropStash(repo, 'stash@{1}', middle, run);
    expect(await git(root, 'stash', 'list', '--format=%H')).toBe(`${newest}\n${first}`);
    const after = (await fs.readFile(log)).toString('utf8').trimEnd().split('\n');
    expect(after.map(line => line.slice(40))).toEqual([before[0].slice(40), before[2].slice(40)]);
    expect(after[0].slice(0, 40)).toBe('0'.repeat(40));
    expect(after[1].slice(0, 40)).toBe(first);
    expect(await git(root, 'rev-parse', 'refs/stash')).toBe(newest);
  });

  it('rejects a shifted selector when an external stash is stored immediately before acquiring the lock', async () => {
    const { root, repo, run, save } = await setup(), confirmed = await save('confirmed');
    await fs.writeFile(path.join(root, 'file.txt'), 'external'); const external = await git(root, 'stash', 'create');
    let injected = false;
    const raceRun = async (args: string[]) => {
      const result = await run(args);
      if (!injected && args.at(-1) === 'packed-refs') { injected = true; await git(root, 'stash', 'store', '-m', 'external', external); }
      return result;
    };
    await expect(dropStash(repo, 'stash@{0}', confirmed, raceRun)).rejects.toMatchObject({ code: 'STASH_CHANGED' });
    expect(await git(root, 'stash', 'list', '--format=%H')).toBe(`${external}\n${confirmed}`);
  });

  it('blocks external Git reflog writers during non-top deletion', async () => {
    const { root, repo, run, save, log } = await setup(), first = await save('first'), middle = await save('middle'), newest = await save('newest');
    const { open: originalOpen } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let attempted = false;
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) === `${log}.lock`) {
        attempted = true;
        await expect(git(root, 'stash', 'store', '-m', 'external', first)).rejects.toThrow(/cannot lock ref/);
      }
      return handle;
    });
    await dropStash(repo, 'stash@{1}', middle, run);
    expect(attempted).toBe(true);
    expect(await git(root, 'stash', 'list', '--format=%H')).toBe(`${newest}\n${first}`);
  });

  it('updates a packed top ref and removes both loose and packed storage for the last stash', async () => {
    const { root, repo, run, save, ref, log, packed } = await setup(), first = await save('first'), top = await save('top');
    await git(root, 'branch', 'preserved'); const branch = await git(root, 'rev-parse', 'refs/heads/preserved');
    await git(root, 'pack-refs', '--all', '--prune');
    await expect(fs.lstat(ref)).rejects.toMatchObject({ code: 'ENOENT' });
    await dropStash(repo, 'stash@{0}', top, run);
    expect(await git(root, 'rev-parse', 'refs/stash')).toBe(first);
    await dropStash(repo, 'stash@{0}', first, run);
    expect(await git(root, 'stash', 'list')).toBe('');
    await expect(git(root, 'rev-parse', '--verify', 'refs/stash')).rejects.toThrow();
    await expect(fs.lstat(ref)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(log)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readFile(packed, 'utf8')).includes('refs/stash')).toBe(false);
    expect(await git(root, 'rev-parse', 'refs/heads/preserved')).toBe(branch);
  });

  it('deletes a packed-only last stash', async () => {
    const { root, repo, run, save } = await setup(), stash = await save('only');
    await git(root, 'pack-refs', '--all', '--prune');
    await dropStash(repo, 'stash@{0}', stash, run);
    expect(await git(root, 'stash', 'list')).toBe('');
    await expect(git(root, 'rev-parse', '--verify', 'refs/stash')).rejects.toThrow();
  });

  it('uses the shared stash in a linked worktree', async () => {
    const { root, repo, run, save } = await setup(), stash = await save('shared');
    const linked = path.join(root, 'linked'); await git(root, 'worktree', 'add', '-b', 'linked', linked);
    repo.root = linked;
    await dropStash(repo, 'stash@{0}', stash, run);
    expect(await git(root, 'stash', 'list')).toBe('');
    expect(await git(linked, 'stash', 'list')).toBe('');
  });

  it('supports SHA256 reflog chains and packed last deletion', async () => {
    const { root, repo, run, save, log } = await setup(['--object-format=sha256']), first = await save('first'), middle = await save('middle'), top = await save('top');
    await dropStash(repo, 'stash@{1}', middle, run);
    const records = (await fs.readFile(log, 'utf8')).trimEnd().split('\n');
    expect(records[0].slice(0, 64)).toBe('0'.repeat(64)); expect(records[1].slice(0, 64)).toBe(first);
    await git(root, 'pack-refs', '--all', '--prune');
    await dropStash(repo, 'stash@{0}', top, run); await dropStash(repo, 'stash@{0}', first, run);
    expect(await git(root, 'stash', 'list')).toBe('');
  });

  it.each(['ref', 'packed', 'log'] as const)('preserves a foreign %s lock and the stash', async which => {
    const fixture = await setup(), stash = await fixture.save('saved'), lock = `${fixture[which]}.lock`;
    await fs.writeFile(lock, 'foreign'); const before = await fs.readFile(fixture.log);
    await expect(dropStash(fixture.repo, 'stash@{0}', stash, fixture.run)).rejects.toMatchObject({ code: 'STASH_DELETE_BUSY' });
    expect(await fs.readFile(lock, 'utf8')).toBe('foreign'); expect(await fs.readFile(fixture.log)).toEqual(before);
    expect(await git(fixture.root, 'rev-parse', 'refs/stash')).toBe(stash);
  });

  it('fails closed for reftable without changing the stash', async () => {
    const { root, repo, run, save } = await setup(['--ref-format=reftable']), stash = await save('saved');
    await expect(dropStash(repo, 'stash@{0}', stash, run)).rejects.toMatchObject({ code: 'STASH_DELETE_UNSUPPORTED' });
    expect(await git(root, 'stash', 'list', '--format=%H')).toBe(stash);
  });

  it('rejects symbolic and malformed refs without changing their reflog', async () => {
    const { repo, run, save, ref, log } = await setup(), stash = await save('saved'), before = await fs.readFile(log);
    for (const content of ['ref: refs/heads/main\n', 'invalid\n']) {
      await fs.writeFile(ref, content);
      await expect(dropStash(repo, 'stash@{0}', stash, run)).rejects.toMatchObject({ code: 'STASH_DELETE_UNSUPPORTED' });
      expect(await fs.readFile(log)).toEqual(before); expect(await fs.readFile(ref, 'utf8')).toBe(content);
    }
  });

  it('rejects a symlink reflog without touching its target', async ({ skip }) => {
    const { repo, run, save, root, log } = await setup(), stash = await save('saved'), before = await fs.readFile(log), target = path.join(root, 'original-log');
    await fs.rename(log, target);
    try { await fs.symlink(target, log, 'file'); }
    catch (error) { if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) { skip('File symlink permission unavailable'); return; } throw error; }
    await expect(dropStash(repo, 'stash@{0}', stash, run)).rejects.toMatchObject({ code: 'STASH_DELETE_UNSUPPORTED' });
    expect(await fs.readFile(target)).toEqual(before); expect((await fs.lstat(log)).isSymbolicLink()).toBe(true);
  });

  it('restores the original reflog if top ref publication fails', async () => {
    const { root, repo, run, save, ref, log } = await setup(); await save('first'); const top = await save('top'), before = await fs.readFile(log);
    const { rename: originalRename } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(fs.rename).mockImplementation(async (source, destination) => {
      if (String(source) === `${ref}.lock`) throw Object.assign(new Error('Ref publication failed'), { code: 'EPERM' });
      await originalRename(source, destination);
    });
    await expect(dropStash(repo, 'stash@{0}', top, run)).rejects.toThrow('Ref publication failed');
    expect(await fs.readFile(log)).toEqual(before); expect(await git(root, 'rev-parse', 'refs/stash')).toBe(top);
    await expect(fs.lstat(`${ref}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restores packed storage and the reflog when last loose-ref removal fails', async () => {
    const { root, repo, run, save, ref, log, packed } = await setup(), stash = await save('last');
    await git(root, 'pack-refs', '--all'); await fs.writeFile(ref, `${stash}\n`);
    const beforeLog = await fs.readFile(log), beforePacked = await fs.readFile(packed);
    const { rm: originalRm } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(fs.rm).mockImplementation(async (name, options) => {
      if (String(name) === ref) throw new Error('Removal failed');
      await originalRm(name, options);
    });
    await expect(dropStash(repo, 'stash@{0}', stash, run)).rejects.toThrow('Removal failed');
    expect(await fs.readFile(log)).toEqual(beforeLog); expect(await fs.readFile(packed)).toEqual(beforePacked);
    expect(await git(root, 'rev-parse', 'refs/stash')).toBe(stash);
  });

  it('retains recovery bytes and reports a partial failure when rollback cannot publish', async () => {
    const { repo, run, save, ref, log, packed } = await setup(); await save('first'); const top = await save('top'), before = await fs.readFile(log);
    const { rename: originalRename } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(fs.rename).mockImplementation(async (source, destination) => {
      if (String(source) === `${ref}.lock` || String(source).startsWith(`${log}.alwaygit-rollback-`)) throw new Error('Publication failed');
      await originalRename(source, destination);
    });
    const failure = await dropStash(repo, 'stash@{0}', top, run).catch(error => error);
    expect(failure).toMatchObject({ code: 'STASH_DELETE_PARTIAL', stderr: expect.stringContaining('.alwaygit-rollback-') });
    const recovery = (await fs.readdir(path.dirname(log))).filter(name => name.startsWith('stash.alwaygit-rollback-'));
    expect(recovery).toHaveLength(1); expect(await fs.readFile(path.join(path.dirname(log), recovery[0]))).toEqual(before);
    expect(failure.message).toContain(recovery[0]);
    expect(failure.localizedMessage.parameters.paths).toBe(path.join(path.dirname(log), recovery[0]));
    await expect(fs.lstat(`${ref}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(`${packed}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the primary failure when lock cleanup also fails', async () => {
    const { repo, run, save, ref, log } = await setup(); await save('first'); const top = await save('top'), before = await fs.readFile(log);
    const primary = new GitError(message('service.invalidStashSelector'), 'TEST_PUBLISH_FAILED'), originalMessage = primary.message;
    const { rename: originalRename, rm: originalRm } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(fs.rename).mockImplementation(async (source, destination) => {
      if (String(source) === `${ref}.lock`) throw primary;
      await originalRename(source, destination);
    });
    vi.mocked(fs.rm).mockImplementation(async (name, options) => {
      if (String(name) === `${ref}.lock`) throw new Error('Lock cleanup failed');
      await originalRm(name, options);
    });
    const failure = await dropStash(repo, 'stash@{0}', top, run).catch(error => error);
    expect(failure).toBe(primary); expect(failure.code).toBe('TEST_PUBLISH_FAILED');
    expect(failure.message).toContain(originalMessage); expect(failure.message).toContain('Lock cleanup failed');
    expect(failure.localizedMessage).toMatchObject({ key: 'service.stashDeleteCleanupAfterError', parameters: { value: originalMessage, paths: expect.stringContaining(`${ref}.lock`) } });
    expect(await fs.readFile(log)).toEqual(before);
  });
});
