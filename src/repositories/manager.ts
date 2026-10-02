import * as vscode from 'vscode';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GitServiceContract, Repository, RepositoryChanges, RepositoryCollection, RepositoryOrder, ReorderRepository } from '../protocol/types';
import { collectionOrderKey, repositoryOrderKey, reconcileRepositoryOrder, forgetRepositoryOrderKeys } from '../protocol/repository-order';
import { groupRepositories, pathKey, repositoryGroupKey } from '../protocol/repositories';
import { discoverRepositories, type DiscoveryOptions, type DiscoveryResult } from './discovery';

export interface AddDirectoryResult extends DiscoveryResult { added: number; existing: number }

const GLOBAL_ROOTS_KEY = 'alwaygit.repositoryRoots.v1';
const GLOBAL_EXCLUDED_KEY = 'alwaygit.excludedRepositories.v1';
const GLOBAL_COLLECTIONS_KEY = 'alwaygit.repositoryCollections.v1';
const GLOBAL_COLLECTION_ASSIGNMENTS_KEY = 'alwaygit.repositoryCollectionAssignments.v1';
const GLOBAL_ORDER_KEY = 'alwaygit.repositoryOrder.v1';
const LEGACY_WORKSPACE_ROOTS_KEY = 'alwaygit.roots';

