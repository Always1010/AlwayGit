import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitServiceContract, Repository } from '../src/protocol/types';
import * as vscode from 'vscode';

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
    workspace: { isTrusted: true, workspaceFolders: [], createFileSystemWatcher: (pattern: unknown) => {
      const change = new EventEmitter<any>(), create = new EventEmitter<any>(), remove = new EventEmitter<any>();
      const watcher = { pattern, change, create, remove, onDidChange: change.event, onDidCreate: create.event, onDidDelete: remove.event, dispose: vi.fn() };
      surfaces.watchers.push(watcher); return watcher;
    } },
  };
});
import { RepositoryManager } from '../src/repositories/manager';
import { GitService } from '../src/git/service';

const root = path.join(process.cwd(), 'fixture');
const repo: Repository = { id: 'fixture', root, commonDir: path.join(root, '.git'), name: 'Fixture' };
let manager: RepositoryManager;
let discover: ReturnType<typeof vi.fn>;
let trackedPaths: ReturnType<typeof vi.fn>;
let storage: string;
beforeEach(async () => {
  vi.useFakeTimers(); surfaces.watchers.length = 0;
  Object.assign(vscode.workspace,{workspaceFolders:[]});
  discover=vi.fn(async()=>repo);
  trackedPaths=vi.fn(async()=>[]);
  storage = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-watch-'));
  manager = new RepositoryManager({ discover, trackedPaths } as unknown as GitServiceContract, { globalStorageUri: { fsPath: storage }, workspaceState: { get: vi.fn((_key, fallback) => fallback), update: vi.fn() }, globalState: { get: vi.fn((_key, fallback) => fallback), update: vi.fn() } } as any, { appendLine: vi.fn() } as any);
  await manager.add(root, false);
});
afterEach(async () => {
  manager.dispose(); vi.useRealTimers();
  if(path.dirname(storage)!==path.resolve(os.tmpdir())||!path.basename(storage).startsWith('alwaygit-watch-'))throw new Error('Unsafe cleanup target');
  await rm(storage,{recursive:true,force:true,maxRetries:5});
});

