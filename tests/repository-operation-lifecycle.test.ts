import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  RepositoryOperationLock,
  RepositoryOperationRecoveryRequiredError,
} from '../src/application/operation-lock';
import { ProjectWindows } from '../src/extension/project-windows';
import { Workbench } from '../src/extension/workbench';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  },
  workspace: {
    isTrusted: true,
    workspaceFolders: [],
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  env: { appRoot: 'test', language: 'en' },
  window: { showWarningMessage: vi.fn() },
  commands: { executeCommand: vi.fn(async () => {}) },
}));
vi.mock('../src/application/confirm', () => ({ confirmAction: async () => true }));

const roots: string[] = [],
  locks: RepositoryOperationLock[] = [],
  workbenches: Workbench[] = [];
afterEach(async () => {
  for (const workbench of workbenches.splice(0)) workbench.dispose();
  await Promise.all(locks.splice(0).map((lock) => lock.close()));
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith('alwaygit-lifecycle-')
    )
      throw new Error('Unsafe test cleanup target');
    await rm(root, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});
function context() {
  return {
    globalStorageUri: { toString: () => 'test' },
    workspaceState: { get: (_key: string, fallback: unknown) => fallback },
  } as unknown as vscode.ExtensionContext;
}
const output = () => ({ appendLine: vi.fn() });
async function projectWindows(broadcast = vi.fn(async () => {})) {
  const root = await mkdtemp(path.join(tmpdir(), 'alwaygit-lifecycle-'));
  roots.push(root);
  const lock = new RepositoryOperationLock(path.join(root, 'locks'), 'test');
  locks.push(lock);
  const legacy = new RepositoryOperationLock(path.join(root, 'legacy-locks'), 'test');
  locks.push(legacy);
  const projects = Object.create(ProjectWindows.prototype) as ProjectWindows;
  Object.assign(projects, {
    operationLock: lock,
    legacyOperationLock: legacy,
    log: output(),
    bridge: { broadcast },
  });
  return { projects, root, lock, legacy, broadcast };
}
function workbench(projects: object) {
  const repo = {
    id: 'repo',
    root: path.resolve('repo'),
    commonDir: path.resolve('repo/.git'),
    name: 'repo',
  };
  const repositories = {
    list: () => [repo],
    get: () => repo,
    onDidChange: () => ({ dispose() {} }),
    onDidChangeRepositories: () => ({ dispose() {} }),
  };
  const git = {
    execute: vi.fn(async () => {}),
    snapshot: vi.fn(async () => ({ repository: repo })),
  };
  const value = new Workbench(
    context(),
    git as never,
    repositories as never,
    { releaseDiffOwner: vi.fn() } as never,
    output() as never,
    projects as never,
  );
  workbenches.push(value);
  return { value, repo, git };
}
const action = {
  id: 'action',
  method: 'action',
  repoId: 'repo',
  payload: { type: 'fetch' },
} as const;

