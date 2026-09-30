import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GitService, parseStatus, validateFilePath } from '../src/git/service';
const exec = promisify(execFile);
const roots: string[] = [];
const git = async (cwd: string, ...args: string[]) => (await exec('git', ['-C', cwd, ...args], { windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' } })).stdout.trim();
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-test-')); roots.push(root);
  await git(root, 'init', '-b', 'main'); await git(root, 'config', 'user.name', 'Test User'); await git(root, 'config', 'user.email', 'test@example.com'); await git(root, 'config', 'commit.gpgsign', 'false');
  const service = new GitService(); const repo = await service.discover(root); return { root, service, repo };
}
async function commit(root: string, name: string, text: string | Buffer, message = name) { await writeFile(path.join(root, name), text); await git(root, 'add', '--', name); await git(root, 'commit', '-m', message); return git(root, 'rev-parse', 'HEAD'); }
afterEach(async () => { for (const root of roots.splice(0)) { if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('alwaygit-test-')) throw new Error('Unsafe cleanup target'); await rm(root, { recursive: true, force: true, maxRetries: 5 }); } });
describe('Git service integration', () => {
  it('handles unborn status and binary index/revision content, literal pathspecs, and missing files', async () => {
    const { root, service, repo } = await setup();
    expect((await service.snapshot(repo)).head).toBeUndefined(); expect((await service.history(repo)).commits).toEqual([]);
    const bytes = Buffer.from([0, 255, 128, 10, 0, 1]); await writeFile(path.join(root, 'binary [1].bin'), bytes); await writeFile(path.join(root, 'binary 1.bin'), 'other');
    await service.execute(repo, { type: 'stage', paths: ['binary [1].bin'] }); expect(await service.content(repo, { kind: 'index', path: 'binary [1].bin' })).toEqual(bytes);
    expect((await service.snapshot(repo)).changes.find(x => x.path === 'binary 1.bin')?.untracked).toBe(true);
    await service.execute(repo, { type: 'unstage', paths: ['binary [1].bin'] }); expect(await service.content(repo, { kind: 'index', path: 'binary [1].bin' })).toEqual(Buffer.alloc(0));
    await service.execute(repo, { type: 'stage', paths: ['binary [1].bin'] }); await service.execute(repo, { type: 'commit', message: 'binary commit' });
    expect(await service.content(repo, { kind: 'revision', revision: 'HEAD', path: 'binary [1].bin' })).toEqual(bytes);
    expect(await service.content(repo, { kind: 'revision', revision: 'HEAD', path: 'missing.txt' })).toEqual(Buffer.alloc(0));
    await expect(service.content(repo, { kind: 'revision', revision: 'nonexistent-ref', path: 'missing.txt' })).rejects.toThrow();
    await rm(path.join(root, 'binary [1].bin')); await service.execute(repo, { type: 'stage', paths: ['binary [1].bin'] }); expect(await service.content(repo, { kind: 'index', path: 'binary [1].bin' })).toEqual(Buffer.alloc(0));
  });
  it('preserves rename paths and discards selected tracked and untracked files', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'old name.txt', 'original');
    await rename(path.join(root, 'old name.txt'), path.join(root, 'new name.txt')); await git(root, 'add', '-A');
    const change = (await service.snapshot(repo)).changes[0]; expect(change).toMatchObject({ path: 'new name.txt', originalPath: 'old name.txt', indexStatus: 'R' });
    await service.execute(repo, { type: 'commit', message: 'rename' }); expect((await service.details(repo, 'HEAD')).files[0]).toMatchObject({ path: 'new name.txt', previousPath: 'old name.txt' });
    await writeFile(path.join(root, 'new name.txt'), 'edited'); await writeFile(path.join(root, 'remove.txt'), 'discard'); await writeFile(path.join(root, 'keep.txt'), 'keep');
    await service.execute(repo, { type: 'discard', paths: ['new name.txt', 'remove.txt'] }); expect(await readFile(path.join(root, 'new name.txt'), 'utf8')).toBe('original'); expect(await readFile(path.join(root, 'keep.txt'), 'utf8')).toBe('keep'); await expect(readFile(path.join(root, 'remove.txt'))).rejects.toThrow();
  });
  it('unstages both paths of a staged rename while preserving the working rename', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'old [1].txt', 'original'); await commit(root, 'keep.txt', 'base');
    await rename(path.join(root, 'old [1].txt'), path.join(root, 'new [1].txt')); await git(root, 'add', '-A'); await writeFile(path.join(root, 'keep.txt'), 'staged'); await service.execute(repo, { type: 'stage', paths: ['keep.txt'] });
    expect((await service.snapshot(repo)).changes.find(change => change.path === 'new [1].txt')).toMatchObject({ indexStatus: 'R', originalPath: 'old [1].txt' });
    await service.execute(repo, { type: 'unstage', paths: ['new [1].txt'] });
    const changes = (await service.snapshot(repo)).changes;
    expect(changes.find(change => change.path === 'old [1].txt')).toMatchObject({ indexStatus: ' ', worktreeStatus: 'D' }); expect(changes.find(change => change.path === 'new [1].txt')).toMatchObject({ untracked: true }); expect(changes.find(change => change.path === 'keep.txt')).toMatchObject({ indexStatus: 'M', worktreeStatus: ' ' });
    expect((await service.content(repo, { kind: 'revision', revision: 'HEAD', path: 'old [1].txt' })).toString()).toBe('original'); expect((await service.content(repo, { kind: 'index', path: 'old [1].txt' })).toString()).toBe('original'); expect(await readFile(path.join(root, 'new [1].txt'), 'utf8')).toBe('original'); await expect(readFile(path.join(root, 'old [1].txt'))).rejects.toThrow();
  });
  it('discards a detected worktree rename while keeping staged content', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'old [1].txt', 'HEAD content'); await commit(root, 'neighbor.txt', 'base');
    await writeFile(path.join(root, '.git', 'info', 'exclude'), 'new*.txt\n'); await writeFile(path.join(root, 'old [1].txt'), 'staged content'); await service.execute(repo, { type: 'stage', paths: ['old [1].txt'] }); await rename(path.join(root, 'old [1].txt'), path.join(root, 'new [1].txt')); await git(root, 'add', '-N', '-f', '--', 'new [1].txt'); await writeFile(path.join(root, 'new 1.txt'), 'untouched');
    const renameChange = (await service.snapshot(repo)).changes.find(change => change.path === 'new [1].txt'); expect(renameChange).toMatchObject({ worktreeStatus: 'R', originalPath: 'old [1].txt' });
    await service.execute(repo, { type: 'discard', paths: ['new [1].txt'] });
    expect(await readFile(path.join(root, 'old [1].txt'), 'utf8')).toBe('staged content'); await expect(readFile(path.join(root, 'new [1].txt'))).rejects.toThrow(); expect(await readFile(path.join(root, 'new 1.txt'), 'utf8')).toBe('untouched');
    expect((await service.content(repo, { kind: 'index', path: 'old [1].txt' })).toString()).toBe('staged content'); expect((await service.content(repo, { kind: 'revision', revision: 'HEAD', path: 'old [1].txt' })).toString()).toBe('HEAD content'); expect((await service.snapshot(repo)).changes.find(change => change.path === 'old [1].txt')).toMatchObject({ indexStatus: 'M', worktreeStatus: ' ' });
  });
  it('stages both paths when selecting a detected worktree rename destination', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'old.txt', 'original'); await rename(path.join(root, 'old.txt'), path.join(root, 'new.txt')); await git(root, 'add', '-N', '--', 'new.txt');
    expect((await service.snapshot(repo)).changes.find(change => change.path === 'new.txt')).toMatchObject({ worktreeStatus: 'R', originalPath: 'old.txt' }); await service.execute(repo, { type: 'stage', paths: ['new.txt'] });
    expect((await service.snapshot(repo)).changes).toEqual([expect.objectContaining({ path: 'new.txt', indexStatus: 'R', worktreeStatus: ' ', originalPath: 'old.txt' })]); expect(await service.content(repo, { kind: 'index', path: 'old.txt' })).toEqual(Buffer.alloc(0)); expect((await service.content(repo, { kind: 'index', path: 'new.txt' })).toString()).toBe('original');
  });
  it('keeps history pagination fixed to captured tips as branches advance and selects merge parents', async () => {
    const { root, service, repo } = await setup(); const first = await commit(root, 'root.txt', 'one', 'root');
    await service.execute(repo, { type: 'branch.create', name: 'topic', checkout: true }); const side = await commit(root, 'side.txt', 'side', 'side');
    await service.execute(repo, { type: 'branch.checkout', name: 'main' }); const main = await commit(root, 'main.txt', 'main', 'main'); await service.execute(repo, { type: 'merge', target: 'topic' });
    const merge = await git(root, 'rev-parse', 'HEAD'); const page = await service.history(repo, { limit: 2 }); expect(page.hasMore).toBe(true); expect(page.commits[0].oid).toBe(merge);
    await commit(root, 'later.txt', 'later', 'later'); const second = await service.history(repo, { limit: 2, offset: page.nextOffset, tips: page.tips }); const combined = [...page.commits, ...second.commits].map(x => x.oid); expect(new Set(combined).size).toBe(4); expect(combined).toContain(first); expect(second.hasMore).toBe(false);
    const detail = await service.details(repo, merge, side); expect(detail.parent).toBe(side); expect(detail.files.map(x => x.path)).toEqual(['main.txt']); await expect(service.details(repo, merge, first)).rejects.toThrow('not a parent');
    const mainDetail = await service.details(repo, merge, main); expect(mainDetail.files.map(x => x.path)).toEqual(['side.txt']);
  });
  it('compares arbitrary commits and normalizes ancestor direction',async()=>{
    const {root,service,repo}=await setup();await writeFile(path.join(root,'old.txt'),'common\nbefore');const base=await commit(root,'old.txt','common\nbefore','base');
    await rename(path.join(root,'old.txt'),path.join(root,'new.txt'));await writeFile(path.join(root,'new.txt'),'common\nafter');await git(root,'add','-A');await git(root,'commit','-m','rename and edit');const latest=await git(root,'rev-parse','HEAD');
    const comparison=await service.compare(repo,latest,base);
    expect(comparison.left.oid).toBe(base);expect(comparison.right.oid).toBe(latest);expect(comparison.files).toEqual([{status:expect.stringMatching(/^R/),previousPath:'old.txt',path:'new.txt'}]);
    const reversed=await service.compare(repo,latest,base,true);expect(reversed.left.oid).toBe(latest);expect(reversed.right.oid).toBe(base);
  });
  it('reports conflicts, index stages, operation controls and aborts merge', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'same.txt', 'base'); await service.execute(repo, { type: 'branch.create', name: 'topic', checkout: true }); await commit(root, 'same.txt', 'topic'); await service.execute(repo, { type: 'branch.checkout', name: 'main' }); await commit(root, 'same.txt', 'main');
    await expect(service.execute(repo, { type: 'merge', target: 'topic' })).rejects.toThrow(); const snap = await service.snapshot(repo); expect(snap.operation).toMatchObject({ kind: 'merge', conflicts: 1, canContinue: false, canAbort: true, canSkip: false }); expect(snap.changes[0].conflict).toBe(true);
    expect((await service.content(repo, { kind: 'index', path: 'same.txt', stage: 1 })).toString()).toBe('base'); expect((await service.content(repo, { kind: 'index', path: 'same.txt', stage: 2 })).toString()).toBe('main'); expect((await service.content(repo, { kind: 'index', path: 'same.txt', stage: 3 })).toString()).toBe('topic');
    await expect(service.execute(repo, { type: 'operation.continue', kind: 'merge' })).rejects.toThrow('Resolve conflicts'); await service.execute(repo, { type: 'operation.abort', kind: 'merge' }); expect((await service.snapshot(repo)).operation.kind).toBeUndefined();
  });
  it('implements branches, tags, stashes, reset, amend, cherry-pick, revert and rebase', async () => {
    const { root, service, repo } = await setup(); const base = await commit(root, 'base.txt', 'base');
    await service.execute(repo, { type: 'branch.create', name: 'topic', checkout: true }); const picked = await commit(root, 'picked.txt', 'pick'); await service.execute(repo, { type: 'branch.checkout', name: 'main' }); await commit(root, 'main.txt', 'main');
    await expect(service.execute(repo,{type:'cherry-pick',commits:[picked],expectedHead:'0'.repeat(40),expectedBranch:'main'})).rejects.toThrow('target branch changed');
    await service.execute(repo, { type: 'cherry-pick', commits: [picked], expectedHead: await git(root,'rev-parse','HEAD'), expectedBranch:'main' }); expect(await readFile(path.join(root, 'picked.txt'), 'utf8')).toBe('pick'); await service.execute(repo, { type: 'revert', commits: ['HEAD'] }); await expect(readFile(path.join(root, 'picked.txt'))).rejects.toThrow();
    await service.execute(repo, { type: 'tag.create', name: 'v1', message: 'release' }); expect((await service.snapshot(repo)).refs.find(x => x.kind === 'tag' && x.name === 'v1')?.oid).toBe(await git(root, 'rev-parse', 'HEAD')); await service.execute(repo, { type: 'tag.delete', name: 'v1' });
    await writeFile(path.join(root, 'base.txt'), 'stash'); await service.execute(repo, { type: 'stash.create', message: 'saved' }); expect((await service.snapshot(repo)).stashes).toHaveLength(1); await service.execute(repo, { type: 'stash.apply', selector: 'stash@{0}' }); expect(await readFile(path.join(root, 'base.txt'), 'utf8')).toBe('stash'); await service.execute(repo, { type: 'stash.drop', selector: 'stash@{0}' });
    await service.execute(repo, { type: 'reset', mode: 'hard', target: base }); await service.execute(repo, { type: 'commit', message: 'amended base', amend: true }); expect((await service.details(repo, 'HEAD')).commit.subject).toBe('amended base');
    await service.execute(repo, { type: 'branch.checkout', name: 'topic' }); await service.execute(repo, { type: 'rebase', target: 'main' }); expect((await service.snapshot(repo)).operation.kind).toBeUndefined(); await service.execute(repo, { type: 'branch.checkout', name: 'main' }); await service.execute(repo, { type: 'branch.delete', name: 'topic', force: true });
  });
  it('shares commonDir across linked worktrees and only removes registered linked worktrees', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'a.txt', 'a'); const linked = path.join(root, 'linked');
    await service.execute(repo, { type: 'worktree.add', path: linked, newBranch: 'linked-branch' }); const child = await service.discover(linked); expect(child.commonDir).toBe(repo.commonDir); expect(child.id).not.toBe(repo.id); expect((await service.snapshot(repo)).worktrees).toHaveLength(2);
    await expect(service.execute(repo, { type: 'worktree.remove', path: root, force: true })).rejects.toThrow('Only registered'); await expect(service.execute(repo, { type: 'worktree.remove', path: os.tmpdir(), force: true })).rejects.toThrow('Only registered');
    await service.execute(repo, { type: 'worktree.remove', path: linked }); expect((await service.snapshot(repo)).worktrees).toHaveLength(1);
  });
  it('fetches, pushes and pulls from a local bare remote with upstream tracking', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'a.txt', 'a'); const bare = path.join(root, 'remote.git'); await mkdir(bare); await git(bare, 'init', '--bare'); await git(root, 'remote', 'add', 'origin', bare); await service.execute(repo, { type: 'push', branch: 'main' });
    await commit(root, 'b.txt', 'b'); expect(await service.snapshot(repo)).toMatchObject({ ahead: 1, unpushed: 1 }); expect(await service.repositoryStatus(repo)).toMatchObject({ repositoryId: repo.id, branch: 'main', upstream: 'origin/main', ahead: 1, unpushed: 1 });
    const beforePush = await service.history(repo, { tips: ['HEAD'] });
    expect(beforePush.commits.slice(0, 2).map(item => item.pushed)).toEqual([false, true]);
    await service.execute(repo, { type: 'push' }); expect((await service.snapshot(repo)).ahead).toBe(0);
    expect((await service.history(repo, { tips: ['HEAD'] })).commits.every(item => item.pushed)).toBe(true);
    await service.execute(repo, { type: 'fetch', remote: 'origin' }); await service.execute(repo, { type: 'pull', strategy: 'ff-only' });
    const snapshot = await service.snapshot(repo); expect(snapshot.upstream).toBe('origin/main'); expect(snapshot.refs.some(x => x.name === 'origin/main')).toBe(true); expect(snapshot.pushTarget).toEqual({ localBranch: 'main', remote: 'origin', remoteBranch: 'main', configured: true });
    await service.execute(repo, { type: 'branch.create', name: 'tracked', start: 'refs/remotes/origin/main', checkout: true }); expect((await service.snapshot(repo)).upstream).toBe('origin/main');
    await commit(root, 'tracked.txt', 'tracked'); await service.execute(repo, { type: 'push', remote: 'origin', branch: 'tracked', remoteBranch: 'release/tracked', setUpstream: true });
    expect(await git(bare, 'rev-parse', 'refs/heads/release/tracked')).toBe(await git(root, 'rev-parse', 'HEAD'));
    expect((await service.snapshot(repo)).pushTarget).toEqual({ localBranch: 'tracked', remote: 'origin', remoteBranch: 'release/tracked', configured: true });
  });
  it('serializes writes across service instances sharing a common directory', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'a.txt', 'base'); const linked = path.join(root, 'linked'); await service.execute(repo, { type: 'worktree.add', path: linked, newBranch: 'linked' }); const other = await service.discover(linked);
    await writeFile(path.join(root, 'a.txt'), 'main content'); await writeFile(path.join(linked, 'a.txt'), 'linked content');
    let release!: () => void; let enter!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { enter = resolve; }); let otherCalls = 0;
    const first = new GitService({ environment: async (_repo, args) => { if (args[0] === 'add') { enter(); await blocked; } return {}; } }); const second = new GitService({ environment: async () => { otherCalls++; return {}; } });
    const firstWrite = first.execute(repo, { type: 'stage', paths: ['a.txt'] }); await entered; const otherWrite = second.execute(other, { type: 'stage', paths: ['a.txt'] });
    await new Promise(resolve => setTimeout(resolve, 100)); expect(otherCalls).toBe(0); release(); await Promise.all([firstWrite, otherWrite]);
    expect((await service.content(repo, { kind: 'index', path: 'a.txt' })).toString()).toBe('main content'); expect((await service.content(other, { kind: 'index', path: 'a.txt' })).toString()).toBe('linked content');
  });
  it('rejects path traversal/options and surfaces external locks, hooks, and bounded output failures', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'a.txt', 'a');
    for (const file of ['../outside', 'C:\\outside', '/outside', '.git/config', 'dir/../../out', '.']) expect(() => validateFilePath(file)).toThrow();
    await expect(service.execute(repo, { type: 'branch.create', name: '--bad' })).rejects.toThrow(); await expect(service.execute(repo, { type: 'merge', target: '--help' })).rejects.toThrow();
    await writeFile(path.join(root, '.git', 'index.lock'), ''); await writeFile(path.join(root, 'a.txt'), 'edited'); await expect(service.execute(repo, { type: 'stage', paths: ['a.txt'] })).rejects.toThrow('Another Git process'); await rm(path.join(root, '.git', 'index.lock'));
    await service.execute(repo, { type: 'stage', paths: ['a.txt'] }); await writeFile(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho rejected-by-test-hook >&2\nexit 1\n'); await expect(service.execute(repo, { type: 'commit', message: 'blocked' })).rejects.toThrow('rejected-by-test-hook');
    await writeFile(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nsleep 10\n'); let calls = 0; let disposed = 0;
    const bounded = new GitService({ timeoutMs: 1500, environment: async () => { calls++; return { env: {}, dispose: () => { disposed++; } }; } });
    const started = Date.now(); await expect(bounded.execute(repo, { type: 'commit', message: 'timeout' })).rejects.toMatchObject({ code: 'TIMEOUT' }); expect(Date.now() - started).toBeLessThan(7000); expect(disposed).toBe(calls);
    const limited = new GitService({ maxOutputBytes: 1 }); await expect(limited.snapshot(repo)).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
  });
  it('parses porcelain records with embedded whitespace and two-path renames', () => {
    const parsed = parseStatus(Buffer.from(['# branch.oid (initial)', '# branch.head main', '2 R. N... 100644 100644 100644 abc abc R100 new\tname', 'old\nname', 'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict file', ''].join('\0')));
    expect(parsed.changes[0]).toMatchObject({ path: 'new\tname', originalPath: 'old\nname' }); expect(parsed.changes[1]).toMatchObject({ path: 'conflict file', conflict: true });
    expect(() => parseStatus(Buffer.concat([Buffer.from('? invalid-'), Buffer.from([255]), Buffer.from('\0')]))).toThrow('invalid UTF-8');
  });
});