export class RepositoryManager implements vscode.Disposable {
  private readonly repositories = new Map<string, Repository>();
  private readonly watchers = new Map<string, vscode.Disposable[]>();
  private readonly commonWatchers = new Map<string, { ids: Set<string>; disposables: vscode.Disposable[] }>();
  private readonly removedGroups = new Set<string>();
  private scanFlight?: Promise<void>;
  private scanGeneration = 0;
  private scanDirty = false;
  private scanSynchronizing = false;
  private scanWorkspace = '';
  private disposed = false;
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
  order(): RepositoryOrder { return reconcileRepositoryOrder(this.groups(), this.collections(), this.context.globalState.get<RepositoryOrder>(GLOBAL_ORDER_KEY)); }
  private async saveOrder(order = this.order()): Promise<void> {
    const next = reconcileRepositoryOrder(this.groups(), this.collections(), order);
    if (JSON.stringify(next) !== JSON.stringify(this.context.globalState.get(GLOBAL_ORDER_KEY))) await this.context.globalState.update(GLOBAL_ORDER_KEY, next);
  }
  async reorder({ key, targetKey, position }: ReorderRepository): Promise<void> {
    const collections = this.collections(), ids = new Set(collections.map(collection => collection.id));
    const parents = new Map<string, string | undefined>(collections.map(collection => [collectionOrderKey(collection.id), undefined]));
    for (const group of this.groups()) parents.set(repositoryOrderKey(group.key), group.collectionId && ids.has(group.collectionId) ? group.collectionId : undefined);
    if (!parents.has(key) || !parents.has(targetKey)) throw new Error('The repository or group no longer exists.');
    if (parents.get(key) !== parents.get(targetKey)) throw new Error('Reorder items within the same level.');
    if (key === targetKey) return;
    const order = this.order(), parent = parents.get(key), entries = parent ? order.collections[parent] : order.root;
    const next = entries.filter(entry => entry !== key), target = next.indexOf(targetKey);
    next.splice(target + Number(position === 'after'), 0, key);
    if (parent) order.collections[parent] = next; else order.root = next;
    await this.saveOrder(order); this.listEmitter.fire();
  }
  get(id: string | undefined): Repository {
    const repo = id && this.repositories.get(id);
    if (!repo) throw new Error('Select a registered repository first.');
    return repo;
  }
  async add(root: string, remember = true): Promise<Repository> {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before executing Git.');
    this.invalidateScan();
    const repo = await this.git.discover(root);
    const order = this.order(), registered = this.register(repo);
    if (remember) { await this.remember([repo.root]); await this.include([repositoryGroupKey(repo)]); }
    await this.saveOrder(order);
    this.invalidateScan();
    if (registered) this.listEmitter.fire();
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
    for (const key of keys) { this.removedGroups.delete(key); changed = excluded.delete(key) || changed; }
    if (changed) await this.context.globalState.update(GLOBAL_EXCLUDED_KEY, [...excluded]);
  }
  private register(repo: Repository): boolean {
    if (this.disposed) return false;
    const previous = this.repositories.get(repo.id);
    if (previous && (pathKey(previous.root) !== pathKey(repo.root) || pathKey(previous.commonDir) !== pathKey(repo.commonDir) || pathKey(previous.gitDir ?? previous.commonDir) !== pathKey(repo.gitDir ?? repo.commonDir))) this.unregister(repo.id);
    if (!this.repositories.has(repo.id)) {
      const disposables: vscode.Disposable[] = [];
      const listen = (base: string, pattern: string) => {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, pattern));
        disposables.push(watcher);
        const notify = (uri: vscode.Uri) => {
          if (/[\\/](node_modules|\.git)([\\/]|$)/.test(uri.fsPath)) return;
          const relative = path.relative(repo.root, uri.fsPath).replace(/\\/g, '/');
          this.notify(repo.id, { paths: [relative] });
        };
        for (const event of [watcher.onDidChange, watcher.onDidCreate, watcher.onDidDelete]) disposables.push(event(notify));
      };
      try {
        listen(repo.root, '**/*');
        this.attachCommonWatcher(repo);
      } catch (error) { for (const disposable of disposables) disposable.dispose(); throw error; }
      this.watchers.set(repo.id, disposables);
      this.repositories.set(repo.id, repo);
      return true;
    }
    return false;
  }
  private attachCommonWatcher(repo: Repository): void {
    const key=pathKey(path.resolve(repo.commonDir)), existing=this.commonWatchers.get(key);
    if(existing){existing.ids.add(repo.id);return;}
    const entry={ids:new Set([repo.id]),disposables:[] as vscode.Disposable[]};
    try{
      const watcher=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(repo.commonDir,'{HEAD,index,packed-refs,refs/**,worktrees/**,MERGE_HEAD,CHERRY_PICK_HEAD,REVERT_HEAD,rebase-merge/**,rebase-apply/**,sequencer/**}'));
      entry.disposables.push(watcher);
      const notify=(uri:vscode.Uri)=>{
        const relative=path.relative(repo.commonDir,uri.fsPath).replace(/\\/g,'/');
        const privateMetadata=(value:string)=>/^(?:HEAD|index|MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD)$/.test(value)||/^(?:rebase-merge|rebase-apply|sequencer)(?:\/|$)/.test(value);
        const shared=/^(?:packed-refs|refs(?:\/|$))/.test(relative)||/^worktrees(?:\/[^/]+)?(?:\/(?:gitdir|commondir|locked|prunable))?$/.test(relative);
        for(const id of entry.ids){
          const member=this.repositories.get(id);if(!member)continue;
          const memberDir=member.gitDir??(!member.mainRoot||pathKey(member.root)===pathKey(member.mainRoot)?member.commonDir:undefined);
          const local=memberDir&&path.relative(memberDir,uri.fsPath).replace(/\\/g,'/');
          if(shared||local&&privateMetadata(local))this.notify(id,{paths:[],index:local==='index'});
        }
      };
      for(const event of [watcher.onDidChange,watcher.onDidCreate,watcher.onDidDelete])entry.disposables.push(event(notify));
      this.commonWatchers.set(key,entry);
    }catch(error){for(const item of entry.disposables)item.dispose();throw error;}
  }
  private unregister(id: string): void {
    clearTimeout(this.timers.get(id)); this.timers.delete(id); this.pendingChanges.delete(id);
    for (const watcher of this.watchers.get(id) ?? []) watcher.dispose();
    const repo=this.repositories.get(id),key=repo&&pathKey(path.resolve(repo.commonDir)),shared=key&&this.commonWatchers.get(key);
    if(shared){shared.ids.delete(id);if(!shared.ids.size){for(const item of shared.disposables)item.dispose();this.commonWatchers.delete(key!);}}
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
    this.invalidateScan();
    const order = this.order(), existingGroups = new Set(this.groups().map(group => group.key)), successfulGroups = new Set<string>();
    let registered = false;
    const remembered: string[] = [];
    for (const repo of result.repositories) {
      try { if (this.register(repo)) registered = true; successfulGroups.add(repositoryGroupKey(repo)); remembered.push(repo.root); }
      catch (error) { result.issues.push({ path: repo.root, message: error instanceof Error ? error.message : String(error) }); }
    }
    for (const key of successfulGroups) { if (existingGroups.has(key)) result.existing++; else result.added++; }
    // Persist once and notify once, regardless of the number of discovered repositories.
    if (remembered.length) {
      try { await this.remember(remembered); await this.include(successfulGroups); await this.saveOrder(order); }
      finally { if (registered) this.listEmitter.fire(); }
    }
    this.invalidateScan();
    return result;
  }
  async remove(keys: Iterable<string>): Promise<number> {
    const removing = new Set(keys), groups = this.groups().filter(group => removing.has(group.key));
    if (!groups.length) return 0;
    this.invalidateScan();
    for(const group of groups)this.removedGroups.add(group.key);
    const order = forgetRepositoryOrderKeys(this.order(), new Set(groups.map(group => repositoryOrderKey(group.key))));
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
    await this.saveOrder(order);
    this.listEmitter.fire();
    return groups.length;
  }
  async createCollection(name: string): Promise<RepositoryCollection> {
    const normalized=name.trim();if(!normalized)throw new Error('Repository group name is required.');if(normalized.length>80)throw new Error('Repository group name is too long.');
    const collections=this.collections();if(collections.some(item=>item.name.localeCompare(normalized,undefined,{sensitivity:'accent'})===0))throw new Error('A repository group with this name already exists.');
    const order=this.order(),collection={id:randomUUID(),name:normalized};await this.context.globalState.update(GLOBAL_COLLECTIONS_KEY,[...collections,collection]);await this.saveOrder(order);this.listEmitter.fire();return collection;
  }
  async renameCollection(id: string, name: string): Promise<void> {
    const normalized=name.trim(),collections=this.collections();if(!normalized)throw new Error('Repository group name is required.');if(normalized.length>80)throw new Error('Repository group name is too long.');
    if(!collections.some(item=>item.id===id))throw new Error('Repository group no longer exists.');
    if(collections.some(item=>item.id!==id&&item.name.localeCompare(normalized,undefined,{sensitivity:'accent'})===0))throw new Error('A repository group with this name already exists.');
    await this.context.globalState.update(GLOBAL_COLLECTIONS_KEY,collections.map(item=>item.id===id?{...item,name:normalized}:item));this.listEmitter.fire();
  }
  async deleteCollection(id: string): Promise<void> {
    const collections=this.collections();if(!collections.some(item=>item.id===id))return;
    const order=this.order(),members=order.collections[id]??[];delete order.collections[id];order.root=order.root.filter(key=>key!==collectionOrderKey(id));order.root.push(...members);
    const assignments={...this.context.globalState.get<Record<string,string>>(GLOBAL_COLLECTION_ASSIGNMENTS_KEY,{})};for(const [key,value] of Object.entries(assignments))if(value===id)delete assignments[key];
    await this.context.globalState.update(GLOBAL_COLLECTIONS_KEY,collections.filter(item=>item.id!==id));await this.context.globalState.update(GLOBAL_COLLECTION_ASSIGNMENTS_KEY,assignments);await this.saveOrder(order);this.listEmitter.fire();
  }
  async move(keys: Iterable<string>, collectionId?: string): Promise<number> {
    if(collectionId&&!this.collections().some(item=>item.id===collectionId))throw new Error('Repository group no longer exists.');
    const order=this.order(),available=new Set(this.groups().map(group=>group.key)),assignments={...this.context.globalState.get<Record<string,string>>(GLOBAL_COLLECTION_ASSIGNMENTS_KEY,{})};let moved=0;
    for(const key of new Set(keys)){if(!available.has(key)||assignments[key]===collectionId)continue;if(collectionId)assignments[key]=collectionId;else delete assignments[key];moved++;}
    if(moved){await this.context.globalState.update(GLOBAL_COLLECTION_ASSIGNMENTS_KEY,assignments);await this.saveOrder(order);this.listEmitter.fire();}return moved;
  }
  private async discoveryRoots(): Promise<Set<string>> {
    const roots = await this.rememberedRoots();
    for (const folder of vscode.workspace.workspaceFolders ?? []) if (folder.uri.scheme === 'file') roots.add(folder.uri.fsPath);
    try {
      const ext = vscode.extensions.getExtension<{ getAPI(version: number): { repositories: { rootUri: vscode.Uri }[] } }>('vscode.git');
      const api = ext ? (await ext.activate()).getAPI(1) : undefined;
      for (const repo of api?.repositories ?? []) if (repo.rootUri.scheme === 'file') roots.add(repo.rootUri.fsPath);
    } catch { /* Git extension is optional. */ }
    return roots;
  }
  private workspaceKey(): string {return JSON.stringify((vscode.workspace.workspaceFolders??[]).filter(folder=>folder.uri.scheme==='file').map(folder=>pathKey(folder.uri.fsPath)).sort());}
  private rootsKey(roots:Set<string>):string{return JSON.stringify([...roots].map(pathKey).sort());}
  private invalidateScan():void{this.scanGeneration++;if(this.scanFlight)this.scanDirty=true;}
  scan(): Promise<void> { return this.scheduleScan(false); }
  /** Reconciles this extension host after another VS Code window changes the shared catalog. */
  synchronizeSharedState(): Promise<void> { return this.scheduleScan(true); }
  private scheduleScan(synchronize:boolean):Promise<void>{
    if(this.disposed||!vscode.workspace.isTrusted){if(synchronize&&!this.disposed)this.listEmitter.fire();return Promise.resolve();}
    if(this.scanFlight){
      if(synchronize||this.workspaceKey()!==this.scanWorkspace)this.invalidateScan();
      this.scanSynchronizing ||= synchronize;
      return this.scanFlight;
    }
    this.scanSynchronizing=synchronize;
    this.scanFlight=this.runScan().finally(()=>{this.scanFlight=undefined;this.scanSynchronizing=false;});
    return this.scanFlight;
  }
  private async runScan():Promise<void>{
    do{
      this.scanDirty=false;
      const generation=this.scanGeneration;this.scanWorkspace=this.workspaceKey();
      const roots=await this.discoveryRoots(),desiredRoots=new Set([...roots].map(pathKey)),discovered:Repository[]=[];
      for(const root of roots){
        if(this.disposed||generation!==this.scanGeneration)break;
        try{const repo=await this.git.discover(root);if(generation===this.scanGeneration&&!this.disposed){discovered.push(repo);desiredRoots.add(pathKey(repo.root));}}
        catch(error){this.log.appendLine(`[discovery] ${root}: ${error instanceof Error?error.message:String(error)}`);}
      }
      if(this.disposed)return;
      const currentRoots=await this.discoveryRoots();
      if(generation!==this.scanGeneration||this.workspaceKey()!==this.scanWorkspace||this.rootsKey(currentRoots)!==this.rootsKey(roots)){this.scanDirty=true;continue;}
      const excluded=new Set([...this.context.globalState.get<string[]>(GLOBAL_EXCLUDED_KEY,[]),...this.removedGroups]);
      for(const repo of discovered)if(!excluded.has(repositoryGroupKey(repo)))this.register(repo);
      if(this.scanSynchronizing)for(const repo of [...this.repositories.values()])if(excluded.has(repositoryGroupKey(repo))||!desiredRoots.has(pathKey(repo.root)))this.unregister(repo.id);
      await this.saveOrder();
      if(!this.disposed)this.listEmitter.fire();
    }while(this.scanDirty&&!this.disposed&&vscode.workspace.isTrusted);
  }
  notify(id: string, changes: RepositoryChanges = {}): void {
    if(this.disposed||!this.repositories.has(id))return;
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
    if(this.disposed)return;this.disposed=true;this.invalidateScan();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.pendingChanges.clear();
    for (const id of [...this.repositories.keys()]) this.unregister(id);
    this.changedEmitter.dispose(); this.listEmitter.dispose();
  }
}