describe('repository operation lifecycle', () => {
  it('respects live legacy owners, releases the shared lease on failure and advertises new operations to old hosts', async () => {
    const { projects, root, lock, legacy, broadcast } = await projectWindows();
    const old = new RepositoryOperationLock(path.join(root, 'legacy-locks'), 'old');
    locks.push(old);
    const occupied = await old.acquire(root, 'old-fetch');
    expect(await projects.isRepositoryBusy(root)).toBe(true);
    const task = vi.fn(async () => {});
    await expect(projects.runRepositoryOperation(root, 'pull', task)).rejects.toThrow(
      'already running',
    );
    expect(task).not.toHaveBeenCalled();
    expect(await lock.isBusy(root)).toBe(false);
    expect(broadcast).not.toHaveBeenCalled();
    await occupied.release();
    await projects.runRepositoryOperation(root, 'pull', async () => {
      expect(await old.isBusy(root)).toBe(true);
      await expect(old.acquire(root, 'old-push')).rejects.toThrow('already running');
    });
    expect(await lock.isBusy(root)).toBe(false);
    expect(await legacy.isBusy(root)).toBe(false);
  });
  it('does not start Git and releases both leases when the legacy running marker cannot be persisted', async () => {
    const { projects, root, lock, legacy } = await projectWindows();
    const acquire = legacy.acquire.bind(legacy);
    vi.spyOn(legacy, 'acquire').mockImplementationOnce(async (...args) => {
      const lease = await acquire(...args);
      return {
        ...lease,
        markRunning: async () => {
          throw new Error('legacy disk full');
        },
      };
    });
    const task = vi.fn(async () => {});
    await expect(projects.runRepositoryOperation(root, 'pull', task)).rejects.toThrow(
      'legacy disk full',
    );
    expect(task).not.toHaveBeenCalled();
    expect(await lock.isBusy(root)).toBe(false);
    expect(await legacy.isBusy(root)).toBe(false);
    await expect(projects.runRepositoryOperation(root, 'pull', async () => 'retry')).resolves.toBe(
      'retry',
    );
  });
  it.each(['legacy', 'both'] as const)(
    'recovers interrupted %s records by token without bypassing protection',
    async (mode) => {
      const { projects, root, lock } = await projectWindows();
      const directories = mode === 'both' ? ['locks', 'legacy-locks'] : ['legacy-locks'];
      const token = 'a'.repeat(64);
      for (const directory of directories) {
        const location = path.join(root, directory),
          owner = new RepositoryOperationLock(location, 'interrupted');
        locks.push(owner);
        const lease = await owner.acquire(root, 'pull', token);
        await lease.markRunning();
        await lease.quarantine();
        await owner.close();
        const file = path.join(location, (await readdir(location))[0]);
        const record = JSON.parse(await readFile(file, 'utf8'));
        delete record.ownerPid;
        await writeFile(file, JSON.stringify(record));
      }
      await expect(
        projects.runRepositoryOperation(root, 'push', async () => {}),
      ).rejects.toMatchObject({ token, code: 'REPOSITORY_RECOVERY_REQUIRED' });
      if (mode === 'legacy') expect(await lock.isBusy(root)).toBe(false);
      await expect(projects.recoverRepositoryOperation(root, 'b'.repeat(64))).rejects.toThrow(
        'already running',
      );
      await projects.recoverRepositoryOperation(root, token);
      await expect(
        projects.runRepositoryOperation(root, 'push', async () => 'recovered'),
      ).resolves.toBe('recovered');
    },
  );
  it('retains both running leases and the original failure if one quarantine write fails', async () => {
    const { projects, root, lock, legacy } = await projectWindows();
    const acquire = legacy.acquire.bind(legacy);
    vi.spyOn(legacy, 'acquire').mockImplementationOnce(async (...args) => {
      const lease = await acquire(...args);
      return {
        ...lease,
        quarantine: async () => {
          throw new Error('legacy disk full');
        },
      };
    });
    const error = Object.assign(new Error('unknown Git tree'), {
      terminationUnconfirmed: true,
      pid: process.pid,
    });
    await expect(
      projects.runRepositoryOperation(root, 'pull', async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(await lock.isBusy(root)).toBe(true);
    expect(await legacy.isBusy(root)).toBe(true);
    await lock.close();
    await legacy.close();
    const records = await Promise.all(
      ['locks', 'legacy-locks'].map(async (directory) => {
        const location = path.join(root, directory),
          file = path.join(location, (await readdir(location))[0]);
        return JSON.parse(await readFile(file, 'utf8')) as { token: string; running: boolean };
      }),
    );
    expect(records[0].token).toBe(records[1].token);
    expect(records.every((record) => record.running)).toBe(true);
  });
  it('releases the lease even when both activity broadcasts fail', async () => {
    const { projects, root } = await projectWindows(
      vi.fn(async () => {
        throw new Error('registry unavailable');
      }),
    );
    const task = vi.fn(async () => 'done');
    expect(await projects.runRepositoryOperation(root, 'fetch', task)).toBe('done');
    expect(task).toHaveBeenCalledOnce();
    expect(await projects.isRepositoryBusy(root)).toBe(false);
    expect(await projects.runRepositoryOperation(root, 'fetch', async () => 'again')).toBe('again');
  });
  it('keeps protection when process-tree termination is unconfirmed', async () => {
    const { projects, root, lock, legacy, broadcast } = await projectWindows();
    const error = Object.assign(new Error('unknown Git tree'), {
      terminationUnconfirmed: true,
      pid: process.pid,
    });
    await expect(
      projects.runRepositoryOperation(root, 'pull', async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(await projects.isRepositoryBusy(root)).toBe(true);
    expect(await legacy.isBusy(root)).toBe(true);
    expect(broadcast).not.toHaveBeenCalledWith(expect.objectContaining({ busy: false }));
    await lock.close();
    await expect(projects.runRepositoryOperation(root, 'pull', async () => {})).rejects.toThrow(
      'closed',
    );
  });
  it('reconciles a missed finish event before allowing a new action', async () => {
    const projects = {
      isRepositoryBusy: vi.fn(async () => false),
      runRepositoryOperation: vi.fn(
        async (_key: string, _label: string, task: () => Promise<unknown>) => task(),
      ),
    };
    const { value, repo, git } = workbench(projects);
    value.externalRepositoryActivity(repo.commonDir, true, 'pull');
    await value.handle(action);
    expect(projects.isRepositoryBusy).toHaveBeenCalledWith(repo.commonDir);
    expect(git.execute).toHaveBeenCalledOnce();
  });
  it('does not clear a newer busy event while reconciling an older event', async () => {
    let resolve!: (busy: boolean) => void;
    const projects = {
      isRepositoryBusy: vi.fn(
        () =>
          new Promise<boolean>((done) => {
            resolve = done;
          }),
      ),
      runRepositoryOperation: vi.fn(),
    };
    const { value, repo, git } = workbench(projects);
    value.externalRepositoryActivity(repo.commonDir, true, 'old');
    const pending = value.handle(action);
    value.externalRepositoryActivity(repo.commonDir, true, 'new');
    resolve(false);
    await expect(pending).rejects.toThrow('already running');
    expect(git.execute).not.toHaveBeenCalled();
  });
  it('offers explicit recovery and requires a retry instead of replaying the write', async () => {
    const projects = {
      runRepositoryOperation: vi.fn(async () => {
        throw new RepositoryOperationRecoveryRequiredError('captured-token', 'pull');
      }),
      recoverRepositoryOperation: vi.fn(async () => {}),
    };
    const { value, repo, git } = workbench(projects);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Remove protection' as never);
    await expect(value.handle(action)).rejects.toThrow('retry');
    expect(projects.recoverRepositoryOperation).toHaveBeenCalledWith(
      repo.commonDir,
      'captured-token',
    );
    expect(git.execute).not.toHaveBeenCalled();
    expect(projects.runRepositoryOperation).toHaveBeenCalledOnce();
  });
  it('forwards cancellation through the read scope while leaving a concurrent write untouched', async () => {
    const projects = {
      runRepositoryOperation: vi.fn(
        async (_key: string, _label: string, task: () => Promise<unknown>) => task(),
      ),
    };
    const { value, git } = workbench(projects),
      signals: AbortSignal[] = [];
    let finishOld!: (value: string) => void, finishWrite!: () => void;
    Object.assign(git, {
      withReadSignal: vi.fn((signal: AbortSignal, task: () => Promise<unknown>) => {
        signals.push(signal);
        return task();
      }),
      history: vi.fn(async (_repo: unknown, query: { search?: string }) =>
        query.search === 'old'
          ? new Promise<string>((done) => {
              finishOld = done;
            })
          : 'latest',
      ),
    });
    git.execute.mockImplementation(
      () =>
        new Promise<void>((done) => {
          finishWrite = done;
        }),
    );
    const old = value.handle({
        id: 'old-read',
        method: 'history',
        repoId: 'repo',
        payload: { search: 'old' },
      }),
      rejected = expect(old).rejects.toMatchObject({ code: 'ABORTED' });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const write = value.handle(action);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    await expect(
      value.handle({
        id: 'new-read',
        method: 'history',
        repoId: 'repo',
        payload: { search: 'new' },
      }),
    ).resolves.toBe('latest');
    await rejected;
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    expect(git.execute).toHaveBeenCalledOnce();
    await value.handle({
      id: 'cancel-write-attempt',
      method: 'cancelQuery',
      payload: { requestId: action.id },
    });
    expect(signals[1].aborted).toBe(false);
    finishOld('obsolete');
    finishWrite();
    await write;
  });
});
