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
    const git = processFixture(44), killer = processFixture(45), dispose = vi.fn();
    vi.mocked(spawn).mockReturnValueOnce(git as unknown as ChildProcess).mockReturnValueOnce(killer as unknown as ChildProcess);
    const service = new GitService({ timeoutMs: 100, environment: async () => ({ env: {}, dispose }) });
    const result = service.discover(process.cwd()).catch(error => error);
    // discover resolves the root before the environment adapter and spawn.
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(100);
    killer.emit('close', 0);
    await Promise.resolve();
    expect(dispose).not.toHaveBeenCalled();
    git.emit('close', 1);
    expect(await result).toMatchObject({ code: 'TIMEOUT' });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('isolates later writes across service instances when taskkill fails', async () => {
    const git = processFixture(46), killer = processFixture(47), dispose = vi.fn();
    vi.mocked(spawn).mockReturnValueOnce(git as unknown as ChildProcess).mockReturnValueOnce(killer as unknown as ChildProcess);
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
    expect(dispose).not.toHaveBeenCalled();
    git.emit('close', 1);
    expect(await result).toMatchObject({ code: 'GIT_TERMINATION_UNCONFIRMED', terminationUnconfirmed: true, pid: 46 });
    await expect(second.execute(repo, { type: 'stage', paths: ['a.txt'] })).rejects.toMatchObject({ terminationUnconfirmed: true });
    expect(verifySecond).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(2);
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
