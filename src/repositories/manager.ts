import * as vscode from 'vscode';
import path from 'node:path';
import type { GitServiceContract, Repository, RepositoryChanges } from '../protocol/types';
import { groupRepositories, repositoryGroupKey } from '../protocol/repositories';
import { discoverRepositories, type DiscoveryOptions, type DiscoveryResult } from './discovery';

export interface AddDirectoryResult extends DiscoveryResult { added: number; existing: number }

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
  list(): Repository[] { return [...this.repositories.values()]; }
  groups() { return groupRepositories(this.list()); }
  get(id: string | undefined): Repository {
    const repo = id && this.repositories.get(id);
    if (!repo) throw new Error('Select a registered repository first.');
    return repo;
  }
  async add(root: string, remember = true): Promise<Repository> {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before executing Git.');
    const repo = await this.git.discover(root);
    if (this.register(repo)) this.listEmitter.fire();
    if (remember) await this.context.workspaceState.update('alwaygit.roots', this.list().map(r => r.root));
    return repo;
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
  async addDirectory(root: string, options: DiscoveryOptions = {}): Promise<AddDirectoryResult> {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before executing Git.');
    const discovery = await discoverRepositories(root, this.git, options);
    const result: AddDirectoryResult = { ...discovery, added: 0, existing: 0 };
    if (result.cancelled || options.isCancelled?.()) { result.cancelled = true; return result; }
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before executing Git.');
    const existingGroups = new Set(this.groups().map(group => group.key)), successfulGroups = new Set<string>();
    let registered = false;
    for (const repo of result.repositories) {
      try { if (this.register(repo)) registered = true; successfulGroups.add(repositoryGroupKey(repo)); }
      catch (error) { result.issues.push({ path: repo.root, message: error instanceof Error ? error.message : String(error) }); }
    }
    for (const key of successfulGroups) { if (existingGroups.has(key)) result.existing++; else result.added++; }
    // Persist once and notify once, regardless of the number of discovered repositories.
    if (result.repositories.length) {
      try { await this.context.workspaceState.update('alwaygit.roots', this.list().map(r => r.root)); }
      finally { if (registered) this.listEmitter.fire(); }
    }
    return result;
  }
  async scan(): Promise<void> {
    if (!vscode.workspace.isTrusted) return;
    const roots = new Set<string>((this.context.workspaceState.get<string[]>('alwaygit.roots', [])));
    for (const folder of vscode.workspace.workspaceFolders ?? []) if (folder.uri.scheme === 'file') roots.add(folder.uri.fsPath);
    try {
      const ext = vscode.extensions.getExtension<{ getAPI(version: number): { repositories: { rootUri: vscode.Uri }[] } }>('vscode.git');
      const api = ext ? (await ext.activate()).getAPI(1) : undefined;
      for (const repo of api?.repositories ?? []) if (repo.rootUri.scheme === 'file') roots.add(repo.rootUri.fsPath);
    } catch { /* Git extension is optional. */ }
    for (const root of roots) {
      try { await this.add(root, false); }
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

export class RepositoryTree implements vscode.TreeDataProvider<Repository> {
  private readonly emitter = new vscode.EventEmitter<Repository | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  constructor(private readonly manager: RepositoryManager) {}
  refresh(): void { this.emitter.fire(undefined); }
  getChildren(): Repository[] { return this.manager.groups().map(group => ({ ...group.repository, name: group.name })); }
  getTreeItem(repo: Repository): vscode.TreeItem {
    const item = new vscode.TreeItem(repo.name);
    item.description = repo.root; item.tooltip = repo.root;
    item.iconPath = new vscode.ThemeIcon('repo');
    item.command = { command: 'alwaygit.open', title: 'Open Workbench', arguments: [repo.id] };
    return item;
  }
}
