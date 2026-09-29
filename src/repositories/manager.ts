import * as vscode from 'vscode';
import type { GitServiceContract, Repository } from '../protocol/types';

export class RepositoryManager implements vscode.Disposable {
  private readonly repositories = new Map<string, Repository>();
  private readonly watchers = new Map<string, vscode.Disposable[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly changedEmitter = new vscode.EventEmitter<string>();
  private readonly listEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changedEmitter.event;
  readonly onDidChangeRepositories = this.listEmitter.event;
  constructor(private readonly git: GitServiceContract, private readonly context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel) {}
  list(): Repository[] { return [...this.repositories.values()]; }
  get(id: string | undefined): Repository {
    const repo = id && this.repositories.get(id);
    if (!repo) throw new Error('Select a registered repository first.');
    return repo;
  }
  async add(root: string, remember = true): Promise<Repository> {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before executing Git.');
    const repo = await this.git.discover(root);
    if (!this.repositories.has(repo.id)) {
      this.repositories.set(repo.id, repo);
      const notify = () => this.notify(repo.id);
      const worktreeWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(repo.root, '**/*'));
      const gitWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(repo.commonDir, '{HEAD,index,packed-refs,refs/**,worktrees/**,MERGE_HEAD,CHERRY_PICK_HEAD,REVERT_HEAD,rebase-merge/**,rebase-apply/**,sequencer/**}'));
      const listen = (watcher: vscode.FileSystemWatcher, filter: boolean) => [watcher,
        watcher.onDidChange(uri => { if (!filter || !/[\\/](node_modules|\.git)[\\/]/.test(uri.fsPath)) notify(); }),
        watcher.onDidCreate(uri => { if (!filter || !/[\\/](node_modules|\.git)[\\/]/.test(uri.fsPath)) notify(); }),
        watcher.onDidDelete(uri => { if (!filter || !/[\\/](node_modules|\.git)[\\/]/.test(uri.fsPath)) notify(); }),
      ];
      this.watchers.set(repo.id, [...listen(worktreeWatcher, true), ...listen(gitWatcher, false)]);
      this.listEmitter.fire();
    }
    if (remember) await this.context.workspaceState.update('alwaygit.roots', this.list().map(r => r.root));
    return repo;
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
  notify(id: string): void {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => { this.timers.delete(id); this.changedEmitter.fire(id); }, 300));
  }
  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const items of this.watchers.values()) for (const item of items) item.dispose();
    this.changedEmitter.dispose(); this.listEmitter.dispose();
  }
}

export class RepositoryTree implements vscode.TreeDataProvider<Repository> {
  private readonly emitter = new vscode.EventEmitter<Repository | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  constructor(private readonly manager: RepositoryManager) {}
  refresh(): void { this.emitter.fire(undefined); }
  getChildren(): Repository[] { return this.manager.list(); }
  getTreeItem(repo: Repository): vscode.TreeItem {
    const item = new vscode.TreeItem(repo.name);
    item.description = repo.root; item.tooltip = repo.root;
    item.iconPath = new vscode.ThemeIcon('repo');
    item.command = { command: 'alwaygit.open', title: 'Open Workbench', arguments: [repo.id] };
    return item;
  }
}
