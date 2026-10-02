import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GitService } from '../src/git/service';
import { RepositoryManager } from '../src/repositories/manager';
import { CatalogStore } from '../src/repositories/catalog-store';
import { collectionOrderKey, repositoryOrderKey } from '../src/protocol/repository-order';
import { Workbench } from '../src/extension/workbench';
import type { Repository } from '../src/protocol/types';

vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners = new Set<(event: T) => void>();
    event = (listener: (event: T) => void) => { this.listeners.add(listener); return { dispose: () => { this.listeners.delete(listener); } }; };
    fire(value: T) { for (const listener of this.listeners) listener(value); }
    dispose() { this.listeners.clear(); }
  }
  return {
    EventEmitter, RelativePattern: class { constructor(public base: string, public pattern: string) {} },
    workspace: { isTrusted: true, workspaceFolders: [], createFileSystemWatcher: vi.fn(), onDidChangeConfiguration: () => ({ dispose() {} }), getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
    extensions: { getExtension: vi.fn() }, ProgressLocation: { Notification: 15 },
    window: { showInputBox: vi.fn(), showOpenDialog: vi.fn(), showQuickPick: vi.fn(), withProgress: vi.fn(), showInformationMessage: vi.fn(), showWarningMessage: vi.fn() },
  };
});
const exec = promisify(execFile), roots: string[] = [], managers: RepositoryManager[] = [], workbenches: Workbench[] = [];
const watcher = () => ({ dispose: vi.fn(), onDidChange: () => ({ dispose() {} }), onDidCreate: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }) });
const storage = new WeakMap<Map<string, unknown>, string>();
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-registration-')); roots.push(root);
  for (const relative of ['A', 'category/B']) {
    const directory = path.join(root, relative); await mkdir(directory, { recursive: true });
    await exec('git', ['-C', directory, 'init', '-b', 'main'], { windowsHide: true });
  }
  return root;
}
function setup(globalValues = new Map<string, unknown>()) {
  let storagePath = storage.get(globalValues);
  if (!storagePath) { storagePath = mkdtempSync(path.join(os.tmpdir(), 'alwaygit-registration-')); storage.set(globalValues, storagePath); roots.push(storagePath); }
  const values = new Map<string, unknown>();
  values.set('alwaygit.session', { language: 'zh-CN', repoId: 'active', layout: { preset: 'editor' }, drafts: { active: '保留草稿' } });
  const update = vi.fn(async (key: string, value: unknown) => { values.set(key, value); });
  const globalUpdate = vi.fn(async (key: string, value: unknown) => { globalValues.set(key, value); });
  const context = {
    globalStorageUri: { fsPath: storagePath },
    storageUri: { fsPath: path.join(storagePath, 'workspace-default') },
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
    expect(manager.groups().map(repo => repo.name).sort()).toEqual(['A', 'B']);
    expect(await manager.addDirectory(root)).toMatchObject({ found: 2, added: 0, existing: 2 });
  });
  it('discovers candidates without registering, watching or saving them until confirmed', async () => {
    const root = await fixture(), { manager, globalUpdate } = setup();
    const discovery = await manager.discoverDirectory(root);
    expect(discovery).toMatchObject({ found: 2, cancelled: false });
    expect(manager.list()).toEqual([]);
    expect(vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled();
    expect(globalUpdate).not.toHaveBeenCalled();
    const result=await manager.registerDiscovered(discovery, {}, { newCollectionName: 'Imported' });
    expect(result).toMatchObject({ added: 2, existing: 0, collection: { name: 'Imported' } });
    expect(manager.groups()).toHaveLength(2);
    expect(manager.collections()).toHaveLength(1);expect(manager.groups().every(group=>group.collectionId===manager.collections()[0].id)).toBe(true);
    expect((manager as unknown as {catalog:CatalogStore}).catalog.snapshot().revision).toBe(1);
    await manager.registerDiscovered(discovery, {}, { collectionId: undefined });
    expect(manager.groups().every(group=>!group.collectionId)).toBe(true);
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
    expect(manager.groups()).toHaveLength(1); expect(manager.groups()[0].repository.id).toBe(mainRepo.id);
    expect(manager.get(linkedRepo.id).root).toBe(linkedRepo.root); expect(values.get('alwaygit.session')).toBe(session);
    expect(update).not.toHaveBeenCalled(); expect(globalUpdate.mock.calls.filter(([key])=>key==='alwaygit.repositoryRoots.v1')).toHaveLength(1);
    expect(globalValues.get('alwaygit.repositoryRoots.v1')).toEqual([linked, main]);
  });
  it('shows the main repository name when directly adding only its linked directory', async () => {
    const root = await fixture(), { linked } = await worktree(root), { manager } = setup();
    const repo = await manager.add(linked);
    expect(manager.groups()[0]).toMatchObject({ name: 'A', repository: repo });
    expect(manager.groups()[0]).toMatchObject({ name: 'A', repository: { id: repo.id } });
  });
  it('deduplicates, saves and notifies once, restores registered roots, and preserves session data', async () => {
    const root = await fixture(), shared = new Map<string, unknown>(), { manager, context, output, git, globalUpdate, globalValues, values } = setup(shared);
    const session = values.get('alwaygit.session'), changed = vi.fn(); manager.onDidChangeRepositories(changed);
    expect(await manager.addDirectory(root)).toMatchObject({ found: 2, added: 2, existing: 0, cancelled: false });
    expect(changed).toHaveBeenCalledTimes(1); expect(globalUpdate.mock.calls.filter(([key])=>key==='alwaygit.repositoryRoots.v1')).toHaveLength(1);
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

  it('reconciles additions, removals and groups changed by another window', async () => {
    const root = await fixture(), shared = new Map<string, unknown>(), first = setup(shared).manager, second = setup(shared).manager;
    await first.addDirectory(root);
    await second.synchronizeSharedState();
    expect(second.groups().map(group => group.name).sort()).toEqual(['A', 'B']);
    const group = first.groups().find(item => item.name === 'A')!, collection = await first.createCollection('Client');
    await first.move([group.key], collection.id);
    await second.synchronizeSharedState();
    expect(second.groups().find(item => item.name === 'A')?.collectionId).toBe(collection.id);
    await first.remove([group.key]);
    await second.synchronizeSharedState();
    expect(second.groups().map(item => item.name)).toEqual(['B']);
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
    const assigned=manager.groups().filter(group=>group.collectionId===collection.id),roots=manager.groups().filter(group=>!group.collectionId);
    expect(roots.map(group=>group.name)).toEqual(['B']);
    expect(assigned.map(group=>group.name)).toEqual(['A']);
    expect(manager.collections().map(item=>item.name)).toEqual(['Client Project']);
    expect(globalValues.get('alwaygit.repositoryCollectionAssignments.v1')).toMatchObject({[groups[0].key]:collection.id});
    await manager.deleteCollection(collection.id);
    expect(manager.groups().map(group=>group.name).sort()).toEqual(['A','B']);
  });

  it('persists mixed root order, appends additions, and reorders only siblings across restarts', async () => {
    const root=await fixture(), shared=new Map<string,unknown>(), {manager}=setup(shared);
    const b=await manager.add(path.join(root,'category/B')),a=await manager.add(path.join(root,'A')),bk=repositoryOrderKey(manager.groups().find(group=>group.name==='B')!.key),ak=repositoryOrderKey(manager.groups().find(group=>group.name==='A')!.key);
    const collection=await manager.createCollection('Other'),ck=collectionOrderKey(collection.id);
    expect(manager.order().root).toEqual([bk,ak,ck]);
    await manager.reorder({key:ck,targetKey:bk,position:'before'});
    await manager.renameCollection(collection.id,'Renamed');
    expect(manager.order().root).toEqual([ck,bk,ak]);
    const restored=setup(shared).manager;await restored.scan();expect(restored.order()).toEqual(manager.order());
    await manager.move([manager.groups().find(group=>group.name==='B')!.key],collection.id);
    await expect(manager.reorder({key:bk,targetKey:ak,position:'after'})).rejects.toThrow('same level');
    await manager.move([manager.groups().find(group=>group.name==='A')!.key],collection.id);
    expect(manager.order().collections[collection.id]).toEqual([bk,ak]);
    await manager.reorder({key:ak,targetKey:bk,position:'before'});
    await manager.deleteCollection(collection.id);expect(manager.order()).toEqual({root:[ak,bk],collections:{}});
    await manager.remove([manager.groups().find(group=>group.name==='A')!.key]);
    await manager.add(a.root);expect(manager.order().root).toEqual([bk,ak]);
    expect(manager.get(b.id).root).toBe(b.root);
  });
  it('migrates legacy roots without losing creation order or unavailable saved positions', async () => {
    const root=await fixture(),{manager,globalValues}=setup();
    globalValues.set('alwaygit.repositoryRoots.v1',[path.join(root,'category/B'),path.join(root,'A')]);
    globalValues.set('alwaygit.repositoryCollections.v1',[{id:'z',name:'Zulu'},{id:'a',name:'Alpha'}]);
    await manager.scan();const keys=manager.groups().sort((a,b)=>a.name.localeCompare(b.name)).map(group=>repositoryOrderKey(group.key));
    expect(manager.order().root).toEqual([...keys,'collection:z','collection:a']);
    const store = new CatalogStore(storage.get(globalValues)!, () => { throw new Error('Already migrated'); });
    await store.transaction(catalog => { catalog.order={root:['repository:unavailable',...manager.order().root],collections:{z:[],a:[]}}; });
    await manager.scan();expect(manager.order().root[0]).toBe('repository:unavailable');
  });

  it('does not scan or register in an untrusted workspace', async () => {
    const { manager, git, globalUpdate } = setup(), discover = vi.spyOn(git, 'discover');
    Object.assign(vscode.workspace, { isTrusted: false });
    await expect(manager.addDirectory('unused')).rejects.toThrow('Trust');
    expect(discover).not.toHaveBeenCalled(); expect(globalUpdate).not.toHaveBeenCalled();
  });
});

describe('repository scan coordination',()=>{
  function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
  function repository(name:string):Repository{const root=path.resolve(`scan-${name}`);return{id:name,root,commonDir:path.join(root,'.git'),gitDir:path.join(root,'.git'),name};}
  it('shares one discovery flight across simultaneous scans',async()=>{
    const {manager,git}=setup(),repo=repository('one'),gate=deferred<Repository>(),entered=deferred<void>();
    Object.assign(vscode.workspace,{workspaceFolders:[{uri:{scheme:'file',fsPath:repo.root}}]});
    const discover=vi.spyOn(git,'discover').mockImplementation(async()=>{entered.resolve();return gate.promise;});
    const first=manager.scan(),second=manager.scan();expect(second).toBe(first);await entered.promise;gate.resolve(repo);await Promise.all([first,second]);
    expect(discover).toHaveBeenCalledOnce();expect(manager.list()).toEqual([repo]);
  });
  it('does not restore a repository removed while discovery is pending',async()=>{
    const {manager,git}=setup(),repo=repository('removed');const discover=vi.spyOn(git,'discover').mockResolvedValue(repo);await manager.add(repo.root);
    Object.assign(vscode.workspace,{workspaceFolders:[{uri:{scheme:'file',fsPath:repo.root}}]});
    const gate=deferred<Repository>(),entered=deferred<void>();discover.mockImplementationOnce(async()=>{entered.resolve();return gate.promise;});
    const scanning=manager.scan();await entered.promise;await manager.remove([manager.groups()[0].key]);gate.resolve(repo);await scanning;
    expect(manager.list()).toEqual([]);
  });
  it('discards results from an obsolete workspace root and reruns the shared flight',async()=>{
    const {manager,git}=setup(),oldRepo=repository('old'),newRepo=repository('new'),gate=deferred<Repository>(),entered=deferred<void>();
    Object.assign(vscode.workspace,{workspaceFolders:[{uri:{scheme:'file',fsPath:oldRepo.root}}]});
    const discover=vi.spyOn(git,'discover').mockResolvedValue(newRepo).mockImplementationOnce(async()=>{entered.resolve();return gate.promise;});
    const first=manager.scan();await entered.promise;Object.assign(vscode.workspace,{workspaceFolders:[{uri:{scheme:'file',fsPath:newRepo.root}}]});
    const following=manager.scan();expect(following).toBe(first);gate.resolve(oldRepo);await following;
    expect(discover).toHaveBeenCalledTimes(2);expect(manager.list()).toEqual([newRepo]);
  });
  it('keeps newly remembered repositories when catalog synchronization is invalidated by an add',async()=>{
    const {manager,git}=setup(),oldRepo=repository('existing'),added=repository('added'),gate=deferred<Repository>(),entered=deferred<void>();
    Object.assign(vscode.workspace,{workspaceFolders:[{uri:{scheme:'file',fsPath:oldRepo.root}}]});
    vi.spyOn(git,'discover').mockImplementation(async root=>root===added.root?added:oldRepo).mockImplementationOnce(async()=>{entered.resolve();return gate.promise;});
    const scanning=manager.synchronizeSharedState();await entered.promise;await manager.add(added.root);gate.resolve(oldRepo);await scanning;
    expect(manager.list().map(repo=>repo.id).sort()).toEqual([added.id,oldRepo.id].sort());
  });
  it('retains a remembered repository that is temporarily unavailable during synchronization',async()=>{
    const {manager,git}=setup(),repo=repository('unavailable'),discover=vi.spyOn(git,'discover').mockResolvedValue(repo);await manager.add(repo.root);
    discover.mockRejectedValue(new Error('temporarily unavailable'));await manager.synchronizeSharedState();expect(manager.list()).toEqual([repo]);
  });
  it('preserves another group move while removal waits for its compatibility mirror',async()=>{
    const {manager,git,globalUpdate}=setup(),a=repository('remove-A'),b=repository('move-B');
    vi.spyOn(git,'discover').mockImplementation(async root=>root===a.root?a:b);
    await manager.add(a.root);await manager.add(b.root);const collection=await manager.createCollection('Client');
    const entered=deferred<void>(),gate=deferred<void>();
    globalUpdate.mockImplementationOnce(async()=>{entered.resolve();await gate.promise;});
    const removing=manager.remove([manager.groups().find(group=>group.repository.id===a.id)!.key]);await entered.promise;
    await manager.move([manager.groups().find(group=>group.repository.id===b.id)!.key],collection.id);
    gate.resolve();await removing;
    expect(manager.groups()).toHaveLength(1);expect(manager.groups()[0].collectionId).toBe(collection.id);
    await manager.synchronizeSharedState();expect(manager.groups()[0].collectionId).toBe(collection.id);
  });
  it('reloads authoritative state despite stale Memento and discards a scan overtaken by another host removal',async()=>{
    const first=setup(),otherValues=new Map<string,unknown>();storage.set(otherValues,first.context.globalStorageUri.fsPath);
    const second=setup(otherValues),repo=repository('cross-host'),other=repository('other-host');
    vi.spyOn(first.git,'discover').mockImplementation(async root=>root===repo.root?repo:other);
    vi.spyOn(second.git,'discover').mockImplementation(async root=>root===repo.root?repo:other);
    await first.manager.add(repo.root);await second.manager.synchronizeSharedState();
    const gate=deferred<Repository>(),entered=deferred<void>();
    vi.mocked(first.git.discover).mockImplementationOnce(async()=>{entered.resolve();return gate.promise;});
    const scanning=first.manager.synchronizeSharedState();await entered.promise;
    await second.manager.remove([second.manager.groups()[0].key]);await second.manager.add(other.root);
    gate.resolve(repo);await scanning;
    expect(first.manager.list().map(item=>item.id)).toEqual([other.id]);
    expect(first.globalValues.get('alwaygit.excludedRepositories.v1')).toContain(path.join(repo.root,'.git').replace(/\\/g,'/').toLowerCase());
  });
  it('does not publish watcher removals on a failed catalog commit and treats mirror failures as committed success',async()=>{
    const {manager,git,globalUpdate}=setup(),repo=repository('save-failure');vi.spyOn(git,'discover').mockResolvedValue(repo);await manager.add(repo.root);
    const store=(manager as unknown as {catalog:CatalogStore}).catalog;
    const write=vi.spyOn(store as unknown as {write(catalog:unknown):Promise<void>},'write').mockRejectedValueOnce(new Error('disk full'));
    const changed=vi.fn();manager.onDidChangeRepositories(changed);
    await expect(manager.remove([manager.groups()[0].key])).rejects.toThrow('disk full');
    expect(manager.list()).toEqual([repo]);expect(changed).not.toHaveBeenCalled();write.mockRestore();
    globalUpdate.mockRejectedValue(new Error('Memento unavailable'));
    expect(await manager.remove([manager.groups()[0].key])).toBe(1);expect(manager.list()).toEqual([]);
    await manager.synchronizeSharedState();expect(manager.list()).toEqual([]);
  });
  it('imports a later legacy workspace once and keeps its removed Worktree group excluded',async()=>{
    const shared=new Map<string,unknown>(),first=setup(shared),removed=repository('legacy-removed'),later=repository('legacy-later');
    vi.spyOn(first.git,'discover').mockResolvedValue(removed);await first.manager.add(removed.root);await first.manager.remove([first.manager.groups()[0].key]);
    const second=setup(shared);Object.assign(second.context,{storageUri:{fsPath:path.join(second.context.globalStorageUri.fsPath,'workspace-later')}});
    second.values.set('alwaygit.roots',[removed.root,later.root]);
    vi.spyOn(second.git,'discover').mockImplementation(async root=>root===removed.root?removed:later);
    await second.manager.scan();expect(second.manager.list()).toEqual([later]);
    expect(shared.get('alwaygit.repositoryRoots.v1')).toEqual([later.root]);
    await second.manager.remove([second.manager.groups()[0].key]);await second.manager.scan();expect(second.manager.list()).toEqual([]);
    expect(shared.get('alwaygit.repositoryRoots.v1')).toEqual([]);
  });
  it('keeps a subsequent re-add registered while a removed catalog compatibility mirror is delayed',async()=>{
    const {manager,git,globalUpdate}=setup(),repo=repository('mirror-readd');vi.spyOn(git,'discover').mockResolvedValue(repo);await manager.add(repo.root);
    const entered=deferred<void>(),gate=deferred<void>();globalUpdate.mockImplementationOnce(async()=>{entered.resolve();await gate.promise;});
    const removing=manager.remove([manager.groups()[0].key]);await entered.promise;await manager.add(repo.root);gate.resolve();await removing;
    expect(manager.list()).toEqual([repo]);await manager.synchronizeSharedState();expect(manager.list()).toEqual([repo]);
    const store=(manager as unknown as {catalog:CatalogStore}).catalog as unknown as {write(catalog:unknown):Promise<void>};
    const original=store.write.bind(store),diskEntered=deferred<void>(),diskGate=deferred<void>();
    const write=vi.spyOn(store,'write').mockImplementationOnce(async catalog=>{diskEntered.resolve();await diskGate.promise;await original(catalog);});
    const pendingRemove=manager.remove([manager.groups()[0].key]);await diskEntered.promise;const pendingAdd=manager.add(repo.root);diskGate.resolve();
    await Promise.all([pendingRemove,pendingAdd]);write.mockRestore();expect(manager.list()).toEqual([repo]);
  });
});

describe('Add Repository host entry', () => {
  function workbench() {
    const { manager, context, git, output } = setup();
    const projects={notifyCatalogChanged:vi.fn(async()=>{}),runRepositoryOperation:vi.fn(async(_commonDir:string,_label:string,task:()=>Promise<unknown>)=>task())};
    const value = new Workbench(context, git, manager, {} as never, output, projects as never); workbenches.push(value); return { value, manager, output, projects };
  }
  it('discovers candidates without registration and adds only the confirmed keys', async () => {
    const root = await fixture(), { value, manager, projects } = workbench();
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: root }] as vscode.Uri[]);
    expect(await value.handle({id:'pick',method:'pickRepositoryDirectory'})).toBe(root);
    const preview=await value.handle({id:'discover',method:'discoverRepositories',payload:{scanId:'scan-1',path:root}}) as {candidates:{key:string;existing:boolean}[]};
    expect(preview.candidates).toHaveLength(2);expect(preview.candidates.every(candidate=>!candidate.existing)).toBe(true);
    expect(manager.list()).toEqual([]);
    expect(await value.handle({id:'add',method:'addRepository',payload:{scanId:'scan-1',keys:preview.candidates.map(candidate=>candidate.key)}})).toEqual({added:2,existing:0,skipped:0});
    expect(manager.list()).toHaveLength(2);
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();expect(vscode.window.withProgress).not.toHaveBeenCalled();
    expect(projects.notifyCatalogChanged).toHaveBeenCalledTimes(1);
    const store=(manager as unknown as {catalog:CatalogStore}).catalog,revision=store.snapshot().revision;
    const existing=await value.discoverRepositories('scan-existing',root);
    const result=await value.addRepository('scan-existing',existing.candidates.map(item=>item.key),undefined,'Client');
    expect(result).toMatchObject({added:0,existing:2,skipped:0,collection:{name:'Client'}});
    expect(result.collection).toEqual(manager.collections()[0]);expect(store.snapshot().revision).toBe(revision+1);
    expect(manager.groups().every(group=>group.collectionId===result.collection?.id)).toBe(true);
    const changed=vi.fn();manager.onDidChangeRepositories(changed);
    const regroup=await value.discoverRepositories('scan-root',root);
    await value.addRepository('scan-root',regroup.candidates.map(item=>item.key),undefined,undefined);
    expect(manager.groups().every(group=>!group.collectionId)).toBe(true);expect(changed).toHaveBeenCalledOnce();
    expect(projects.notifyCatalogChanged).toHaveBeenCalledTimes(3);
  });

  it('creates an empty group from a validated page form without native input or discovery', async () => {
    const {value,manager,projects}=workbench();
    const collection=await value.handle({id:'create',method:'createRepositoryCollection',payload:{name:'  Other  '}}) as {id:string;name:string};
    expect(collection.name).toBe('Other');expect(manager.collections()).toEqual([collection]);expect(manager.list()).toEqual([]);
    expect(manager.order().root).toEqual([collectionOrderKey(collection.id)]);
    expect(projects.notifyCatalogChanged).toHaveBeenCalledTimes(1);
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();expect(vscode.window.showOpenDialog).not.toHaveBeenCalled();expect(vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled();
    await expect(value.handle({id:'duplicate',method:'createRepositoryCollection',payload:{name:'other'}})).rejects.toThrow('同名');
    for(const payload of [undefined,{name:'  '},{name:'x'.repeat(81)}])await expect(value.handle({id:'invalid',method:'createRepositoryCollection',payload})).rejects.toThrow();
    expect(manager.collections()).toHaveLength(1);expect(projects.notifyCatalogChanged).toHaveBeenCalledTimes(1);
  });

  it('does not register scan results when the embedded review is closed', async () => {
    const root=await fixture(),{value,manager}=workbench();
    const preview=await value.discoverRepositories('scan-close',root);
    expect(preview.candidates).toHaveLength(2);value.cancelRepositoryDiscovery('scan-close');
    expect(manager.list()).toEqual([]);
    expect(vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled();
  });

  it('removes host-validated repositories after the embedded confirmation', async () => {
    const root=await fixture(),{value,manager}=workbench();
    await manager.addDirectory(root);const group=manager.groups()[0];
    expect(await value.handle({id:'remove',method:'removeRepositories',payload:{keys:[group.key]}})).toBe(1);
    expect(manager.groups().some(item=>item.key===group.key)).toBe(false);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('reports no repositories and a damaged repository without silently succeeding', async () => {
    const root = await fixture(), { value, output } = workbench();
    const empty = path.join(root, 'empty'); await mkdir(empty);
    expect((await value.discoverRepositories('scan-empty',empty)).candidates).toEqual([]);
    await writeFile(path.join(empty, '.git'), 'invalid gitfile');
    const damaged=await value.discoverRepositories('scan-damaged',empty);expect(damaged.candidates).toEqual([]);expect(damaged.issues).toHaveLength(1);expect(path.basename(damaged.issues[0].path)).toBe('empty');
    expect(output.appendLine).toHaveBeenCalledTimes(1);
  });

  it('does not scan when the folder picker is dismissed and cancels an active embedded scan', async () => {
    const { value, manager } = workbench(), add = vi.spyOn(manager, 'discoverDirectory');
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined);
    expect(await value.pickRepositoryDirectory()).toBeUndefined(); expect(add).not.toHaveBeenCalled();
    const root = await fixture();
    const scanning=value.discoverRepositories('scan-cancel',root);value.cancelRepositoryDiscovery('scan-cancel');
    expect(await scanning).toMatchObject({cancelled:true,candidates:[]});expect(manager.list()).toEqual([]);
  });
});
