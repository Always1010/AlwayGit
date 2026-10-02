import * as vscode from 'vscode';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GitServiceContract, Repository, RepositoryChanges, RepositoryCollection } from '../protocol/types';
import { groupRepositories, pathKey, repositoryGroupKey } from '../protocol/repositories';
import { discoverRepositories, type DiscoveryOptions, type DiscoveryResult } from './discovery';

export interface AddDirectoryResult extends DiscoveryResult { added: number; existing: number }

const GLOBAL_ROOTS_KEY = 'alwaygit.repositoryRoots.v1';
const GLOBAL_EXCLUDED_KEY = 'alwaygit.excludedRepositories.v1';
const GLOBAL_COLLECTIONS_KEY = 'alwaygit.repositoryCollections.v1';
const GLOBAL_COLLECTION_ASSIGNMENTS_KEY = 'alwaygit.repositoryCollectionAssignments.v1';
const LEGACY_WORKSPACE_ROOTS_KEY = 'alwaygit.roots';

export class RepositoryManager implements vscode.Disposable {
  private readonly repositories = new Map<string, Repository>();
  private readonly watchers = new Map<string, vscode.Disposable[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingChanges = new Map<string, RepositoryChanges>();
  private readonly changedEmitter = new vscode.EventEmitter<{ repoId: string; changes: RepositoryChanges }>();
  private readonly listEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changedEmitter.event;
  readonly onDidChangeRepositories = this.listEmitter.event;
  constructor(private readonly git: GitServiceContract, private readonly context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel) {}
  list(): Repository[] {
    const assignments = this.context.globalState.get<Record<string, string>>(GLOBAL_COLLECTION_ASSIGNMENTS_KEY, {});
    return [...this.repositories.values()].map(repo => {
      const collectionId=assignments[repositoryGroupKey(repo)];
      return collectionId?{...repo,collectionId}:repo;
    });
  }
  groups() { return groupRepositories(this.list()); }
  collections(): RepositoryCollection[] { return this.context.globalState.get<RepositoryCollection[]>(GLOBAL_COLLECTIONS_KEY, []); }
  get(id: string | undefined): Repository {
    const repo = id && this.repositories.get(id);
    if (!repo) throw new Error('Select a registered repository first.');
    return repo;
  }
  async add(root: string, remember = true): Promise<Repository> {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before executing Git.');
    const repo = await this.git.discover(root);
    if (this.register(repo)) this.listEmitter.fire();
    if (remember) { await this.remember([repo.root]); await this.include([repositoryGroupKey(repo)]); }
    return repo;
  }
  async discoverDirectory(root: string, options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before executing Git.');
    return discoverRepositories(root, this.git, options);
  }
  private async rememberedRoots(): Promise<Set<string>> {
    const global = this.context.globalState.get<string[]>(GLOBAL_ROOTS_KEY, []);
    const legacy = this.context.workspaceState.get<string[]>(LEGACY_WORKSPACE_ROOTS_KEY, []);
    const roots = new Set([...global, ...legacy]);
    if (legacy.some(root => !global.includes(root))) await this.context.globalState.update(GLOBAL_ROOTS_KEY, [...roots]);
    return roots;
  }
  private async remember(roots: Iterable<string>): Promise<void> {
    const saved = new Set(this.context.globalState.get<string[]>(GLOBAL_ROOTS_KEY, []));
    for (const root of roots) saved.add(root);
    await this.context.globalState.update(GLOBAL_ROOTS_KEY, [...saved]);
  }
  private async include(keys: Iterable<string>): Promise<void> {
    const excluded = new Set(this.context.globalState.get<string[]>(GLOBAL_EXCLUDED_KEY, []));
    let changed = false;
    for (const key of keys) changed = excluded.delete(key) || changed;
    if (changed) await this.context.globalState.update(GLOBAL_EXCLUDED_KEY, [...excluded]);
  }
  private register(repo: Repository): boolean {
    if (!this.repositories.has(repo.id)) {
      const disposables: vscode.Disposable[] = [];
      const listen = (base: string, pattern: string, worktree: boolean) => {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, pattern));
        disposables.push(watcher);
        const notify = (uri: vscode.Uri) => {
          if (worktree && /[\\/](node_modules|\.git)[\\/]/.test(uri.fsPath)) return;
          const relative = path.relative(worktree ? repo.root : repo.commonDir, uri.fsPath).replace(/\\/g, '/');
          this.notify(repo.id, { paths: worktree ? [relative] : [], index: !worktree && /(^|\/)index$/.test(relative) });
        };
        for (const event of [watcher.onDidChange, watcher.onDidCreate, watcher.onDidDelete]) disposables.push(event(notify));
      };
      try {
        listen(repo.root, '**/*', true);
        listen(repo.commonDir, '{HEAD,index,packed-refs,refs/**,worktrees/**,MERGE_HEAD,CHERRY_PICK_HEAD,REVERT_HEAD,rebase-merge/**,rebase-apply/**,sequencer/**}', false);
      } catch (error) { for (const disposable of disposables) disposable.dispose(); throw error; }
      this.watchers.set(repo.id, disposables);
      this.repositories.set(repo.id, repo);
      return true;
    }
    return false;
  }
  private unregister(id: string): void {
    clearTimeout(this.timers.get(id)); this.timers.delete(id); this.pendingChanges.delete(id);
    for (const watcher of this.watchers.get(id) ?? []) watcher.dispose();
    this.watchers.delete(id); this.repositories.delete(id);
  }
  async addDirectory(root: string, options: DiscoveryOptions = {}): Promise<AddDirectoryResult> {
    const discovery = await this.discoverDirectory(root, options);
    return this.registerDiscovered(discovery, options);
  }
  async registerDiscovered(discovery: DiscoveryResult, options: Pick<DiscoveryOptions, 'isCancelled'> = {}): Promise<AddDirectoryResult> {
    const result: AddDirectoryResult = { ...discovery, added: 0, existing: 0 };
    if (result.cancelled || options.isCancelled?.()) { result.cancelled = true; return result; }
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before executing Git.');
    const existingGroups = new Set(this.groups().map(group => group.key)), successfulGroups = new Set<string>();
    let registered = false;
    const remembered: string[] = [];
    for (const repo of result.repositories) {
      try { if (this.register(repo)) registered = true; successfulGroups.add(repositoryGroupKey(repo)); remembered.push(repo.root); }
      catch (error) { result.issues.push({ path: repo.root, message: error instanceof Error ? error.message : String(error) }); }
    }
    for (const key of successfulGroups) { if (existingGroups.has(key)) result.existing++; else result.added++; }
    // Persist once and notify once, regardless of the number of discovered repositories.
    if (remembered.length) {
      try { await this.remember(remembered); await this.include(successfulGroups); }
      finally { if (registered) this.listEmitter.fire(); }
    }
    return result;
  }
  async remove(keys: Iterable<string>): Promise<number> {
    const removing = new Set(keys), groups = this.groups().filter(group => removing.has(group.key));
    if (!groups.length) return 0;
    const rootKeys = new Set(groups.flatMap(group => group.members.map(repo => pathKey(repo.root))));
    for (const group of groups) for (const repo of group.members) this.unregister(repo.id);
    const saved = this.context.globalState.get<string[]>(GLOBAL_ROOTS_KEY, []).filter(root => !rootKeys.has(pathKey(root)));
    const excluded = new Set(this.context.globalState.get<string[]>(GLOBAL_EXCLUDED_KEY, []));
    for (const group of groups) excluded.add(group.key);
    const assignments = { ...this.context.globalState.get<Record<string, string>>(GLOBAL_COLLECTION_ASSIGNMENTS_KEY, {}) };
    for (const group of groups) delete assignments[group.key];
    await this.context.globalState.update(GLOBAL_ROOTS_KEY, saved);
    await this.context.globalState.update(GLOBAL_EXCLUDED_KEY, [...excluded]);
    await this.context.globalState.update(GLOBAL_COLLECTION_ASSIGNMENTS_KEY, assignments);
    this.listEmitter.fire();
    return groups.length;
  }
  async createCollection(name: string): Promise<RepositoryCollection> {
    const normalized=name.trim();if(!normalized)throw new Error('Repository group name is required.');if(normalized.length>80)throw new Error('Repository group name is too long.');
    const collections=this.collections();if(collections.some(item=>item.name.localeCompare(normalized,undefined,{sensitivity:'accent'})===0))throw new Error('A repository group with this name already exists.');
    const collection={id:randomUUID(),name:normalized};await this.context.globalState.update(GLOBAL_COLLECTIONS_KEY,[...collections,collection]);this.listEmitter.fire();return collection;
  }
  async renameCollection(id: string, name: string): Promise<void> {
    const normalized=name.trim(),collections=this.collections();if(!normalized)throw new Error('Repository group name is required.');if(normalized.length>80)throw new Error('Repository group name is too long.');
    if(!collections.some(item=>item.id===id))throw new Error('Repository group no longer exists.');
    if(collections.some(item=>item.id!==id&&item.name.localeCompare(normalized,undefined,{sensitivity:'accent'})===0))throw new Error('A repository group with this name already exists.');
    await this.context.globalState.update(GLOBAL_COLLECTIONS_KEY,collections.map(item=>item.id===id?{...item,name:normalized}:item));this.listEmitter.fire();
  }
  async deleteCollection(id: string): Promise<void> {
    const collections=this.collections();if(!collections.some(item=>item.id===id))return;
    const assignments={...this.context.globalState.get<Record<string,string>>(GLOBAL_COLLECTION_ASSIGNMENTS_KEY,{})};for(const [key,value] of Object.entries(assignments))if(value===id)delete assignments[key];
    await this.context.globalState.update(GLOBAL_COLLECTIONS_KEY,collections.filter(item=>item.id!==id));await this.context.globalState.update(GLOBAL_COLLECTION_ASSIGNMENTS_KEY,assignments);this.listEmitter.fire();
  }
  async move(keys: Iterable<string>, collectionId?: string): Promise<number> {
    if(collectionId&&!this.collections().some(item=>item.id===collectionId))throw new Error('Repository group no longer exists.');
    const available=new Set(this.groups().map(group=>group.key)),assignments={...this.context.globalState.get<Record<string,string>>(GLOBAL_COLLECTION_ASSIGNMENTS_KEY,{})};let moved=0;
    for(const key of new Set(keys)){if(!available.has(key))continue;if(collectionId)assignments[key]=collectionId;else delete assignments[key];moved++;}
    if(moved){await this.context.globalState.update(GLOBAL_COLLECTION_ASSIGNMENTS_KEY,assignments);this.listEmitter.fire();}return moved;
  }
  async scan(): Promise<void> {
    if (!vscode.workspace.isTrusted) return;
    const roots = await this.rememberedRoots();
    const excluded = new Set(this.context.globalState.get<string[]>(GLOBAL_EXCLUDED_KEY, []));
    for (const folder of vscode.workspace.workspaceFolders ?? []) if (folder.uri.scheme === 'file') roots.add(folder.uri.fsPath);
    try {
      const ext = vscode.extensions.getExtension<{ getAPI(version: number): { repositories: { rootUri: vscode.Uri }[] } }>('vscode.git');
      const api = ext ? (await ext.activate()).getAPI(1) : undefined;
      for (const repo of api?.repositories ?? []) if (repo.rootUri.scheme === 'file') roots.add(repo.rootUri.fsPath);
    } catch { /* Git extension is optional. */ }
    for (const root of roots) {
      try {
        const repo = await this.git.discover(root);
        if (!excluded.has(repositoryGroupKey(repo)) && this.register(repo)) this.listEmitter.fire();
      }
      catch (error) { this.log.appendLine(`[discovery] ${root}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  notify(id: string, changes: RepositoryChanges = {}): void {
    clearTimeout(this.timers.get(id));
    const previous = this.pendingChanges.get(id);
    this.pendingChanges.set(id, !previous ? changes : !previous.paths || !changes.paths ? {} : { paths: [...new Set([...previous.paths, ...changes.paths])], index: !!(previous.index || changes.index) });
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id);
      const pending = this.pendingChanges.get(id)!;
      this.pendingChanges.delete(id);
      this.changedEmitter.fire({ repoId: id, changes: pending });
    }, 300));
  }
  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.pendingChanges.clear();
    for (const items of this.watchers.values()) for (const item of items) item.dispose();
    this.changedEmitter.dispose(); this.listEmitter.dispose();
  }
}

export type RepositoryTreeNode = Repository | { id:string; name:string; collection:RepositoryCollection };

export class RepositoryTree implements vscode.TreeDataProvider<RepositoryTreeNode> {
  private readonly emitter = new vscode.EventEmitter<RepositoryTreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  constructor(private readonly manager: RepositoryManager) {}
  refresh(): void { this.emitter.fire(undefined); }
  getChildren(parent?:RepositoryTreeNode): RepositoryTreeNode[] {
    const groups=this.manager.groups();
    if(parent&&'collection' in parent)return groups.filter(group=>group.collectionId===parent.collection.id).map(group=>({...group.repository,name:group.name}));
    const collections=this.manager.collections().map(collection=>({id:collection.id,name:collection.name,collection}));
    const roots=groups.filter(group=>!group.collectionId||!this.manager.collections().some(collection=>collection.id===group.collectionId)).map(group=>({...group.repository,name:group.name}));
    return [...collections,...roots].sort((a,b)=>a.name.localeCompare(b.name));
  }
  getTreeItem(node: RepositoryTreeNode): vscode.TreeItem {
    if('collection' in node){const item=new vscode.TreeItem(node.name,vscode.TreeItemCollapsibleState.Collapsed);item.contextValue='alwaygit.repositoryCollection';item.iconPath=new vscode.ThemeIcon('folder');item.tooltip=node.name;return item;}
    const item = new vscode.TreeItem(node.name);
    item.contextValue = 'alwaygit.repository';
    item.description = node.root; item.tooltip = node.root;
    item.iconPath = new vscode.ThemeIcon('repo');
    item.command = { command: 'alwaygit.open', title: 'Open Workbench', arguments: [node.id] };
    return item;
  }
}
