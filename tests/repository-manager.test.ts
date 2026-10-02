import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GitService } from '../src/git/service';
import { RepositoryManager, RepositoryTree } from '../src/repositories/manager';
import { Workbench } from '../src/extension/workbench';

vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners = new Set<(event: T) => void>();
    event = (listener: (event: T) => void) => { this.listeners.add(listener); return { dispose: () => { this.listeners.delete(listener); } }; };
    fire(value: T) { for (const listener of this.listeners) listener(value); }
    dispose() { this.listeners.clear(); }
  }
  return {
    EventEmitter, RelativePattern: class { constructor(public base: string, public pattern: string) {} },
    workspace: { isTrusted: true, workspaceFolders: [], createFileSystemWatcher: vi.fn(), getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
    extensions: { getExtension: vi.fn() }, ProgressLocation: { Notification: 15 },
    window: { showOpenDialog: vi.fn(), showQuickPick: vi.fn(), withProgress: vi.fn(), showInformationMessage: vi.fn(), showWarningMessage: vi.fn() },
  };
});
const exec = promisify(execFile), roots: string[] = [], managers: RepositoryManager[] = [], workbenches: Workbench[] = [];
const watcher = () => ({ dispose: vi.fn(), onDidChange: () => ({ dispose() {} }), onDidCreate: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }) });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-registration-')); roots.push(root);
  for (const relative of ['A', 'category/B']) {
    const directory = path.join(root, relative); await mkdir(directory, { recursive: true });
    await exec('git', ['-C', directory, 'init', '-b', 'main'], { windowsHide: true });
  }
  return root;
}
function setup(globalValues = new Map<string, unknown>()) {
  const values = new Map<string, unknown>();
  values.set('alwaygit.session', { language: 'zh-CN', repoId: 'active', layout: { preset: 'editor' }, drafts: { active: '保留草稿' } });
  const update = vi.fn(async (key: string, value: unknown) => { values.set(key, value); });
  const globalUpdate = vi.fn(async (key: string, value: unknown) => { globalValues.set(key, value); });
  const context = {
    workspaceState: { get: (key: string, fallback: unknown) => values.get(key) ?? fallback, update },
    globalState: { get: (key: string, fallback: unknown) => globalValues.get(key) ?? fallback, update: globalUpdate },
  } as unknown as vscode.ExtensionContext;
  const output = { appendLine: vi.fn() } as unknown as vscode.OutputChannel;
  const git = new GitService(), manager = new RepositoryManager(git, context, output); managers.push(manager);
  return { context, output, git, manager, update, values, globalUpdate, globalValues };
}
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(vscode.workspace, { isTrusted: true, workspaceFolders: [] });
  vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined);
  vi.mocked(vscode.workspace.createFileSystemWatcher).mockImplementation(watcher as unknown as typeof vscode.workspace.createFileSystemWatcher);
  vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
  vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
  vi.mocked(vscode.window.showQuickPick).mockImplementation(async items => (items as vscode.QuickPickItem[]).filter(item => item.picked) as never);
  vi.mocked(vscode.window.withProgress).mockImplementation(async (_options, task) => task({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }));
});
afterEach(async () => {
  for (const workbench of workbenches.splice(0)) workbench.dispose();
  for (const manager of managers.splice(0)) manager.dispose();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('alwaygit-registration-')) throw new Error('Unsafe cleanup target');
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

describe('batch repository registration', () => {
  async function worktree(root: string) {
    const main = path.join(root, 'A'), linked = path.join(root, 'category/A-linked');
    await exec('git', ['-C', main, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Initial'], { windowsHide: true });
    await exec('git', ['-C', main, 'worktree', 'add', '-b', 'feature', linked], { windowsHide: true });
    return { main, linked };
  }
  it('groups recursive Worktrees in both navigation lists and counts logical repositories', async () => {
    const root = await fixture(); await worktree(root); const { manager } = setup();
    expect(await manager.addDirectory(root)).toMatchObject({ found: 2, added: 2, existing: 0 });
    expect(manager.list()).toHaveLength(3); expect(manager.groups()).toHaveLength(2);
    expect(new RepositoryTree(manager).getChildren().map(repo => repo.name).sort()).toEqual(['A', 'B']);
    expect(await manager.addDirectory(root)).toMatchObject({ found: 2, added: 0, existing: 2 });
  });
  it('discovers candidates without registering, watching or saving them until confirmed', async () => {
    const root = await fixture(), { manager, globalUpdate } = setup();
    const discovery = await manager.discoverDirectory(root);
    expect(discovery).toMatchObject({ found: 2, cancelled: false });
    expect(manager.list()).toEqual([]);
    expect(vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled();
    expect(globalUpdate).not.toHaveBeenCalled();
    expect(await manager.registerDiscovered(discovery)).toMatchObject({ added: 2, existing: 0 });
    expect(manager.groups()).toHaveLength(2);
  });
  it('notifies when adding a new Worktree to an existing group without counting a new repository', async () => {
    const root = await fixture(), { main, linked } = await worktree(root), { manager } = setup();
    await manager.add(main); const changed = vi.fn(); manager.onDidChangeRepositories(changed);
    expect(await manager.addDirectory(linked)).toMatchObject({ found: 1, added: 0, existing: 1 });
    expect(changed).toHaveBeenCalledTimes(1); expect(manager.list()).toHaveLength(2); expect(manager.groups()).toHaveLength(1);
  });
  it('restores legacy Worktree paths, drafts and IDs and groups automatic VS Code discovery', async () => {
    const root = await fixture(), { main, linked } = await worktree(root), { manager, git, values, update, globalValues, globalUpdate } = setup();
    const linkedRepo = await git.discover(linked), mainRepo = await git.discover(main);
    const session = { repoId: linkedRepo.id, drafts: { [mainRepo.id]: '主目录草稿', [linkedRepo.id]: 'Worktree 草稿' }, layout: { preset: 'editor' } };
    values.set('alwaygit.roots', [linked, main]); values.set('alwaygit.session', session);
    vi.mocked(vscode.extensions.getExtension).mockReturnValue({ activate: async () => ({ getAPI: () => ({ repositories: [{ rootUri: { scheme: 'file', fsPath: linked } }, { rootUri: { scheme: 'file', fsPath: main } }] }) }) } as never);
    await manager.scan();
    expect(manager.groups()).toHaveLength(1); expect(new RepositoryTree(manager).getChildren()[0].id).toBe(mainRepo.id);
    expect(manager.get(linkedRepo.id).root).toBe(linkedRepo.root); expect(values.get('alwaygit.session')).toBe(session);
    expect(update).not.toHaveBeenCalled(); expect(globalUpdate).toHaveBeenCalledTimes(1);
    expect(globalValues.get('alwaygit.repositoryRoots.v1')).toEqual([linked, main]);
  });
  it('shows the main repository name when directly adding only its linked directory', async () => {
    const root = await fixture(), { linked } = await worktree(root), { manager } = setup();
    const repo = await manager.add(linked);
    expect(manager.groups()[0]).toMatchObject({ name: 'A', repository: repo });
    expect(new RepositoryTree(manager).getChildren()[0]).toMatchObject({ id: repo.id, name: 'A' });
  });
  it('deduplicates, saves and notifies once, restores registered roots, and preserves session data', async () => {
    const root = await fixture(), shared = new Map<string, unknown>(), { manager, context, output, git, globalUpdate, globalValues, values } = setup(shared);
    const session = values.get('alwaygit.session'), changed = vi.fn(); manager.onDidChangeRepositories(changed);
    expect(await manager.addDirectory(root)).toMatchObject({ found: 2, added: 2, existing: 0, cancelled: false });
    expect(changed).toHaveBeenCalledTimes(1); expect(globalUpdate).toHaveBeenCalledTimes(1);
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(4);
    expect(await manager.addDirectory(root)).toMatchObject({ found: 2, added: 0, existing: 2 });
    expect(changed).toHaveBeenCalledTimes(1); expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(4);
    expect(values.get('alwaygit.session')).toBe(session);
    const restored = new RepositoryManager(git, context, output); managers.push(restored); await restored.scan();
    expect(restored.list()).toEqual(manager.list());
    expect(globalValues.get('alwaygit.repositoryRoots.v1')).toEqual(manager.list().map(r => r.root));

    const otherWindow = setup(shared).manager; await otherWindow.scan();
    expect(otherWindow.list()).toEqual(manager.list());
  });

  it('cancels after finding one repository without registering or saving a partial batch', async () => {
    const root = await fixture(), { manager, globalUpdate } = setup(); let cancelled = false;
    expect(await manager.addDirectory(root, { isCancelled: () => cancelled, onProgress: ({ found }) => { if (found) cancelled = true; } })).toMatchObject({ found: 1, added: 0, cancelled: true });
    expect(manager.list()).toEqual([]); expect(globalUpdate).not.toHaveBeenCalled();
    expect(vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled();
  });

  it('disposes incomplete watcher registration and continues adding healthy repositories', async () => {
    const root = await fixture(), { manager } = setup(), first = watcher();
    vi.mocked(vscode.workspace.createFileSystemWatcher)
      .mockImplementationOnce(() => first as unknown as vscode.FileSystemWatcher)
      .mockImplementationOnce(() => { throw new Error('Watcher failed'); });
    const result = await manager.addDirectory(root);
    expect(result).toMatchObject({ found: 2, added: 1 }); expect(result.issues).toHaveLength(1);
    expect(first.dispose).toHaveBeenCalledTimes(1); expect(manager.list().map(r => r.name)).toEqual(['B']);
  });

  it('removes a logical repository, forgets its roots and keeps automatic discovery from restoring it', async () => {
    const root = await fixture(), shared = new Map<string, unknown>(), { manager, globalValues } = setup(shared);
    await manager.addDirectory(root);
    const group = manager.groups()[0];
    expect(await manager.remove([group.key])).toBe(1);
    expect(manager.groups()).toHaveLength(1);
    expect(globalValues.get('alwaygit.repositoryRoots.v1')).toHaveLength(1);
    expect(globalValues.get('alwaygit.excludedRepositories.v1')).toContain(group.key);
    Object.assign(vscode.workspace, { workspaceFolders: [{ uri: { scheme: 'file', fsPath: group.repository.root } }] });
    await manager.scan();
    expect(manager.groups().some(item => item.key === group.key)).toBe(false);
  });

  it('shows grouped repositories below their folder while ungrouped repositories remain at the root', async () => {
    const root=await fixture(),{manager,globalValues}=setup();await manager.addDirectory(root);
    const groups=manager.groups().sort((a,b)=>a.name.localeCompare(b.name)),collection=await manager.createCollection('Client Project');
    expect(await manager.move([groups[0].key],collection.id)).toBe(1);
    const tree=new RepositoryTree(manager),roots=tree.getChildren(),folder=roots.find(node=>'collection' in node);
    expect(roots.map(node=>node.name).sort()).toEqual(['B','Client Project']);
    expect(folder&&tree.getChildren(folder).map(node=>node.name)).toEqual(['A']);
    expect(roots.some(node=>node.name==='Ungrouped'||node.name==='未分组')).toBe(false);
    expect(globalValues.get('alwaygit.repositoryCollectionAssignments.v1')).toMatchObject({[groups[0].key]:collection.id});
    await manager.deleteCollection(collection.id);
    expect(tree.getChildren().map(node=>node.name).sort()).toEqual(['A','B']);
  });

  it('does not scan or register in an untrusted workspace', async () => {
    const { manager, git, globalUpdate } = setup(), discover = vi.spyOn(git, 'discover');
    Object.assign(vscode.workspace, { isTrusted: false });
    await expect(manager.addDirectory('unused')).rejects.toThrow('Trust');
    expect(discover).not.toHaveBeenCalled(); expect(globalUpdate).not.toHaveBeenCalled();
  });
});

describe('Add Repository host entry', () => {
  function workbench() {
    const { manager, context, git, output } = setup();
    const value = new Workbench(context, git, manager, {} as never, output, {} as never); workbenches.push(value); return { value, manager, output };
  }
  it('uses cancellable progress and reports a bulk result through the existing RPC', async () => {
    const root = await fixture(), { value, manager } = workbench();
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: root }] as vscode.Uri[]);
    expect(await value.handle({ id: 'add', method: 'addRepository' })).toEqual({ added: 2, existing: 0, skipped: 0, cancelled: false });
    expect(manager.list()).toHaveLength(2);
    expect(vscode.window.showQuickPick).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ description: '可添加', picked: true })]),expect.objectContaining({canPickMany:true}));
    expect(vscode.window.withProgress).toHaveBeenCalledWith(expect.objectContaining({ cancellable: true }), expect.any(Function));
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('新增 2 个仓库，0 个已存在。');
  });

  it('does not register scan results when the review picker is dismissed', async () => {
    const root=await fixture(),{value,manager}=workbench();
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{fsPath:root}] as vscode.Uri[]);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);
    expect(await value.addRepository()).toMatchObject({added:0,cancelled:true});
    expect(manager.list()).toEqual([]);
    expect(vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled();
  });

  it('confirms removal without deleting files and excludes the repository from later scans', async () => {
    const root=await fixture(),{value,manager}=workbench();
    await manager.addDirectory(root);const group=manager.groups()[0];
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('移除' as never);
    expect(await value.handle({id:'remove',method:'removeRepositories',payload:{keys:[group.key]}})).toBe(1);
    expect(manager.groups().some(item=>item.key===group.key)).toBe(false);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('不会删除磁盘上的文件'),{modal:true},'移除');
  });

  it('reports no repositories and a damaged repository without silently succeeding', async () => {
    const root = await fixture(), { value, output } = workbench();
    const empty = path.join(root, 'empty'); await mkdir(empty);
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: empty }] as vscode.Uri[]);
    await value.addRepository();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('所选目录中没有找到 Git 仓库。');
    await writeFile(path.join(empty, '.git'), 'invalid gitfile');
    expect(await value.addRepository()).toMatchObject({ added: 0, skipped: 1 });
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('跳过 1 个异常目录或仓库'));
    expect(output.appendLine).toHaveBeenCalledTimes(1);
  });

  it('does not scan when the folder picker is dismissed or progress is cancelled', async () => {
    const { value, manager } = workbench(), add = vi.spyOn(manager, 'discoverDirectory');
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined);
    expect(await value.addRepository()).toBeUndefined(); expect(add).not.toHaveBeenCalled();
    const root = await fixture();
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: root }] as vscode.Uri[]);
    vi.mocked(vscode.window.withProgress).mockImplementation(async (_options, task) => task({ report: vi.fn() }, { isCancellationRequested: true, onCancellationRequested: () => ({ dispose() {} }) }));
    expect(await value.addRepository()).toMatchObject({ added: 0, cancelled: true }); expect(manager.list()).toEqual([]);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('已取消仓库扫描，未添加任何仓库。');
  });
});