describe('repository change scope', () => {
  it('watches normal files when a repository ancestor is named node_modules, rejecting outside and .git paths', async () => {
    const nested = { ...repo, id: 'nested', root: path.join(root, 'node_modules', 'project'), commonDir: path.join(root, 'node_modules', 'project', '.git') };
    discover.mockResolvedValue(nested); await manager.add(nested.root);
    const watcher = surfaces.watchers[2], listener = vi.fn(); manager.onDidChange(listener);
    watcher.change.fire({ fsPath: path.join(nested.root, 'a.txt') });
    watcher.change.fire({ fsPath: path.join(nested.root, '.git', 'index') });
    watcher.change.fire({ fsPath: path.join(nested.root, '..', 'outside.txt') });
    await vi.advanceTimersByTimeAsync(300);
    expect(listener.mock.calls).toEqual([[{ repoId: nested.id, changes: { paths: ['a.txt'] } }]]);
    expect(trackedPaths).not.toHaveBeenCalled();
  });

  it('debounces tracked dependency files and conservatively invalidates on membership failure or overflow', async () => {
    trackedPaths.mockResolvedValueOnce(['node_modules/tracked.js']).mockRejectedValueOnce(new Error('read failed'));
    const watcher = surfaces.watchers[0], listener = vi.fn(); manager.onDidChange(listener);
    for (let index = 0; index < 20; index++) watcher.change.fire({ fsPath: path.join(root, 'node_modules', 'tracked.js') });
    watcher.change.fire({ fsPath: path.join(root, 'node_modules', 'ignored.js') });
    await vi.advanceTimersByTimeAsync(600);
    expect(trackedPaths).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith({ repoId: repo.id, changes: { paths: ['node_modules/tracked.js'] } });
    watcher.remove.fire({ fsPath: path.join(root, 'node_modules', 'tracked.js') });
    await vi.advanceTimersByTimeAsync(600);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({ repoId: repo.id, changes: { paths: ['node_modules/tracked.js'] } });
    for (let index = 0; index < 500; index++) watcher.create.fire({ fsPath: path.join(root, 'node_modules', `${index}.js`) });
    await vi.advanceTimersByTimeAsync(600);
    expect(trackedPaths).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({ repoId: repo.id, changes: {} });
  });

  it('recognizes literal tracked dependency filenames with real Git, including deleted files', async () => {
    vi.useRealTimers();
    const directory = path.join(storage, 'node_modules', 'project');
    await mkdir(path.join(directory, 'node_modules'), { recursive: true });
    const git = promisify(execFile);
    await git('git', ['init', directory]);
    await writeFile(path.join(directory, 'node_modules', '[x].js'), 'tracked');
    await writeFile(path.join(directory, 'node_modules', 'x.js'), 'untracked');
    await git('git', ['-C', directory, '--literal-pathspecs', 'add', '--', 'node_modules/[x].js']);
    const service = new GitService(), actual = await service.discover(directory);
    await rm(path.join(directory, 'node_modules', '[x].js'));
    expect(await service.trackedPaths(actual, ['node_modules/[x].js', 'node_modules/x.js'])).toEqual(['node_modules/[x].js']);
    discover.mockResolvedValue(actual);
    trackedPaths.mockImplementation((repository: Repository, paths: string[]) => service.trackedPaths(repository, paths));
    await manager.add(directory);
    const watcher = surfaces.watchers.find(watcher => watcher.pattern.base === actual.root && watcher.pattern.pattern === '**/*');
    expect(watcher).toBeDefined();
    for (const contents of ['first edit', 'second edit with the same dirty status']) {
      await writeFile(path.join(directory, 'node_modules', '[x].js'), contents);
      const notification = new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`No dependency notification; queries=${trackedPaths.mock.calls.length}`)), 2500);
        const subscription = manager.onDidChange(event => { clearTimeout(timeout); subscription.dispose(); resolve(event); });
      });
      watcher.change.fire({ fsPath: path.join(actual.root, 'node_modules', '[x].js') });
      expect(await notification).toEqual({ repoId: actual.id, changes: { paths: ['node_modules/[x].js'] } });
    }
    expect(trackedPaths).toHaveBeenCalledTimes(2);
  });

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
    expect(listener).toHaveBeenCalledOnce();
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
  it('shares metadata listeners while routing each Index to its owning Worktree',async()=>{
    const linked:Repository={...repo,id:'linked',root:path.join(process.cwd(),'linked'),gitDir:path.join(repo.commonDir,'worktrees','linked'),mainRoot:repo.root};
    discover.mockImplementation(async()=>linked);await manager.add(linked.root);
    expect(surfaces.watchers).toHaveLength(3);
    const listener=vi.fn();manager.onDidChange(listener);
    surfaces.watchers[1].change.fire({fsPath:path.join(linked.gitDir!,'index')});await vi.advanceTimersByTimeAsync(300);
    expect(listener.mock.calls).toEqual([[{repoId:linked.id,changes:{paths:[],index:true}}]]);
    listener.mockClear();surfaces.watchers[1].change.fire({fsPath:path.join(repo.commonDir,'index')});await vi.advanceTimersByTimeAsync(300);
    expect(listener.mock.calls).toEqual([[{repoId:repo.id,changes:{paths:[],index:true}}]]);
    listener.mockClear();surfaces.watchers[1].change.fire({fsPath:path.join(repo.commonDir,'refs','heads','main')});await vi.advanceTimersByTimeAsync(300);
    expect(listener.mock.calls.map(([event])=>event.repoId).sort()).toEqual([repo.id,linked.id].sort());
    expect(listener.mock.calls.every(([event])=>event.changes.index===false)).toBe(true);
    Object.assign(vscode.workspace,{workspaceFolders:[{uri:{scheme:'file',fsPath:linked.root}}]});await manager.synchronizeSharedState();
    expect(manager.list().map(member=>member.id)).toEqual([linked.id]);expect(surfaces.watchers[1].dispose).not.toHaveBeenCalled();
    await manager.remove([manager.groups()[0].key]);expect(surfaces.watchers[1].dispose).toHaveBeenCalledOnce();
  });
  it('replaces stale metadata listeners when a registered root changes its Git directory',async()=>{
    const replacement={...repo,commonDir:path.join(root,'other-git'),gitDir:path.join(root,'other-git')};
    discover.mockResolvedValue(replacement);await manager.add(root);
    expect(manager.get(repo.id).commonDir).toBe(replacement.commonDir);
    expect(surfaces.watchers[0].dispose).toHaveBeenCalledOnce();expect(surfaces.watchers[1].dispose).toHaveBeenCalledOnce();
    const listener=vi.fn();manager.onDidChange(listener);surfaces.watchers[3].change.fire({fsPath:path.join(replacement.commonDir,'index')});await vi.advanceTimersByTimeAsync(300);
    expect(listener).toHaveBeenCalledWith({repoId:repo.id,changes:{paths:[],index:true}});
  });
});
