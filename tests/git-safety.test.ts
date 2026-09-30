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
  it('checks out a commit in Detached HEAD and returns to a local branch without moving its tip', async () => {
    const { root, service, repo } = await setup();
    const first = await commit(root, 'a.txt', 'first');
    const second = await commit(root, 'a.txt', 'second');
    await service.execute(repo, { type: 'commit.checkout', target: first });
    expect(await service.snapshot(repo)).toMatchObject({ branch: '', head: first, unpushed: 0 });
    expect(await git(root, 'rev-parse', 'refs/heads/main')).toBe(second);
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

  it('reports unresolved conflict paths and blocks both Checkout and Stash & Checkout', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'same.txt', 'base');
    await git(root, 'switch', '-c', 'topic'); await commit(root, 'same.txt', 'topic');
    await git(root, 'switch', 'main'); await commit(root, 'same.txt', 'main');
    await expect(service.execute(repo, { type: 'merge', target: 'topic' })).rejects.toThrow();
    await expect(service.execute(repo, { type: 'branch.checkout', name: 'topic' })).rejects.toMatchObject({ code: 'CHECKOUT_BLOCKED', details: { reason: 'conflicts', paths: ['same.txt'] } });
    await expect(service.execute(repo, { type: 'checkout.stash', target: 'topic' })).rejects.toMatchObject({ code: 'CHECKOUT_BLOCKED', details: { reason: 'conflicts' } });
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
    await service.execute(repo, { type: 'operation.continue', kind: 'cherry-pick' });
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
