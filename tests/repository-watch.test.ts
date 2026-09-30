import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitServiceContract, Repository } from '../src/protocol/types';

const surfaces = vi.hoisted(() => ({ watchers: [] as any[] }));
vi.mock('vscode', () => {
  class EventEmitter<T> {
    listeners = new Set<(value: T) => void>();
    event = (listener: (value: T) => void) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
    fire(value: T) { for (const listener of this.listeners) listener(value); }
    dispose() { this.listeners.clear(); }
  }
  return {
    EventEmitter,
    RelativePattern: class { constructor(public base: string, public pattern: string) {} },
    workspace: { isTrusted: true, createFileSystemWatcher: (pattern: unknown) => {
      const change = new EventEmitter<any>(), create = new EventEmitter<any>(), remove = new EventEmitter<any>();
      const watcher = { pattern, change, create, remove, onDidChange: change.event, onDidCreate: create.event, onDidDelete: remove.event, dispose: vi.fn() };
      surfaces.watchers.push(watcher); return watcher;
    } },
  };
});
import { RepositoryManager } from '../src/repositories/manager';

const root = path.join(process.cwd(), 'fixture');
const repo: Repository = { id: 'fixture', root, commonDir: path.join(root, '.git'), name: 'Fixture' };
let manager: RepositoryManager;
beforeEach(async () => {
  vi.useFakeTimers(); surfaces.watchers.length = 0;
  manager = new RepositoryManager({ discover: async () => repo } as unknown as GitServiceContract, { workspaceState: { get: vi.fn((_key, fallback) => fallback), update: vi.fn() }, globalState: { get: vi.fn((_key, fallback) => fallback), update: vi.fn() } } as any, { appendLine: vi.fn() } as any);
  await manager.add(root);
});
afterEach(() => { manager.dispose(); vi.useRealTimers(); });

describe('repository change scope', () => {
  it('combines working-file and Index notifications without losing paths', async () => {
    const listener = vi.fn(); manager.onDidChange(listener);
    surfaces.watchers[0].change.fire({ fsPath: path.join(root, 'a.txt') });
    surfaces.watchers[0].create.fire({ fsPath: path.join(root, 'src', 'b.txt') });
    surfaces.watchers[1].change.fire({ fsPath: path.join(repo.commonDir, 'index') });
    await vi.advanceTimersByTimeAsync(300);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ repoId: repo.id, changes: { paths: ['a.txt', 'src/b.txt'], index: true } });
  });

  it('distinguishes ref updates from Index updates and excludes internal working paths', async () => {
    const listener = vi.fn(); manager.onDidChange(listener);
    surfaces.watchers[0].change.fire({ fsPath: path.join(root, 'node_modules', 'a.js') });
    surfaces.watchers[0].change.fire({ fsPath: path.join(repo.commonDir, 'index') });
    await vi.advanceTimersByTimeAsync(300); expect(listener).not.toHaveBeenCalled();
    surfaces.watchers[1].change.fire({ fsPath: path.join(repo.commonDir, 'refs', 'heads', 'main') });
    await vi.advanceTimersByTimeAsync(300);
    expect(listener).toHaveBeenLastCalledWith({ repoId: repo.id, changes: { paths: [], index: false } });
    surfaces.watchers[1].change.fire({ fsPath: path.join(repo.commonDir, 'worktrees', 'linked', 'index') });
    await vi.advanceTimersByTimeAsync(300);
    expect(listener).toHaveBeenLastCalledWith({ repoId: repo.id, changes: { paths: [], index: true } });
  });

  it('retains unbounded invalidation when a command and file event overlap', async () => {
    const listener = vi.fn(); manager.onDidChange(listener);
    manager.notify(repo.id);
    surfaces.watchers[0].remove.fire({ fsPath: path.join(root, 'a.txt') });
    await vi.advanceTimersByTimeAsync(300);
    expect(listener).toHaveBeenCalledWith({ repoId: repo.id, changes: {} });
  });

  it('disposes watchers and cancels pending notifications', async () => {
    const listener = vi.fn(); manager.onDidChange(listener);
    manager.notify(repo.id, { paths: ['a.txt'] }); manager.dispose();
    await vi.advanceTimersByTimeAsync(300);
    expect(listener).not.toHaveBeenCalled(); expect(surfaces.watchers.every(watcher => watcher.dispose.mock.calls.length === 1)).toBe(true);
  });
});
