import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RepositoryOperationLock, RepositoryOperationRecoveryRequiredError } from '../src/application/operation-lock';
import { ProjectWindows } from '../src/extension/project-windows';
import { Workbench } from '../src/extension/workbench';

vi.mock('vscode', () => ({
  EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
  workspace: { isTrusted: true, workspaceFolders: [], getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }), onDidChangeConfiguration: () => ({ dispose() {} }) },
  env: { appRoot: 'test', language: 'en' }, window: { showWarningMessage: vi.fn() },
}));
vi.mock('../src/application/confirm', () => ({ confirmAction: async () => true }));

const roots: string[] = [], locks: RepositoryOperationLock[] = [], workbenches: Workbench[] = [];
afterEach(async () => {
  for (const workbench of workbenches.splice(0)) workbench.dispose();
  await Promise.all(locks.splice(0).map(lock => lock.close()));
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('alwaygit-lifecycle-')) throw new Error('Unsafe test cleanup target');
    await rm(root, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});
function context() { return { globalStorageUri: { toString: () => 'test' }, workspaceState: { get: (_key: string, fallback: unknown) => fallback } } as unknown as vscode.ExtensionContext; }
const output = () => ({ appendLine: vi.fn() });
async function projectWindows(broadcast = vi.fn(async () => {})) {
  const root = await mkdtemp(path.join(tmpdir(), 'alwaygit-lifecycle-')); roots.push(root);
  const lock = new RepositoryOperationLock(path.join(root, 'locks'), 'test'); locks.push(lock);
  const projects = new ProjectWindows(context(), output() as never, {} as never, {} as never, async () => {});
  Object.assign(projects, { operationLock: lock, bridge: { broadcast } });
  return { projects, root, lock, broadcast };
}
function workbench(projects: object) {
  const repo = { id: 'repo', root: path.resolve('repo'), commonDir: path.resolve('repo/.git'), name: 'repo' };
  const repositories = { list: () => [repo], get: () => repo, onDidChange: () => ({ dispose() {} }), onDidChangeRepositories: () => ({ dispose() {} }) };
  const git = { execute: vi.fn(async () => {}), snapshot: vi.fn(async () => ({ repository: repo })) };
  const value = new Workbench(context(), git as never, repositories as never, {} as never, output() as never, projects as never); workbenches.push(value);
  return { value, repo, git };
}
const action = { id: 'action', method: 'action', repoId: 'repo', payload: { type: 'fetch' } } as const;

describe('repository operation lifecycle', () => {
  it('releases the lease even when both activity broadcasts fail', async () => {
    const { projects, root } = await projectWindows(vi.fn(async () => { throw new Error('registry unavailable'); }));
    const task = vi.fn(async () => 'done');
    expect(await projects.runRepositoryOperation(root, 'fetch', task)).toBe('done');
    expect(task).toHaveBeenCalledOnce();
    expect(await projects.isRepositoryBusy(root)).toBe(false);
    expect(await projects.runRepositoryOperation(root, 'fetch', async () => 'again')).toBe('again');
  });
  it('keeps protection when process-tree termination is unconfirmed', async () => {
    const { projects, root, lock, broadcast } = await projectWindows();
    const error = Object.assign(new Error('unknown Git tree'), { terminationUnconfirmed: true, pid: process.pid });
    await expect(projects.runRepositoryOperation(root, 'pull', async () => { throw error; })).rejects.toBe(error);
    expect(await projects.isRepositoryBusy(root)).toBe(true);
    expect(broadcast).not.toHaveBeenCalledWith(expect.objectContaining({ busy: false }));
    await lock.close();
    await expect(projects.runRepositoryOperation(root, 'pull', async () => {})).rejects.toThrow('closed');
  });
  it('reconciles a missed finish event before allowing a new action', async () => {
    const projects = { isRepositoryBusy: vi.fn(async () => false), runRepositoryOperation: vi.fn(async (_key: string, _label: string, task: () => Promise<unknown>) => task()) };
    const { value, repo, git } = workbench(projects);
    value.externalRepositoryActivity(repo.commonDir, true, 'pull');
    await value.handle(action);
    expect(projects.isRepositoryBusy).toHaveBeenCalledWith(repo.commonDir);
    expect(git.execute).toHaveBeenCalledOnce();
  });
  it('does not clear a newer busy event while reconciling an older event', async () => {
    let resolve!: (busy: boolean) => void;
    const projects = { isRepositoryBusy: vi.fn(() => new Promise<boolean>(done => { resolve = done; })), runRepositoryOperation: vi.fn() };
    const { value, repo, git } = workbench(projects);
    value.externalRepositoryActivity(repo.commonDir, true, 'old');
    const pending = value.handle(action);
    value.externalRepositoryActivity(repo.commonDir, true, 'new'); resolve(false);
    await expect(pending).rejects.toThrow('already running');
    expect(git.execute).not.toHaveBeenCalled();
  });
  it('offers explicit recovery and requires a retry instead of replaying the write', async () => {
    const projects = { runRepositoryOperation: vi.fn(async () => { throw new RepositoryOperationRecoveryRequiredError('captured-token', 'pull'); }), recoverRepositoryOperation: vi.fn(async () => {}) };
    const { value, repo, git } = workbench(projects);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Remove protection' as never);
    await expect(value.handle(action)).rejects.toThrow('retry');
    expect(projects.recoverRepositoryOperation).toHaveBeenCalledWith(repo.commonDir, 'captured-token');
    expect(git.execute).not.toHaveBeenCalled();
    expect(projects.runRepositoryOperation).toHaveBeenCalledOnce();
  });
});
