import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGitProcess } from '../src/git/runner';
import { GitService } from '../src/git/service';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

function processFixture(pid: number) {
  return Object.assign(new EventEmitter(), {
    pid, stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn(() => true),
  });
}
function completedProcess(output = '') {
  const child = processFixture(99);
  void Promise.resolve().then(() => { if (output) child.stdout.emit('data', Buffer.from(output)); child.emit('close', 0); });
  return child as unknown as ChildProcess;
}
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  vi.mocked(spawn).mockReset();
});
afterEach(() => { Object.defineProperty(process, 'platform', platform); vi.useRealTimers(); vi.restoreAllMocks(); });

function start(options: Partial<Parameters<typeof runGitProcess>[0]> = {}) {
  const git = processFixture(42), killer = processFixture(43);
  vi.mocked(spawn).mockReturnValueOnce(git as unknown as ChildProcess).mockReturnValueOnce(killer as unknown as ChildProcess);
  const settled = vi.fn();
  const result = runGitProcess({ args: ['status'], env: {}, timeoutMs: 100, ...options }).then(
    value => { settled(); return { value, error: undefined }; }, error => { settled(); return { value: undefined, error }; },
  );
  return { git, killer, settled, result };
}

describe('Git process termination', () => {
  it.each(['timeout', 'output limit', 'abort'] as const)('waits for both Git and taskkill after %s', async cause => {
    const controller = new AbortController();
    const { git, killer, result, settled } = start({ signal: controller.signal, maxOutputBytes: 1 });
    if (cause === 'timeout') await vi.advanceTimersByTimeAsync(100);
    else if (cause === 'output limit') git.stdout.emit('data', Buffer.from('too much output'));
    else controller.abort();
    expect(spawn).toHaveBeenLastCalledWith('taskkill', ['/PID', '42', '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
    git.emit('close', 1);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(git.stdout.destroyed).toBe(false);
    killer.emit('close', 0);
    expect((await result).error).toMatchObject({ code: cause === 'timeout' ? 'TIMEOUT' : cause === 'abort' ? 'ABORTED' : 'OUTPUT_LIMIT' });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('retains authentication until Git closes when taskkill finishes first', async () => {
    const git = processFixture(44), killer = processFixture(45), dispose = vi.fn(), cancelPrompts = vi.fn();
    vi.mocked(spawn).mockReturnValueOnce(git as unknown as ChildProcess).mockReturnValueOnce(killer as unknown as ChildProcess);
    const service = new GitService({ timeoutMs: 100, environment: async () => ({ env: {}, dispose, cancelPrompts }) });
    const result = service.discover(process.cwd()).catch(error => error);
    // discover resolves the root before the environment adapter and spawn.
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(100);
    expect(cancelPrompts).toHaveBeenCalledTimes(1);
    killer.emit('close', 0);
    await Promise.resolve();
    expect(dispose).not.toHaveBeenCalled();
    git.emit('close', 1);
    expect(await result).toMatchObject({ code: 'TIMEOUT' });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('allows a network command beyond the query deadline and stops at its host budget', async () => {
    const repo = { id: 'network-budget', name: 'test', root: process.cwd(), commonDir: `${process.cwd()}/runner-network-budget` };
    const git = processFixture(54), killer = processFixture(55), cancelPrompts = vi.fn();
    const service = new GitService({ environment: async () => ({ env: {}, cancelPrompts }) });
    vi.spyOn(service, 'discover').mockResolvedValue(repo);
    vi.mocked(spawn).mockImplementation(((executable: string, args: readonly string[]) => {
      if (executable === 'taskkill') return killer;
      return args.includes('fetch') ? git : completedProcess();
    }) as typeof spawn);
    const result = service.execute(repo, { type: 'fetch' }).catch(error => error);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(cancelPrompts).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalledWith('taskkill', expect.anything(), expect.anything());
    await vi.advanceTimersByTimeAsync(360_000);
    expect(cancelPrompts).toHaveBeenCalledTimes(1);
    killer.emit('close', 0); git.emit('close', 1);
    expect(await result).toMatchObject({ code: 'TIMEOUT' });
  });

  it('isolates later writes across service instances when taskkill fails', async () => {
    const git = processFixture(46), killer = processFixture(47), dispose = vi.fn();
    vi.mocked(spawn).mockImplementationOnce(() => completedProcess()).mockReturnValueOnce(git as unknown as ChildProcess).mockReturnValueOnce(killer as unknown as ChildProcess);
    const repo = { id: 'runner-test', name: 'test', root: process.cwd(), commonDir: `${process.cwd()}/runner-quarantine-test` };
    const first = new GitService({ timeoutMs: 100, environment: async () => ({ env: {}, dispose }) });
    const second = new GitService();
    vi.spyOn(first, 'discover').mockResolvedValue(repo);
    const verifySecond = vi.spyOn(second, 'discover').mockResolvedValue(repo);
    const result = first.execute(repo, { type: 'stage', paths: ['a.txt'] }).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    killer.emit('close', 5);
    expect(git.kill).toHaveBeenCalledWith('SIGKILL');
    expect(dispose).toHaveBeenCalledTimes(1); // Completed status; add still owns its environment.
    git.emit('close', 1);
    expect(await result).toMatchObject({ code: 'GIT_TERMINATION_UNCONFIRMED', terminationUnconfirmed: true, pid: 46 });
    await expect(second.execute(repo, { type: 'stage', paths: ['a.txt'] })).rejects.toMatchObject({ terminationUnconfirmed: true });
    expect(verifySecond).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it('preserves write isolation when a batch catches and wraps the termination error', async () => {
    const repo = { id: 'batch-test', name: 'test', root: process.cwd(), commonDir: `${process.cwd()}/runner-batch-test` };
    const service = new GitService({ timeoutMs: 100 }), git = processFixture(50), killer = processFixture(51);
    vi.spyOn(service, 'discover').mockResolvedValue(repo);
    vi.spyOn(service, 'snapshot').mockResolvedValue({ repository: repo, branch: 'main', ahead: 0, behind: 0, changes: [], refs: [], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 1 });
    vi.mocked(spawn).mockImplementation(((executable: string, args: readonly string[]) => {
      if (executable === 'taskkill') return killer;
      return args.includes('-d') ? git : completedProcess();
    }) as typeof spawn);
    const result = service.execute(repo, { type: 'branch.delete', names: ['one', 'two'] }).catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    killer.emit('close', 5); git.emit('close', 1);
    expect(await result).toMatchObject({ code: 'GIT_TERMINATION_UNCONFIRMED', terminationUnconfirmed: true, pid: 50 });
    const deletes = vi.mocked(spawn).mock.calls.filter(([, args]) => Array.isArray(args) && args.includes('-d'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0][1]).toContain('one');
  });

  it('cancels a read-only request without isolating subsequent writes', async () => {
    const repo = { id: 'read-test', name: 'test', root: process.cwd(), commonDir: `${process.cwd()}/runner-read-test` };
    const service = new GitService({ timeoutMs: 100 }), git = processFixture(52), killer = processFixture(53), controller = new AbortController();
    vi.spyOn(service, 'discover').mockResolvedValue(repo);
    let firstStatus = true;
    vi.mocked(spawn).mockImplementation(((executable: string, args: readonly string[]) => {
      if (executable === 'taskkill') return killer;
      if (args.includes('status') && firstStatus) { firstStatus = false; return git; }
      return completedProcess();
    }) as typeof spawn);
    const result = service.withReadSignal(controller.signal, () => service.repositoryStatus(repo)).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(); killer.emit('close', 5); git.emit('close', 1);
    const error = await result;
    expect(error).toMatchObject({ code: 'ABORTED', pid: 52 });
    expect(error.terminationUnconfirmed).not.toBe(true);
    await service.execute(repo, { type: 'stage', paths: ['a.txt'] });
    expect(vi.mocked(spawn).mock.calls.some(([, args]) => Array.isArray(args) && args.includes('add'))).toBe(true);
    await expect(service.withReadSignal(new AbortController().signal, () => service.execute(repo, { type: 'stage', paths: ['a.txt'] }))).rejects.toMatchObject({ code: 'WRITE_IN_READ_SCOPE' });
  });

  it('reports unconfirmed termination after the grace period without pretending Git exited', async () => {
    const { git, killer, result } = start();
    await vi.advanceTimersByTimeAsync(5100);
    expect((await result).error).toMatchObject({ code: 'GIT_TERMINATION_UNCONFIRMED', terminationUnconfirmed: true, pid: 42 });
    expect(git.stdout.destroyed).toBe(false);
    // Real handles may close later; this must not turn the failure into success.
    git.emit('close', 1); killer.emit('close', 0);
  });
});
