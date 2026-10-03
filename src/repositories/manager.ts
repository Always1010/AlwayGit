import { message as localizeMessage, MessageError, translate } from '../i18n/index';
import * as vscode from 'vscode';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GitServiceContract, Repository, RepositoryChanges, RepositoryCollection, RepositoryOrder, ReorderRepository } from '../protocol/types';
import { collectionOrderKey, repositoryOrderKey, reconcileRepositoryOrder, forgetRepositoryOrderKeys } from '../protocol/repository-order';
import { groupRepositories, pathKey, repositoryGroupKey } from '../protocol/repositories';
import { discoverRepositories, type DiscoveryOptions, type DiscoveryResult } from './discovery';
import { CatalogStore, type RepositoryCatalog } from './catalog-store';

export interface AddDirectoryResult extends DiscoveryResult { added: number; existing: number; collection?: RepositoryCollection }

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
  private readonly catalog: CatalogStore;
  private mutationQueue: Promise<unknown> = Promise.resolve();
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
  constructor(private readonly git: GitServiceContract, private readonly context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel) {
    this.catalog = new CatalogStore(context.globalStorageUri.fsPath, () => {
      const exclusions = context.globalState.get<string[]>(GLOBAL_EXCLUDED_KEY, []);
      const roots = [...new Set(context.globalState.get<string[]>(GLOBAL_ROOTS_KEY, []))]
        .filter(root => !exclusions.includes(pathKey(path.join(root, '.git'))));
      return { schemaVersion: 1, revision: 0, roots, exclusions,
        collections: context.globalState.get<RepositoryCollection[]>(GLOBAL_COLLECTIONS_KEY, []),
        assignments: context.globalState.get<Record<string, string>>(GLOBAL_COLLECTION_ASSIGNMENTS_KEY, {}),
        order: context.globalState.get<RepositoryOrder>(GLOBAL_ORDER_KEY) };
    });
  }
  list(): Repository[] {
    const assignments = this.catalog.snapshot().assignments;
    return [...this.repositories.values()].map(repo => {
      const collectionId=assignments[repositoryGroupKey(repo)];
      return collectionId?{...repo,collectionId}:repo;
    });
  }
  groups() { return groupRepositories(this.list()); }
  collections(): RepositoryCollection[] { return this.catalog.snapshot().collections; }
  order(): RepositoryOrder { return this.catalogOrder(this.catalog.snapshot()); }
  private catalogOrder(catalog: RepositoryCatalog, additional: Repository[] = []): RepositoryOrder {
    const excluded = new Set(catalog.exclusions);
    const groups = groupRepositories([...this.repositories.values(), ...additional].filter(repo => !excluded.has(repositoryGroupKey(repo)))
      .map(repo => ({ ...repo, collectionId: catalog.assignments[repositoryGroupKey(repo)] })));
    // Include saved but locally unavailable groups so another window's assignments/order survive reconciliation.
    const known = new Set(groups.map(group => group.key));
    const keys = new Set([...Object.keys(catalog.assignments), ...(catalog.order?.root ?? []), ...Object.values(catalog.order?.collections ?? {}).flat()]
      .map(key => key.startsWith('repository:') ? key.slice(11) : key).filter(key => !key.startsWith('collection:')));
    for (const key of keys) if (!known.has(key) && !excluded.has(key)) {
      const repo = { id: key, root: key, commonDir: key, name: key };
      groups.push({ key, name: key, repository: repo, members: [repo], collectionId: catalog.assignments[key] });
    }
    return reconcileRepositoryOrder(groups, catalog.collections, catalog.order);
  }
  private async mutate<T>(reduce: (catalog: RepositoryCatalog) => T, publish?: (result: T) => void, prepare?: () => void): Promise<T> {
    const operation = this.mutationQueue.then(async () => {
      prepare?.();
      const before = this.catalog.snapshot(), result = await this.catalog.transaction(reduce), after = this.catalog.snapshot();
      publish?.(result); return { before, result, after };
    });
    this.mutationQueue = operation.catch(() => {});
    const { before, result, after } = await operation;
    // Mirrors and broadcasts run outside the catalog gate. A mirror failure must not suggest retrying a committed command.
    for (const [key, previous, value] of [
      [GLOBAL_ROOTS_KEY, before.roots, after.roots], [GLOBAL_EXCLUDED_KEY, before.exclusions, after.exclusions],
      [GLOBAL_COLLECTIONS_KEY, before.collections, after.collections], [GLOBAL_COLLECTION_ASSIGNMENTS_KEY, before.assignments, after.assignments],
      [GLOBAL_ORDER_KEY, before.order, after.order],
    ] as const) if (JSON.stringify(previous) !== JSON.stringify(value)) {
      try { await this.context.globalState.update(key, value); }
      catch (error) { try { this.log.appendLine(`[catalog mirror] ${String(error)}`); } catch { /* A disposed output channel must not fail a committed command. */ } }
    }
    return result;
  }
  async reorder({ key, targetKey, position }: ReorderRepository): Promise<void> {
    await this.mutate(catalog => {
    const collections = catalog.collections, ids = new Set(collections.map(collection => collection.id));
    const parents = new Map<string, string | undefined>(collections.map(collection => [collectionOrderKey(collection.id), undefined]));
    for (const group of this.groups()) if (!catalog.exclusions.includes(group.key)) parents.set(repositoryOrderKey(group.key), catalog.assignments[group.key] && ids.has(catalog.assignments[group.key]) ? catalog.assignments[group.key] : undefined);
    if (!parents.has(key) || !parents.has(targetKey)) throw new MessageError(localizeMessage("manager.theRepositoryOrGroupNoLongerExists"));
    if (parents.get(key) !== parents.get(targetKey)) throw new MessageError(localizeMessage("manager.reorderItemsWithinTheSameLevel"));
    if (key === targetKey) return;
    const order = this.catalogOrder(catalog), parent = parents.get(key), entries = parent ? order.collections[parent] : order.root;
    const next = entries.filter(entry => entry !== key), target = next.indexOf(targetKey);
    next.splice(target + Number(position === 'after'), 0, key);
    if (parent) order.collections[parent] = next; else order.root = next;
    catalog.order = order;
    }); this.listEmitter.fire();
  }
  get(id: string | undefined): Repository {
    const repo = id && this.repositories.get(id);
    if (!repo) throw new MessageError(localizeMessage("manager.selectARegisteredRepositoryFirst"));
    return repo;
  }
  async add(root: string, remember = true): Promise<Repository> {
    if (!vscode.workspace.isTrusted) throw new MessageError(localizeMessage("manager.trustThisWorkspaceBeforeExecutingGit"));
    this.invalidateScan();
    const repo = await this.git.discover(root);
    let prepared: ReturnType<RepositoryManager['prepareRegistration']> | undefined;
    let registered = false;
    try { await this.mutate(catalog => {
      if (remember) {
        if (!catalog.roots.some(root => pathKey(root) === pathKey(repo.root))) catalog.roots.push(repo.root);
        catalog.exclusions = catalog.exclusions.filter(key => key !== repositoryGroupKey(repo));
      }
      catalog.order = this.catalogOrder(catalog, [repo]);
    }, () => { registered = prepared!.apply(); }, () => { prepared = this.prepareRegistration(repo); }); } catch (error) { prepared?.dispose(); throw error; }
    this.invalidateScan();
    if (registered) this.listEmitter.fire();
    return repo;
  }
  async discoverDirectory(root: string, options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
    if (!vscode.workspace.isTrusted) throw new MessageError(localizeMessage("manager.trustThisWorkspaceBeforeExecutingGit"));
    return discoverRepositories(root, this.git, options);
  }
  private async rememberedRoots(): Promise<Set<string>> {
    await this.mutate(() => {});
    const workspace = this.context.storageUri?.fsPath ?? this.workspaceKey();
    if (!this.catalog.snapshot().importedWorkspaces?.includes(workspace)) {
      const legacy = this.context.workspaceState.get<string[]>(LEGACY_WORKSPACE_ROOTS_KEY, []);
      // Resolve group identities outside the gate, then check the current exclusions inside it.
      const candidates: { root: string; key: string }[] = [];
      for (const root of legacy) {
        let key = pathKey(path.join(root, '.git'));
        try { key = repositoryGroupKey(await this.git.discover(root)); } catch { /* Preserve unavailable legacy roots for a later scan. */ }
        candidates.push({ root, key });
      }
      await this.mutate(catalog => {
        if (catalog.importedWorkspaces?.includes(workspace)) return;
        for (const { root, key } of candidates) if (!catalog.exclusions.includes(key) && !catalog.roots.some(saved => pathKey(saved) === pathKey(root))) catalog.roots.push(root);
        catalog.importedWorkspaces = [...(catalog.importedWorkspaces ?? []), workspace];
      });
    }
    return new Set(this.catalog.snapshot().roots);
  }
  private prepareRegistration(repo: Repository): { apply(): boolean; dispose(): void } {
    const empty = { apply: () => false, dispose: () => {} };
    if (this.disposed) return empty;
    const previous = this.repositories.get(repo.id);
    const replacement = previous && (pathKey(previous.root) !== pathKey(repo.root) || pathKey(previous.commonDir) !== pathKey(repo.commonDir) || pathKey(previous.gitDir ?? previous.commonDir) !== pathKey(repo.gitDir ?? repo.commonDir));
    if (!previous || replacement) {
      const disposables: vscode.Disposable[] = [];
      const commonKey = pathKey(path.resolve(repo.commonDir));
      let preparedCommon: { ids: Set<string>; disposables: vscode.Disposable[] } | undefined;
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
        const common = this.commonWatchers.get(commonKey);
        if (!common || replacement && common.ids.size === 1 && common.ids.has(repo.id)) preparedCommon = this.createCommonWatcher(repo);
      } catch (error) { for (const disposable of disposables) disposable.dispose(); throw error; }
      let applied = false;
      const dispose = () => { if (!applied) { for (const item of disposables) item.dispose(); for (const item of preparedCommon?.disposables ?? []) item.dispose(); } };
      return { dispose, apply: () => {
        if (this.disposed) { dispose(); return false; }
        const latest = this.repositories.get(repo.id);
        if (latest && pathKey(latest.root) === pathKey(repo.root) && pathKey(latest.commonDir) === pathKey(repo.commonDir) && pathKey(latest.gitDir ?? latest.commonDir) === pathKey(repo.gitDir ?? repo.commonDir)) { dispose(); return false; }
        if (latest) this.unregister(repo.id);
        let common = this.commonWatchers.get(commonKey);
        if (!common) { common = preparedCommon!; this.commonWatchers.set(commonKey, common); }
        else for (const item of preparedCommon?.disposables ?? []) item.dispose();
        common.ids.add(repo.id);
        applied = true; this.watchers.set(repo.id, disposables); this.repositories.set(repo.id, repo); return true;
      } };
    }
    return empty;
  }
  private register(repo: Repository): boolean { return this.prepareRegistration(repo).apply(); }
  private createCommonWatcher(repo: Repository): { ids: Set<string>; disposables: vscode.Disposable[] } {
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
      return entry;
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
  async registerDiscovered(discovery: DiscoveryResult, options: Pick<DiscoveryOptions, 'isCancelled'> = {}, destination: { collectionId?: string; newCollectionName?: string } = {}): Promise<AddDirectoryResult> {
    const result: AddDirectoryResult = { ...discovery, issues: [...discovery.issues], added: 0, existing: 0 };
    if (result.cancelled || options.isCancelled?.()) { result.cancelled = true; return result; }
    if (!vscode.workspace.isTrusted) throw new MessageError(localizeMessage("manager.trustThisWorkspaceBeforeExecutingGit"));
    this.invalidateScan();
    const existingGroups = new Set(this.groups().map(group => group.key));
    let registered = false;
    let assignmentChanged = false;
    let createdCollection: RepositoryCollection | undefined;
    const prepared: { repo: Repository; registration: ReturnType<RepositoryManager['prepareRegistration']> }[] = [];
    try {
      if (result.repositories.length || destination.newCollectionName) await this.mutate(catalog => {
        let collectionId = destination.collectionId;
        if (destination.newCollectionName) {
          const collection = this.newCollection(catalog, destination.newCollectionName);
          catalog.collections.push(collection); collectionId = collection.id; createdCollection = collection;
        }
        if (collectionId && !catalog.collections.some(item => item.id === collectionId)) throw new MessageError(localizeMessage("manager.repositoryGroupNoLongerExists"));
        for (const { repo } of prepared) {
          if (!catalog.roots.some(root => pathKey(root) === pathKey(repo.root))) catalog.roots.push(repo.root);
          const key = repositoryGroupKey(repo);
          catalog.exclusions = catalog.exclusions.filter(item => item !== key);
          if (collectionId) { assignmentChanged ||= catalog.assignments[key] !== collectionId; catalog.assignments[key] = collectionId; }
          else if (Object.hasOwn(destination, 'collectionId')) { assignmentChanged ||= catalog.assignments[key] !== undefined; delete catalog.assignments[key]; }
        }
        catalog.order = this.catalogOrder(catalog, prepared.map(item => item.repo));
      }, () => { for (const item of prepared) registered = item.registration.apply() || registered; }, () => {
        for (const repo of result.repositories) {
          try { prepared.push({ repo, registration: this.prepareRegistration(repo) }); }
          catch (error) { result.issues.push({ path: repo.root, message: error instanceof Error ? error.message : String(error) }); }
        }
      });
    } catch (error) { for (const item of prepared) item.registration.dispose(); throw error; }
    for (const key of new Set(prepared.map(item => repositoryGroupKey(item.repo)))) {
      if (existingGroups.has(key)) result.existing++; else result.added++;
    }
    if (createdCollection) result.collection = createdCollection;
    this.invalidateScan();
    if (registered || result.collection || assignmentChanged) this.listEmitter.fire();
    return result;
  }
  async remove(keys: Iterable<string>): Promise<number> {
    const removing = new Set(keys), groups = this.groups().filter(group => removing.has(group.key));
    if (!groups.length) return 0;
    this.invalidateScan();
    const rootKeys = new Set(groups.flatMap(group => group.members.map(repo => pathKey(repo.root))));
    await this.mutate(catalog => {
      catalog.roots = catalog.roots.filter(root => !rootKeys.has(pathKey(root)));
      for (const group of groups) { if (!catalog.exclusions.includes(group.key)) catalog.exclusions.push(group.key); delete catalog.assignments[group.key]; }
      catalog.order = forgetRepositoryOrderKeys(this.catalogOrder(catalog), new Set(groups.map(group => repositoryOrderKey(group.key))));
    }, () => { for (const group of groups) for (const repo of group.members) this.unregister(repo.id); });
    this.listEmitter.fire();
    return groups.length;
  }
  private newCollection(catalog: RepositoryCatalog, name: string): RepositoryCollection {
    const normalized = name.trim();
    if (!normalized) throw new MessageError(localizeMessage("manager.repositoryGroupNameIsRequired"));
    if (normalized.length > 80) throw new MessageError(localizeMessage("manager.repositoryGroupNameIsTooLong"));
    if (catalog.collections.some(item => item.name.localeCompare(normalized, undefined, { sensitivity: 'accent' }) === 0)) throw new MessageError(localizeMessage("manager.aRepositoryGroupWithThisNameAlreadyExists"));
    return { id: randomUUID(), name: normalized };
  }
  async createCollection(name: string): Promise<RepositoryCollection> {
    const collection = await this.mutate(catalog => {
      const collection = this.newCollection(catalog, name); catalog.collections.push(collection);
      catalog.order = this.catalogOrder(catalog); return collection;
    });
    this.listEmitter.fire(); return collection;
  }
  async renameCollection(id: string, name: string): Promise<void> {
    await this.mutate(catalog => {
      if (!catalog.collections.some(item => item.id === id)) throw new MessageError(localizeMessage("manager.repositoryGroupNoLongerExists"));
      const others = { ...catalog, collections: catalog.collections.filter(item => item.id !== id) };
      const renamed = this.newCollection(others, name);
      catalog.collections = catalog.collections.map(item => item.id === id ? { ...item, name: renamed.name } : item);
    }); this.listEmitter.fire();
  }
  async deleteCollection(id: string): Promise<void> {
    await this.mutate(catalog => {
      if (!catalog.collections.some(item => item.id === id)) return;
      const order = this.catalogOrder(catalog), members = order.collections[id] ?? [];
      delete order.collections[id]; order.root = order.root.filter(key => key !== collectionOrderKey(id)); order.root.push(...members);
      catalog.collections = catalog.collections.filter(item => item.id !== id);
      for (const [key, value] of Object.entries(catalog.assignments)) if (value === id) delete catalog.assignments[key];
      catalog.order = order; catalog.order = this.catalogOrder(catalog);
    }); this.listEmitter.fire();
  }
  async move(keys: Iterable<string>, collectionId?: string): Promise<number> {
    const requested = new Set(keys), available = new Set(this.groups().map(group => group.key));
    const moved = await this.mutate(catalog => {
      if (collectionId && !catalog.collections.some(item => item.id === collectionId)) throw new MessageError(localizeMessage("manager.repositoryGroupNoLongerExists"));
      let moved = 0;
      for (const key of requested) {
        if (!available.has(key) || catalog.exclusions.includes(key) || catalog.assignments[key] === collectionId) continue;
        if (collectionId) catalog.assignments[key] = collectionId; else delete catalog.assignments[key]; moved++;
      }
      if (moved) catalog.order = this.catalogOrder(catalog); return moved;
    });
    if (moved) this.listEmitter.fire(); return moved;
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
    if(this.disposed)return Promise.resolve();
    if(!vscode.workspace.isTrusted)return this.catalog.reload().then(()=>{if(synchronize&&!this.disposed)this.listEmitter.fire();});
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
      const roots=await this.discoveryRoots(),revision=this.catalog.snapshot().revision,desiredRoots=new Set([...roots].map(pathKey));
      const candidates=[...roots],results:Array<Repository|undefined>=new Array(candidates.length);
      let next=0;
      // Restore independent paths concurrently, while retaining catalog order and stale-scan checks.
      await Promise.all(Array.from({length:Math.min(4,candidates.length)},async()=>{
        while(next<candidates.length&&!this.disposed&&generation===this.scanGeneration){
          const index=next++,root=candidates[index];
          try{const repo=await this.git.discover(root);if(generation===this.scanGeneration&&!this.disposed)results[index]=repo;}
          catch(error){this.log.appendLine(translate('en', "manager.discovery", { root: (root), value: (error instanceof Error?error.message:String(error)) }));}
        }
      }));
      const discovered=results.filter((repo):repo is Repository=>!!repo);
      for(const repo of discovered)desiredRoots.add(pathKey(repo.root));
      if(this.disposed)return;
      const currentRoots=await this.discoveryRoots();
      if(generation!==this.scanGeneration||this.workspaceKey()!==this.scanWorkspace||this.rootsKey(currentRoots)!==this.rootsKey(roots)||this.catalog.snapshot().revision!==revision){this.scanDirty=true;continue;}
      const excluded=new Set(this.catalog.snapshot().exclusions);
      const prepared: { repo: Repository; registration: ReturnType<RepositoryManager['prepareRegistration']> }[]=[];
      let accepted: boolean;
      try { accepted=await this.mutate(catalog=>{
        if(catalog.revision!==revision||generation!==this.scanGeneration)return false;
        catalog.order=this.catalogOrder(catalog,prepared.map(item=>item.repo));return true;
      }, committed=>{
        if(!committed)return;
        for(const item of prepared)item.registration.apply();
        if(this.scanSynchronizing)for(const repo of [...this.repositories.values()])if(excluded.has(repositoryGroupKey(repo))||!desiredRoots.has(pathKey(repo.root)))this.unregister(repo.id);
      },()=>{
        for(const repo of discovered)if(!excluded.has(repositoryGroupKey(repo))) {
          try { prepared.push({repo,registration:this.prepareRegistration(repo)}); }
          catch(error){this.log.appendLine(`[discovery] ${repo.root}: ${String(error)}`);}
        }
      }); } catch(error){for(const item of prepared)item.registration.dispose();throw error;}
      if(!accepted){for(const item of prepared)item.registration.dispose();this.scanDirty=true;continue;}
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
