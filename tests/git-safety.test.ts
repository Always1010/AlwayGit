import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GitService } from '../src/git/service';

const exec = promisify(execFile);
const fixtures: string[] = [];
const git = async (cwd: string, ...args: string[]) => (await exec('git', ['-C', cwd, ...args], {
  windowsHide: true,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' },
})).stdout.trim();

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-safety-'));
  fixtures.push(root);
  await git(root, 'init', '-b', 'main');
  await git(root, 'config', 'user.name', 'Safety Test');
  await git(root, 'config', 'user.email', 'safety@example.com');
  await git(root, 'config', 'commit.gpgsign', 'false');
  const service = new GitService();
  return { root, service, repo: await service.discover(root) };
}

async function commit(root: string, filename: string, text: string) {
  await writeFile(path.join(root, filename), text);
  await git(root, 'add', '--', filename);
  await git(root, 'commit', '-m', text);
  return git(root, 'rev-parse', 'HEAD');
}

afterEach(async () => {
  for (const root of fixtures.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('alwaygit-safety-')) {
      throw new Error('Unsafe cleanup target');
    }
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

describe('Git safety regressions', () => {
  it.each([false, true])('rejects stale branch names without changing HEAD, refs, Index or files (dirty: %s)', async dirty => {
    const { root, service, repo } = await setup();
    const old = await commit(root, 'a.txt', 'old');
    await commit(root, 'a.txt', 'current');
    await commit(root, 'new.txt', 'only in current');
    // The UI snapshot predates the conflicting branch; packed refs must also be checked.
    await service.snapshot(repo);
    await git(root, 'branch', 'test/b1');
    await git(root, 'pack-refs', '--all');
    if (dirty) {
      await writeFile(path.join(root, 'a.txt'), 'staged edit');
      await git(root, 'add', '--', 'a.txt');
      await writeFile(path.join(root, 'a.txt'), 'unstaged edit');
      await writeFile(path.join(root, 'notes.txt'), 'untracked edit');
    }
    const state = async () => ({
      head: await git(root, 'rev-parse', 'HEAD'), branch: await git(root, 'symbolic-ref', 'HEAD'),
      refs: await git(root, 'for-each-ref', '--format=%(refname) %(objectname)'),
      status: await git(root, 'status', '--porcelain=v1'), index: await git(root, 'ls-files', '--stage'),
      a: await readFile(path.join(root, 'a.txt'), 'utf8'), current: await readFile(path.join(root, 'new.txt'), 'utf8'),
      ...(dirty ? { notes: await readFile(path.join(root, 'notes.txt'), 'utf8') } : {}),
    });
    const before = await state();
    for (const name of ['test', 'test/b1', 'test/b1/nested']) {
      for (const checkout of [false, true]) {
        await expect(service.execute(repo, { type: 'branch.create', name, start: old, checkout })).rejects.toMatchObject({ code: 'BRANCH_EXISTS', message: expect.stringContaining('test/b1') });
        expect(await state()).toEqual(before);
      }
    }
  });

  it('does not touch the Index or Working Tree when an external branch creation races preflight', async () => {
    const { root, repo } = await setup();
    const old = await commit(root, 'a.txt', 'old');
    const current = await commit(root, 'a.txt', 'current');
    let raced = false;
    const service = new GitService({ environment: async (_repo, args) => {
      if (!raced && args[0] === 'branch' && args.includes('--no-track')) {
        raced = true;
        await git(root, 'branch', 'race/b1');
      }
      return {};
    } });
    await expect(service.execute(repo, { type: 'branch.create', name: 'race', start: old, checkout: true })).rejects.toThrow('cannot lock ref');
    expect(raced).toBe(true);
    expect(await service.snapshot(repo)).toMatchObject({ branch: 'main', head: current, changes: [] });
    expect(await git(root, 'show', ':a.txt')).toBe('current');
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('current');
    await expect(git(root, 'show-ref', '--verify', 'refs/heads/race')).rejects.toThrow();
  });

  it('retains a created branch and reports a blocked Checkout while preserving local edits', async () => {
    const { root, service, repo } = await setup();
    const old = await commit(root, 'a.txt', 'old');
    const current = await commit(root, 'a.txt', 'current');
    await writeFile(path.join(root, 'a.txt'), 'local edit');
    const before = await git(root, 'status', '--porcelain=v1');
    await expect(service.execute(repo, { type: 'branch.create', name: 'new-branch', start: old, checkout: true })).rejects.toMatchObject({
      code: 'CHECKOUT_BLOCKED', message: expect.stringContaining('created and retained'),
      details: { reason: 'local-changes', target: 'new-branch', paths: ['a.txt'], branchCreated: true },
    });
    expect(await service.snapshot(repo)).toMatchObject({ branch: 'main', head: current });
    expect(await git(root, 'rev-parse', 'refs/heads/new-branch')).toBe(old);
    expect(await git(root, 'status', '--porcelain=v1')).toBe(before);
    expect(await git(root, 'show', ':a.txt')).toBe('current');
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('local edit');
    await service.execute(repo, { type: 'checkout.stash', target: 'new-branch', includeUntracked: true });
    expect(await service.snapshot(repo)).toMatchObject({ branch: 'new-branch', head: old, changes: [] });
  });

  it('blocks direct Commit, Tag, Stash retry and implicit Detached Worktrees before any writes by default', async () => {
    const { root, service, repo } = await setup();
    const old = await commit(root, 'a.txt', 'old');
    const current = await commit(root, 'a.txt', 'current');
    await git(root, 'tag', 'old-version', old);
    await writeFile(path.join(root, 'a.txt'), 'local edit');
    await writeFile(path.join(root, 'new.txt'), 'untracked edit');
    const status = await git(root, 'status', '--porcelain=v1');
    const linked = path.join(root, 'detached-tree');
    for (const action of [
      { type: 'commit.checkout', target: old } as const,
      { type: 'commit.checkout', target: 'refs/tags/old-version' } as const,
      { type: 'checkout.stash', target: old, detached: true, includeUntracked: true } as const,
      { type: 'worktree.add', path: linked, detach: true } as const,
      { type: 'worktree.add', path: linked, start: old } as const,
    ]) await expect(service.execute(repo, action)).rejects.toMatchObject({ code: 'DETACHED_HEAD_DISABLED' });
    expect(await git(root, 'status', '--porcelain=v1')).toBe(status);
    expect(await git(root, 'show', ':a.txt')).toBe('current');
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('local edit');
    expect(await readFile(path.join(root, 'new.txt'), 'utf8')).toBe('untracked edit');
    expect(await service.snapshot(repo)).toMatchObject({ branch: 'main', head: current, stashes: [] });
    await expect(access(linked)).rejects.toThrow();
    await service.execute(repo, { type: 'branch.create', name: 'inspect-old', start: old, checkout: false });
    expect(await git(root, 'rev-parse', 'refs/heads/inspect-old')).toBe(old);
    await service.execute(repo, { type: 'checkout.stash', target: 'inspect-old', includeUntracked: true });
    expect(await service.snapshot(repo)).toMatchObject({ branch: 'inspect-old', head: old });
    expect(await git(root, 'rev-parse', 'refs/heads/main')).toBe(current);
  });

  it('rechecks permission after preflight and before creating a Stash', async () => {
    const { root, repo } = await setup();
    const old = await commit(root, 'a.txt', 'old');
    const current = await commit(root, 'a.txt', 'current');
    await writeFile(path.join(root, 'a.txt'), 'local edit');
    let allowed = true;
    const service = new GitService({ allowDetachedHead: () => allowed, environment: async (_repo, args) => {
      if (args[0] === 'status') allowed = false;
      return {};
    } });
    await expect(service.execute(repo, { type: 'checkout.stash', target: old, detached: true, includeUntracked: true })).rejects.toMatchObject({ code: 'DETACHED_HEAD_DISABLED' });
    expect(await service.snapshot(repo)).toMatchObject({ branch: 'main', head: current, stashes: [] });
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('local edit');
  });

  it('checks out a commit in Detached HEAD and returns to a local branch without moving its tip', async () => {
    const { root, repo } = await setup();
    let allowed = true;
    const service = new GitService({ allowDetachedHead: () => allowed });
    const first = await commit(root, 'a.txt', 'first');
    const second = await commit(root, 'a.txt', 'second');
    await service.execute(repo, { type: 'commit.checkout', target: first });
    expect(await service.snapshot(repo)).toMatchObject({ branch: '', head: first, unpushed: 0 });
    expect(await git(root, 'rev-parse', 'refs/heads/main')).toBe(second);
    allowed = false;
    await expect(service.execute(repo, { type: 'commit.checkout', target: second })).rejects.toMatchObject({ code: 'DETACHED_HEAD_DISABLED' });
    await service.execute(repo, { type: 'branch.checkout', name: 'main' });
    expect(await service.snapshot(repo)).toMatchObject({ branch: 'main', head: second });
  });

  it('reports overwritten files and retains the Stash after a later Checkout failure', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'same.txt', 'base');
    await git(root, 'switch', '-c', 'topic');
    await commit(root, 'same.txt', 'topic');
    await commit(root, 'collision.txt', 'tracked in topic');
    await git(root, 'switch', 'main');
    await writeFile(path.join(root, 'same.txt'), 'local edit');
    await expect(service.execute(repo, { type: 'branch.checkout', name: 'topic' })).rejects.toMatchObject({ code: 'CHECKOUT_BLOCKED', details: { reason: 'local-changes', paths: ['same.txt'], target: 'topic' } });
    await writeFile(path.join(root, 'collision.txt'), 'untracked edit');
    await expect(service.execute(repo, { type: 'checkout.stash', target: 'topic', includeUntracked: false })).rejects.toMatchObject({ code: 'CHECKOUT_BLOCKED', details: { paths: ['collision.txt'], stashCreated: true } });
    const snapshot = await service.snapshot(repo);
    expect(snapshot.branch).toBe('main');
    expect(snapshot.stashes).toHaveLength(1);
    expect((await service.content(repo, { kind: 'revision', revision: snapshot.stashes[0].oid, path: 'same.txt' })).toString()).toBe('local edit');
    expect(await readFile(path.join(root, 'collision.txt'), 'utf8')).toBe('untracked edit');
  });

  it('stashes tracked and untracked changes before switching and keeps the saved entry', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'same.txt', 'base');
    await git(root, 'branch', 'topic');
    await writeFile(path.join(root, 'same.txt'), 'edited');
    await writeFile(path.join(root, 'new.txt'), 'new file');
    await service.execute(repo, { type: 'checkout.stash', target: 'topic', includeUntracked: true });
    const snapshot = await service.snapshot(repo);
    expect(snapshot).toMatchObject({ branch: 'topic', changes: [] });
    expect(snapshot.stashes).toHaveLength(1);
    await service.execute(repo, { type: 'stash.apply', selector: snapshot.stashes[0].selector, expectedOid: snapshot.stashes[0].oid });
    expect(await readFile(path.join(root, 'same.txt'), 'utf8')).toBe('edited');
    expect(await readFile(path.join(root, 'new.txt'), 'utf8')).toBe('new file');
  });

  it('creates remote tracking branches in bulk without changing HEAD and preflights every local name', async () => {
    const { root, service, repo } = await setup();
    const base = await commit(root, 'a.txt', 'base');
    await git(root, 'remote', 'add', 'origin', path.join(root, 'unused.git'));
    for (const name of ['feature/a', 'feature/nested/b', 'feature/c']) await git(root, 'update-ref', `refs/remotes/origin/${name}`, base);
    const branches = ['feature/a', 'feature/nested/b'].map(name => ({ source: `refs/remotes/origin/${name}`, name, expectedOid: base }));
    await service.execute(repo, { type: 'branch.track', branches });
    expect(await service.snapshot(repo)).toMatchObject({ branch: 'main', head: base });
    for (const branch of branches) expect(await git(root, 'rev-parse', '--symbolic-full-name', `${branch.name}@{upstream}`)).toBe(branch.source);
    await git(root, 'switch', 'feature/a');
    const advanced = await commit(root, 'a.txt', 'local advancement');
    await git(root, 'switch', 'main');
    await service.execute(repo, { type: 'branch.track', branches });
    expect(await git(root, 'rev-parse', 'feature/a')).toBe(advanced);
    await git(root, 'branch', 'collision');
    await expect(service.execute(repo, { type: 'branch.track', branches: [{ source: 'refs/remotes/origin/feature/c', name: 'feature/c' }, { source: branches[0].source, name: 'collision' }] })).rejects.toMatchObject({ code: 'BRANCH_EXISTS' });
    await expect(git(root, 'show-ref', '--verify', 'refs/heads/feature/c')).rejects.toThrow();
    await expect(service.execute(repo, { type: 'branch.track', branches: [{ source: 'refs/remotes/origin/feature/c', name: 'feature/c' }, { source: branches[0].source, name: 'feature' }] })).rejects.toMatchObject({ code: 'BRANCH_EXISTS' });
    await expect(git(root, 'show-ref', '--verify', 'refs/heads/feature/c')).rejects.toThrow();
  });

  it('rejects stale, symbolic, missing and ambiguous remote references before creating tracking branches', async () => {
    const { root, service, repo } = await setup();
    const base = await commit(root, 'a.txt', 'base');
    for (const remote of ['origin', 'backup']) {
      await git(root, 'remote', 'add', remote, path.join(root, `${remote}.git`));
      await git(root, 'update-ref', `refs/remotes/${remote}/feature/a`, base);
    }
    await git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/feature/a');
    for (const source of ['refs/remotes/origin/HEAD', 'refs/remotes/origin/missing', 'origin/feature/a', 'refs/heads/main']) await expect(service.execute(repo, { type: 'branch.track', branches: [{ source, name: 'new-local' }] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(service.execute(repo, { type: 'branch.track', branches: [{ source: 'refs/remotes/origin/feature/a', name: 'new-local', expectedOid: '0'.repeat(40) }] })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
    await expect(service.execute(repo, { type: 'branch.track', branches: ['origin', 'backup'].map(remote => ({ source: `refs/remotes/${remote}/feature/a`, name: 'new-local' })) })).rejects.toMatchObject({ code: 'BRANCH_EXISTS' });
    await expect(git(root, 'show-ref', '--verify', 'refs/heads/new-local')).rejects.toThrow();
    await service.execute(repo, { type: 'branch.track', branches: [{ source: 'refs/remotes/backup/feature/a', name: 'new-local' }], checkout: true });
    expect(await service.snapshot(repo)).toMatchObject({ branch: 'new-local', upstream: 'backup/feature/a' });
  });

  it('keeps failed remote Checkout atomic and retries the original tracking action after Stash', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'same.txt', 'base');
    await git(root, 'branch', 'base');
    const remoteOid = await commit(root, 'same.txt', 'remote change');
    await git(root, 'remote', 'add', 'origin', path.join(root, 'unused.git'));
    await git(root, 'update-ref', 'refs/remotes/origin/feature/a', remoteOid);
    await git(root, 'switch', 'base');
    await writeFile(path.join(root, 'same.txt'), 'local edit');
    const branches = [{ source: 'refs/remotes/origin/feature/a', name: 'feature/a', expectedOid: remoteOid }];
    await expect(service.execute(repo, { type: 'branch.track', branches, checkout: true })).rejects.toMatchObject({ code: 'CHECKOUT_BLOCKED', details: { reason: 'local-changes', paths: ['same.txt'], target: 'feature/a', trackBranches: branches } });
    await expect(git(root, 'show-ref', '--verify', 'refs/heads/feature/a')).rejects.toThrow();
    expect(await readFile(path.join(root, 'same.txt'), 'utf8')).toBe('local edit');
    await service.execute(repo, { type: 'branch.track', branches, checkout: true, stashFirst: true });
    const snapshot = await service.snapshot(repo);
    expect(snapshot).toMatchObject({ branch: 'feature/a', upstream: 'origin/feature/a', changes: [] });
    expect(snapshot.stashes).toHaveLength(1);
    expect((await service.content(repo, { kind: 'revision', revision: snapshot.stashes[0].oid, path: 'same.txt' })).toString()).toBe('local edit');
    await service.execute(repo, { type: 'branch.checkout', name: 'base' });
    await service.execute(repo, { type: 'branch.track', branches, checkout: true });
    expect((await service.snapshot(repo)).branch).toBe('feature/a');
  });

  it('rejects Worktree occupancy before creating a Stash and disallows removing current or locked Worktrees', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'same.txt', 'base');
    const linked = path.join(root, 'linked');
    await service.execute(repo, { type: 'worktree.add', path: linked, newBranch: 'topic' });
    await writeFile(path.join(root, 'same.txt'), 'unsaved');
    const occupied = (await service.snapshot(repo)).worktrees.find(tree => tree.branch === 'topic')!;
    await expect(service.execute(repo, { type: 'checkout.stash', target: 'topic' })).rejects.toMatchObject({ code: 'WORKTREE_OCCUPIED', details: { worktreePath: occupied.path, target: 'topic' } });
    expect((await service.snapshot(repo)).stashes).toHaveLength(0);
    const child = await service.discover(linked);
    await expect(service.execute(child, { type: 'worktree.remove', path: linked })).rejects.toThrow('current Worktree');
    await git(root, 'worktree', 'lock', '--reason', 'mounted elsewhere', linked);
    await expect(service.execute(repo, { type: 'worktree.remove', path: linked, force: true })).rejects.toMatchObject({ code: 'WORKTREE_LOCKED' });
  });

  it('rejects a stale Stash selector before either Apply or Drop mutates the new entry', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'same.txt', 'base');
    await writeFile(path.join(root, 'same.txt'), 'first saved');
    await service.execute(repo, { type: 'stash.create' });
    const first = (await service.snapshot(repo)).stashes[0];
    await writeFile(path.join(root, 'same.txt'), 'second saved');
    await service.execute(repo, { type: 'stash.create' });
    for (const type of ['stash.apply', 'stash.drop'] as const) {
      await expect(service.execute(repo, { type, selector: first.selector, expectedOid: first.oid })).rejects.toMatchObject({ code: 'STASH_CHANGED' });
    }
    expect((await service.snapshot(repo)).stashes).toHaveLength(2);
    expect(await readFile(path.join(root, 'same.txt'), 'utf8')).toBe('base');
  });

  it('retains the captured Stash when Pop cannot apply without a conflict', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'same.txt', 'base');
    await writeFile(path.join(root, 'same.txt'), 'saved edit');
    await service.execute(repo, { type: 'stash.create' });
    const saved = (await service.snapshot(repo)).stashes[0];
    await commit(root, 'same.txt', 'new base');
    await expect(service.execute(repo, { type: 'stash.apply', selector: saved.selector, expectedOid: saved.oid, pop: true })).rejects.toThrow();
    expect((await service.snapshot(repo)).stashes).toEqual([saved]);
    expect((await service.snapshot(repo)).changes[0].conflict).toBe(true);
  });

  it('blocks a repeated untracked-file restore before mutation and keeps both copies', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'base.txt', 'base');
    await writeFile(path.join(root, 'notes.txt'), 'saved notes');
    await service.execute(repo, { type: 'stash.create', message: 'pause notes', includeUntracked: true });
    const saved = (await service.snapshot(repo)).stashes[0];
    await service.execute(repo, { type: 'stash.apply', selector: saved.selector, expectedOid: saved.oid });
    await writeFile(path.join(root, 'notes.txt'), 'continued notes');
    await expect(service.execute(repo, { type: 'stash.apply', selector: saved.selector, expectedOid: saved.oid, pop: true })).rejects.toMatchObject({
      code: 'STASH_UNTRACKED_CONFLICT',
      details: { kind: 'stash-apply', reason: 'untracked-path-exists', paths: ['notes.txt'], selector: saved.selector, stashOid: saved.oid, stashRetained: true, workingTreeUnchanged: true },
    });
    expect(await readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('continued notes');
    expect((await service.snapshot(repo)).stashes).toEqual([saved]);
  });

  it('reports unresolved conflict paths and blocks both Checkout and Stash & Checkout', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'same.txt', 'base');
    await git(root, 'switch', '-c', 'topic'); await commit(root, 'same.txt', 'topic');
    await git(root, 'switch', 'main'); await commit(root, 'same.txt', 'main');
    await expect(service.execute(repo, { type: 'merge', target: 'topic' })).rejects.toThrow();
    await expect(service.execute(repo, { type: 'branch.checkout', name: 'topic' })).rejects.toMatchObject({ code: 'CHECKOUT_BLOCKED', details: { reason: 'conflicts', paths: ['same.txt'] } });
    await expect(service.execute(repo, { type: 'checkout.stash', target: 'topic' })).rejects.toMatchObject({ code: 'CHECKOUT_BLOCKED', details: { reason: 'conflicts' } });
    await git(root, 'remote', 'add', 'origin', path.join(root, 'unused.git'));
    await git(root, 'update-ref', 'refs/remotes/origin/topic', await git(root, 'rev-parse', 'topic'));
    await expect(service.execute(repo, { type: 'branch.track', branches: [{ source: 'refs/remotes/origin/topic', name: 'tracked-topic' }], checkout: true, stashFirst: true })).rejects.toMatchObject({ code: 'CHECKOUT_BLOCKED', details: { reason: 'conflicts' } });
    await expect(git(root, 'show-ref', '--verify', 'refs/heads/tracked-topic')).rejects.toThrow();
    expect((await service.snapshot(repo)).stashes).toHaveLength(0);
  });

  it('keeps explicit empty history selection empty and bounds content reads', async () => {
    const { root, service, repo } = await setup();
    await writeFile(path.join(root, 'large.txt'), 'x'.repeat(300000));
    await git(root, 'add', '--', 'large.txt'); await git(root, 'commit', '-m', 'large file');
    expect((await service.history(repo, { tips: [] })).commits).toEqual([]);
    expect(await service.content(repo, { kind: 'revision', revision: 'HEAD', path: 'large.txt' }, 1024)).toHaveLength(1024);
    await git(root, 'remote', 'add', 'empty-remote', path.join(root, 'unfetched.git'));
    expect((await service.snapshot(repo)).remotes).toEqual(['empty-remote']);
  });

  it('unstages an unborn file edited after staging while preserving its working contents', async () => {
    const { root, service, repo } = await setup();
    await writeFile(path.join(root, 'changed.txt'), 'staged');
    await service.execute(repo, { type: 'stage', paths: ['changed.txt'] });
    await writeFile(path.join(root, 'changed.txt'), 'worktree');
    await service.execute(repo, { type: 'unstage', paths: ['changed.txt'] });
    expect(await readFile(path.join(root, 'changed.txt'), 'utf8')).toBe('worktree');
    expect(await service.content(repo, { kind: 'index', path: 'changed.txt' })).toEqual(Buffer.alloc(0));
    expect((await service.snapshot(repo)).changes[0].untracked).toBe(true);
  });

  it('ignores valid tree/blob tags in aggregate history while keeping annotated commit tags', async () => {
    const { root, service, repo } = await setup();
    const head = await commit(root, 'a.txt', 'a');
    const tree = await git(root, 'rev-parse', 'HEAD^{tree}');
    const blob = await git(root, 'rev-parse', 'HEAD:a.txt');
    await git(root, 'tag', 'tree-tag', tree);
    await git(root, 'tag', 'blob-tag', blob);
    await git(root, 'tag', '-a', 'commit-tag', '-m', 'annotated', head);
    await git(root, 'tag', '-a', 'annotated-tree', '-m', 'tree annotation', tree);
    await git(root, 'tag', '-a', 'nested-tree', '-m', 'nested tree annotation', 'annotated-tree');
    await git(root, 'tag', '-a', 'nested-commit', '-m', 'nested commit annotation', 'commit-tag');
    const snapshot = await service.snapshot(repo);
    expect(snapshot.refs.find(ref => ref.name === 'main')).toMatchObject({ targetType: 'commit', oid: head });
    expect(snapshot.refs.find(ref => ref.name === 'commit-tag')).toMatchObject({ targetType: 'commit', oid: head });
    expect(snapshot.refs.find(ref => ref.name === 'nested-commit')).toMatchObject({ targetType: 'commit', oid: head });
    expect(snapshot.refs.find(ref => ref.name === 'tree-tag')).toMatchObject({ targetType: 'tree', oid: tree });
    expect(snapshot.refs.find(ref => ref.name === 'blob-tag')).toMatchObject({ targetType: 'blob', oid: blob });
    expect(snapshot.refs.find(ref => ref.name === 'annotated-tree')).toMatchObject({ targetType: 'tree', oid: await git(root, 'rev-parse', 'refs/tags/annotated-tree') });
    expect(snapshot.refs.find(ref => ref.name === 'nested-tree')).toMatchObject({ targetType: 'tree', oid: await git(root, 'rev-parse', 'refs/tags/nested-tree') });
    const page = await service.history(repo);
    expect(page.commits.map(item => item.oid)).toEqual([head]);
    expect(page.tips).toEqual([head]);
    await expect(service.history(repo, { ref: 'refs/tags/blob-tag' })).rejects.toThrow();
  });

  it('pushes the requested branch when a tag has the same name', async () => {
    const { root, service, repo } = await setup();
    const head = await commit(root, 'a.txt', 'a');
    const bare = path.join(root, 'remote.git');
    await mkdir(bare);
    await git(bare, 'init', '--bare');
    await git(root, 'remote', 'add', 'origin', bare);
    await git(root, 'tag', 'main', head);
    await service.execute(repo, { type: 'push', remote: 'origin', branch: 'main' });
    expect(await git(bare, 'rev-parse', 'refs/heads/main')).toBe(head);
    expect(await git(bare, 'tag', '--list')).toBe('');
  });

  it('includes commits reachable only from a nested annotated tag', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'base.txt', 'base');
    await git(root, 'switch', '--detach');
    const tagged = await commit(root, 'tagged.txt', 'tag-only');
    await git(root, 'tag', '-a', 'inner', '-m', 'inner', tagged);
    await git(root, 'tag', '-a', 'outer', '-m', 'outer', 'inner');
    await git(root, 'tag', '-d', 'inner');
    await git(root, 'switch', 'main');
    const history = await service.history(repo);
    expect(history.commits.map(item => item.oid)).toContain(tagged);
  });

  it('recognizes a paused cherry-pick sequence after a conflict is committed manually', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'same.txt', 'base');
    await git(root, 'switch', '-c', 'topic');
    const first = await commit(root, 'same.txt', 'topic');
    const second = await commit(root, 'later.txt', 'later');
    await git(root, 'switch', 'main');
    await commit(root, 'same.txt', 'main');
    await expect(service.execute(repo, { type: 'cherry-pick', commits: [first, second] })).rejects.toThrow();
    await writeFile(path.join(root, 'same.txt'), 'resolved');
    await git(root, 'add', '--', 'same.txt');
    await git(root, 'commit', '-m', 'resolved');
    await expect(access(path.join(root, '.git', 'CHERRY_PICK_HEAD'))).rejects.toThrow();
    await access(path.join(root, '.git', 'sequencer', 'todo'));
    expect((await service.snapshot(repo)).operation).toMatchObject({ kind: 'cherry-pick', canContinue: true, canAbort: true });
    const review=await service.reviewOperation(repo);
    await service.execute(repo, { type: 'operation.continue', kind: 'cherry-pick', reviewToken:review.token });
    expect(await readFile(path.join(root, 'later.txt'), 'utf8')).toBe('later');
    expect((await service.snapshot(repo)).operation.kind).toBeUndefined();
  });

  it('stages and discards only selected literal special filenames', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'keep.txt', 'committed');
    const selected = '- odd [1] 你好.txt';
    await writeFile(path.join(root, selected), 'selected');
    await writeFile(path.join(root, '- odd 1 你好.txt'), 'neighbor');
    await service.execute(repo, { type: 'stage', paths: [selected] });
    const status = await service.snapshot(repo);
    expect(status.changes.find(item => item.path === selected)?.indexStatus).toBe('A');
    expect(status.changes.find(item => item.path === '- odd 1 你好.txt')?.untracked).toBe(true);
    await service.execute(repo, { type: 'unstage', paths: [selected] });
    await service.execute(repo, { type: 'discard', paths: [selected] });
    await expect(access(path.join(root, selected))).rejects.toThrow();
    expect(await readFile(path.join(root, '- odd 1 你好.txt'), 'utf8')).toBe('neighbor');
  });

  it('serializes mutations across service instances for linked worktrees sharing refs', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'base.txt', 'base');
    const linked = path.join(root, 'linked');
    await service.execute(repo, { type: 'worktree.add', path: linked, newBranch: 'linked' });
    const child = await service.discover(linked);
    await writeFile(path.join(root, 'main.txt'), 'main');
    await writeFile(path.join(linked, 'child.txt'), 'child');
    let active = 0;
    let maximum = 0;
    let mutations = 0;
    const options = {
      environment: async (_repo: typeof repo, args: readonly string[]) => {
        if (args[0] !== 'add') return {};
        active++;
        mutations++;
        maximum = Math.max(maximum, active);
        // Keep each mutation's environment active through process completion;
        // this deliberately exposes concurrent execution if commonDir locking breaks.
        await new Promise(resolve => setTimeout(resolve, 25));
        return { env: {}, dispose: () => { active--; } };
      },
    };
    const first = new GitService(options);
    const second = new GitService(options);
    await Promise.all([
      first.execute(repo, { type: 'stage', paths: ['main.txt'] }),
      second.execute(child, { type: 'stage', paths: ['child.txt'] }),
    ]);
    expect(mutations).toBe(2);
    expect(maximum).toBe(1);
    expect(active).toBe(0);
    expect((await first.content(repo, { kind: 'index', path: 'main.txt' })).toString()).toBe('main');
    expect((await second.content(child, { kind: 'index', path: 'child.txt' })).toString()).toBe('child');
  });
});
