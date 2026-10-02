import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActionBlocker, GitServiceContract, HostMessage, RepositoryCollection, RepositoryStatus, RpcRequest, Snapshot } from '../protocol/types';
import { actionSchema, requestSchema, historySchema, detailsSchema, comparisonSchema, diffSchema, fileSchema, sessionSchema, copySchema, openRepositorySchema, openWorkbenchSchema, openWorktreeSchema, repositoryKeysSchema, repositoryCollectionSchema, moveRepositoriesSchema } from '../protocol/validation';
import type { RepositoryManager } from '../repositories/manager';
import type { GitDocuments } from '../editor/documents';
import { confirmAction } from '../application/confirm';
import { redactSecrets } from '../application/logging';
import { hostText, preferredLanguage, type Language } from '../application/language';
import type { ProjectWindows } from './project-windows';
import { groupRepositories } from '../protocol/repositories';
import { panelSession } from './workbench-entry';
import { RepositoryOperationBusyError } from '../application/operation-lock';

interface WorkbenchPanel { panel: vscode.WebviewPanel; activeRepository?: string; blank: boolean }
export interface WorkbenchPresence { open: boolean; active: boolean }

export class Workbench implements vscode.Disposable {
  private readonly panels = new Map<vscode.WebviewPanel, WorkbenchPanel>();
  private lastPanel?: WorkbenchPanel;
  private activeRepository?: string;
  private readonly fingerprints = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly busy = new Set<string>();
  private readonly externalBusy = new Set<string>();
  private polling = false;
  private requestCount = 0;
  private addingRepositories = false;
  private readonly presenceEmitter = new vscode.EventEmitter<WorkbenchPresence>();
  readonly onDidChangePresence = this.presenceEmitter.event;
  get presence(): WorkbenchPresence { return { open: this.panels.size > 0, active: [...this.panels.keys()].some(panel => panel.active) }; }
  /** Diagnostic count used to verify the real Webview message bridge. */
  get receivedWebviewRequests(): number { return this.requestCount; }
  private readonly interval: ReturnType<typeof setInterval>;
  private language(): Language { return this.context.workspaceState.get<{ language?: Language }>('alwaygit.session', {}).language ?? preferredLanguage(); }
  private text(english: string, chinese: string): string { return hostText(english, chinese, this.language()); }
  private repositoryKey(commonDir: string): string { const resolved=path.resolve(commonDir);return process.platform==='win32'?resolved.toLowerCase():resolved; }
  private isBusy(commonDir: string): boolean { const key=this.repositoryKey(commonDir);return this.busy.has(key)||this.externalBusy.has(key); }
  constructor(private readonly context: vscode.ExtensionContext, private readonly git: GitServiceContract, private readonly repositories: RepositoryManager, private readonly documents: GitDocuments, private readonly output: vscode.OutputChannel, private readonly projects: ProjectWindows) {
    this.disposables.push(repositories.onDidChange(event => this.post({ type: 'changed', ...event })), repositories.onDidChangeRepositories(() => this.post({ type: 'repositoriesChanged' })));
    const seconds = vscode.workspace.getConfiguration('alwaygit').get<number>('refreshInterval', 15);
    this.interval = setInterval(() => void this.poll(), seconds * 1000);
  }
  async open(repoId?: string, restoredPanel?: vscode.WebviewPanel, newTab = false, blank = false): Promise<void> {
    if (!vscode.workspace.isTrusted) { await vscode.window.showWarningMessage(this.text('Trust this workspace using VS Code Workspace Trust, then reopen AlwayGit.', '请在 VS Code 中信任此工作区，然后重新打开 AlwayGit。')); return; }
    await this.repositories.scan();
    if (repoId) this.activeRepository = repoId;
    const existing=!restoredPanel&&!newTab?(this.lastPanel??[...this.panels.values()].at(-1)):undefined;
    if(existing){existing.panel.reveal();this.lastPanel=existing;this.post({type:'repositoriesChanged'},existing);if(repoId)this.selectPanelRepository(existing,repoId);this.presenceEmitter.fire(this.presence);return;}
    const options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')] };
    const panel = restoredPanel ?? vscode.window.createWebviewPanel('alwaygit.workbench', 'AlwayGit', vscode.ViewColumn.Active, options);
    panel.webview.options = options;
    const entry:WorkbenchPanel={panel,activeRepository:repoId,blank};
    this.panels.set(panel,entry);this.lastPanel=entry;this.updatePanelTitle(entry);this.presenceEmitter.fire(this.presence);
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'alwaygit.svg');
    panel.onDidDispose(() => { this.panels.delete(panel);if(this.lastPanel===entry)this.lastPanel=[...this.panels.values()].at(-1);this.presenceEmitter.fire(this.presence); });
    panel.webview.onDidReceiveMessage(async (raw: unknown) => {
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) return;
      this.requestCount++;
      try { const result = await this.handleRequest(parsed.data,entry); this.post({ type: 'response', id: parsed.data.id, result },entry); }
      catch (error) {
        const message = redactSecrets(error instanceof Error ? error.message : String(error));
        this.output.appendLine(`[request:${parsed.data.method}] ${message}`);
        const details = (error as { details?: ActionBlocker }).details;
        this.post({ type: 'response', id: parsed.data.id, error: { message, code: String((error as { code?: unknown }).code ?? 'FAILED'), ...(details ? { details } : {}) } },entry);
      }
    });
    panel.onDidChangeViewState(event => { if (event.webviewPanel.visible) { this.lastPanel=entry;this.post({ type: 'repositoriesChanged' },entry); if (entry.activeRepository) this.post({ type: 'changed', repoId: entry.activeRepository },entry); } this.presenceEmitter.fire(this.presence); });
    panel.webview.html = await this.html(panel.webview,repoId,blank);
  }
  async addRepository(): Promise<unknown> {
    if (!vscode.workspace.isTrusted) throw new Error(this.text('Git execution requires a trusted workspace.', '请先信任工作区，再执行 Git 操作。'));
    if (this.addingRepositories) return undefined;
    this.addingRepositories = true;
    try {
      const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, title: this.text('Select a repository or a folder containing repositories', '选择仓库或存放多个仓库的目录'), openLabel: this.text('Add Repositories', '添加仓库') });
      if (!selected?.[0]) return undefined;
      const discovery = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: this.text('Discovering Git repositories', '正在查找 Git 仓库'), cancellable: true }, (progress, token) => {
        let lastReport = 0;
        return this.repositories.discoverDirectory(selected[0].fsPath, {
          isCancelled: () => token.isCancellationRequested,
          onProgress: ({ scanned, found }) => {
            if (Date.now() - lastReport < 100) return;
            lastReport = Date.now();
            progress.report({ message: this.text(`Scanned ${scanned} folders, found ${found} repositories`, `已扫描 ${scanned} 个目录，发现 ${found} 个仓库`) });
          },
        });
      });
      for (const issue of discovery.issues) this.output.appendLine(redactSecrets(`[discovery] ${issue.path}: ${issue.message}`));
      if (discovery.cancelled) {
        void vscode.window.showInformationMessage(this.text('Repository discovery cancelled. No repositories were added.', '已取消仓库扫描，未添加任何仓库。'));
        return { added: 0, existing: 0, skipped: discovery.issues.length, cancelled: true };
      }
      const discoveredGroups=groupRepositories(discovery.repositories),existingKeys=new Set(this.repositories.groups().map(group=>group.key));
      if(!discoveredGroups.length){const summary=this.text('No Git repositories found in the selected folder.','所选目录中没有找到 Git 仓库。');if(discovery.issues.length)void vscode.window.showWarningMessage(summary+this.text(` Skipped ${discovery.issues.length} folders or repositories. See AlwayGit output for details.`,` 跳过 ${discovery.issues.length} 个异常目录或仓库，详情请查看 AlwayGit 输出。`));else void vscode.window.showInformationMessage(summary);return {added:0,existing:0,skipped:discovery.issues.length,cancelled:false};}
      type Candidate = vscode.QuickPickItem & { key:string };
      const candidates:Candidate[]=discoveredGroups.map(group=>({label:group.name,description:existingKeys.has(group.key)?this.text('Already added','已添加'):this.text('Available to add','可添加'),detail:group.repository.root,picked:!existingKeys.has(group.key),key:group.key}));
      const picked=await vscode.window.showQuickPick(candidates,{canPickMany:true,title:this.text(`Found ${discoveredGroups.length} repositories`,`扫描到 ${discoveredGroups.length} 个仓库`),placeHolder:this.text('Select repositories to add','选择要添加的仓库')});
      if(!picked)return {added:0,existing:discoveredGroups.filter(group=>existingKeys.has(group.key)).length,skipped:discovery.issues.length,cancelled:true};
      const selectedKeys=new Set(picked.map(item=>item.key).filter(key=>!existingKeys.has(key))),repositories=discoveredGroups.filter(group=>selectedKeys.has(group.key)).flatMap(group=>group.members);
      let collectionId:string|undefined;
      if(selectedKeys.size&&this.repositories.collections().length){type Destination=vscode.QuickPickItem&{collectionId?:string};const destinations:Destination[]=[{label:this.text('Repository root','仓库根目录'),description:this.text('Keep alongside repository groups','与仓库分组目录同级')} ,...this.repositories.collections().map(collection=>({label:collection.name,collectionId:collection.id}))];const destination=await vscode.window.showQuickPick(destinations,{title:this.text('Choose a repository group','选择仓库分组'),placeHolder:this.text('Repositories without a group stay at the root','不选择分组的仓库保留在根层')});if(!destination)return {added:0,existing:discoveredGroups.filter(group=>existingKeys.has(group.key)).length,skipped:discovery.issues.length,cancelled:true};collectionId=destination.collectionId;}
      const result=await this.repositories.registerDiscovered({...discovery,repositories,found:selectedKeys.size});
      if(selectedKeys.size)await this.repositories.move(selectedKeys,collectionId);
      if(result.added)await this.projects.notifyCatalogChanged();
      result.existing=discoveredGroups.filter(group=>existingKeys.has(group.key)).length;
      const summary=this.text(`Added ${result.added} repositories; ${result.existing} already registered.`,`新增 ${result.added} 个仓库，${result.existing} 个已存在。`);
      if(discovery.issues.length)void vscode.window.showWarningMessage(summary+this.text(` Skipped ${discovery.issues.length} folders or repositories. See AlwayGit output for details.`,` 跳过 ${discovery.issues.length} 个异常目录或仓库，详情请查看 AlwayGit 输出。`));else void vscode.window.showInformationMessage(summary);
      return {added:result.added,existing:result.existing,skipped:discovery.issues.length,cancelled:false};
    } finally { this.addingRepositories = false; }
  }
  async removeRepositories(keys: string[]): Promise<number> {
    const groups=this.repositories.groups().filter(group=>keys.includes(group.key));
    if(!groups.length)return 0;
    if(groups.some(group=>group.members.some(repo=>this.isBusy(repo.commonDir))))throw new Error(this.text('Wait for the running Git operation before removing this repository.','请等待正在执行的 Git 操作完成后再移除仓库。'));
    const remove=this.text('Remove','移除'),confirmed=await vscode.window.showWarningMessage(this.text(`Remove ${groups.length} ${groups.length===1?'repository':'repositories'} from AlwayGit? Files on disk will not be deleted.`,`从 AlwayGit 移除 ${groups.length} 个仓库？不会删除磁盘上的文件。`),{modal:true},remove);
    if(confirmed!==remove)return 0;
    const removed=await this.repositories.remove(groups.map(group=>group.key));if(removed)await this.projects.notifyCatalogChanged();return removed;
  }
  async createRepositoryCollection(): Promise<RepositoryCollection|undefined> {
    const name=await vscode.window.showInputBox({title:this.text('Create Repository Group','新建仓库分组'),prompt:this.text('Repositories can be moved into this group after it is created.','创建后可将仓库移动到该分组。'),validateInput:value=>this.collectionNameProblem(value)});if(name===undefined)return undefined;const collection=await this.repositories.createCollection(name);await this.projects.notifyCatalogChanged();return collection;
  }
  async renameRepositoryCollection(id:string):Promise<void>{const collection=this.repositories.collections().find(item=>item.id===id);if(!collection)return;const name=await vscode.window.showInputBox({title:this.text('Rename Repository Group','重命名仓库分组'),value:collection.name,validateInput:value=>this.collectionNameProblem(value,id)});if(name!==undefined){await this.repositories.renameCollection(id,name);await this.projects.notifyCatalogChanged();}}
  async deleteRepositoryCollection(id:string):Promise<void>{const collection=this.repositories.collections().find(item=>item.id===id);if(!collection)return;const remove=this.text('Delete Group','删除分组'),confirmed=await vscode.window.showWarningMessage(this.text(`Delete repository group "${collection.name}"? Its repositories will remain at the repository root.`,`删除仓库分组“${collection.name}”？其中的仓库会保留在仓库根层。`),{modal:true},remove);if(confirmed===remove){await this.repositories.deleteCollection(id);await this.projects.notifyCatalogChanged();}}
  async moveRepositories(keys:string[]):Promise<number>{const collections=this.repositories.collections();type Destination=vscode.QuickPickItem&{collectionId?:string};const choices:Destination[]=[{label:this.text('Repository root','仓库根目录'),description:this.text('Place alongside repository groups','与仓库分组目录同级')},...collections.map(collection=>({label:collection.name,collectionId:collection.id}))];const destination=await vscode.window.showQuickPick(choices,{title:this.text(`Move ${keys.length} ${keys.length===1?'repository':'repositories'}`,`移动 ${keys.length} 个仓库`),placeHolder:this.text('Choose a repository group or the repository root','选择仓库分组或仓库根目录')});if(!destination)return 0;const moved=await this.repositories.move(keys,destination.collectionId);if(moved)await this.projects.notifyCatalogChanged();return moved;}
  private collectionNameProblem(value:string,currentId?:string):string|undefined{const name=value.trim();if(!name)return this.text('Enter a group name.','请输入分组名称。');if(name.length>80)return this.text('Use no more than 80 characters.','分组名称不能超过 80 个字符。');if(this.repositories.collections().some(item=>item.id!==currentId&&item.name.localeCompare(name,undefined,{sensitivity:'accent'})===0))return this.text('A group with this name already exists.','已存在同名分组。');return undefined;}
  /** All UI requests go through the same validated, trusted application boundary. */
  async handle(request: RpcRequest): Promise<unknown> { return this.handleRequest(request); }
  private async handleRequest(request: RpcRequest, source?:WorkbenchPanel): Promise<unknown> {
    if (request.method === 'showLog') { this.output.show(true); return null; }
    if (request.method === 'saveSession') { const session=sessionSchema.parse(request.payload),previous=this.context.workspaceState.get<Record<string,unknown>>('alwaygit.session',{}),persisted=source?.blank&&!session.repoId&&typeof previous.repoId==='string'?{...session,repoId:previous.repoId}:session;await this.context.workspaceState.update('alwaygit.session',persisted);if(source){source.activeRepository=session.repoId;source.blank=source.blank&&!session.repoId;this.updatePanelTitle(source);}return null; }
    if (request.method === 'copyText') { await vscode.env.clipboard.writeText(copySchema.parse(request.payload).text); return null; }
    if (!vscode.workspace.isTrusted) throw new Error(this.text('Git execution requires a trusted workspace.', '请先信任工作区，再执行 Git 操作。'));
    if (request.method === 'repositories') { const list = this.repositories.list(),active=source?.activeRepository??this.activeRepository; return active ? list.sort((a, b) => Number(b.id === active) - Number(a.id === active)) : list; }
    if (request.method === 'repositoryCollections') return this.repositories.collections();
    if (request.method === 'repositoryStatuses') return this.repositoryStatuses();
    if (request.method === 'addRepository') return this.addRepository();
    if (request.method === 'removeRepositories') return this.removeRepositories(repositoryKeysSchema.parse(request.payload).keys);
    if (request.method === 'createRepositoryCollection') return this.createRepositoryCollection();
    if (request.method === 'renameRepositoryCollection') { await this.renameRepositoryCollection(repositoryCollectionSchema.parse(request.payload).id); return null; }
    if (request.method === 'deleteRepositoryCollection') { await this.deleteRepositoryCollection(repositoryCollectionSchema.parse(request.payload).id); return null; }
    if (request.method === 'moveRepositories') { const data=moveRepositoriesSchema.parse(request.payload);if(data.collectionId===undefined)return this.moveRepositories(data.keys);const moved=await this.repositories.move(data.keys,data.collectionId);if(moved)await this.projects.notifyCatalogChanged();return moved; }
    if(request.method==='openWorkbench'){const data=openWorkbenchSchema.parse(request.payload??{});if(data.newTab)await this.open(undefined,undefined,true,true);else await this.projects.openBlankWorkbenchInNewWindow();return null;}
    if (request.method === 'pickWorktree') {
      const value = await vscode.window.showSaveDialog({ title: 'New Worktree Directory', saveLabel: 'Use Directory', defaultUri: vscode.Uri.file(path.join(path.dirname(this.repositories.get(request.repoId).root), 'new-worktree')) });
      return value?.fsPath;
    }
    const repo = this.repositories.get(request.repoId);
    switch (request.method) {
      case 'snapshot': {
        this.activeRepository = repo.id;if(source){source.activeRepository=repo.id;this.lastPanel=source;this.updatePanelTitle(source);}
        const snapshot = await this.git.snapshot(repo); this.recordFingerprint(snapshot); return snapshot;
      }
      case 'history': return this.git.history(repo, { limit: vscode.workspace.getConfiguration('alwaygit').get<number>('historyPageSize', 300), ...historySchema.parse(request.payload ?? {}) });
      case 'operationReview': return this.git.reviewOperation(repo);
      case 'details': { const data = detailsSchema.parse(request.payload); return this.git.details(repo, data.oid, data.parent); }
      case 'stashDetails': { const data = detailsSchema.parse(request.payload); return this.git.stashDetails(repo, data.oid); }
      case 'compare': { const data=comparisonSchema.parse(request.payload); return this.git.compare(repo,data.left,data.right,data.preserveOrder); }
      case 'diff': await this.projects.openDiff(repo.root, diffSchema.parse(request.payload)); return null;
      case 'diffPreview': return this.documents.preview(repo, diffSchema.parse(request.payload));
      case 'openRepository': {
        const data = openRepositorySchema.parse(request.payload ?? {});
        if (data.newWindow) await this.projects.openWorkbenchInNewWindow(repo.root);
        else if(data.newTab)await this.open(repo.id,undefined,true);
        else if(source)this.selectPanelRepository(source,repo.id);
        else await this.open(repo.id);
        return null;
      }
      case 'openFile': await this.projects.openFile(repo.root, fileSchema.parse(request.payload).path); return null;
      case 'openProject': await this.projects.openProject(repo.root); return null;
      case 'openWorktree': {
        const data = openWorktreeSchema.parse(request.payload);
        const snapshot = await this.git.snapshot(repo);
        const normalized = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
        const worktree = snapshot.worktrees.find(w => normalized(w.path) === normalized(data.path));
        if (!worktree || worktree.bare) throw new Error(this.text('Select a registered non-bare Worktree.', '请选择已注册的非 bare Worktree。'));
        if (normalized(worktree.path) === normalized(repo.root) && !data.newWindow) { if(source)this.selectPanelRepository(source,repo.id);else await this.open(repo.id); return null; }
        const registered = await this.repositories.add(worktree.path);
        await this.projects.notifyCatalogChanged();
        if (data.newWindow !== false) await this.projects.openWorkbenchInNewWindow(worktree.path);
        else if(source)this.selectPanelRepository(source,registered.id);else await this.open(registered.id);
        return null;
      }
      case 'action': {
        const action = actionSchema.parse(request.payload);
        if (this.isBusy(repo.commonDir)) throw new Error(this.text('An operation is already running in this repository.', '此仓库已有正在执行的操作。'));
        const operation = action.type === 'operation.abort' ? (await this.git.snapshot(repo)).operation : undefined;
        if (!await confirmAction(repo, action, this.language(), operation)) throw new Error(this.text('Operation cancelled.', '操作已取消。'));
        if (this.isBusy(repo.commonDir)) throw new Error(this.text('An operation is already running in this repository.', '此仓库已有正在执行的操作。'));
        const operationKey=this.repositoryKey(repo.commonDir);this.busy.add(operationKey);
        for (const r of this.repositories.list().filter(r => r.commonDir === repo.commonDir)) this.post({ type: 'activity', repoId: r.id, busy: true, label: action.type });
        try { await this.projects.runRepositoryOperation(repo.commonDir,action.type,()=>this.git.execute(repo, action)); }
        catch(error){if(error instanceof RepositoryOperationBusyError)throw new Error(this.text('A Git operation is already running for this repository in another AlwayGit window.','另一个 AlwayGit 窗口正在对该仓库执行 Git 操作。'));throw error;}
        finally {
          this.busy.delete(operationKey);
          for (const r of this.repositories.list().filter(r => r.commonDir === repo.commonDir)) { this.post({ type: 'activity', repoId: r.id, busy: false, label: action.type }); this.post({ type: 'changed', repoId: r.id }); }
        }
        const snapshot = await this.git.snapshot(repo); this.recordFingerprint(snapshot); return snapshot;
      }
    }
  }
  private async repositoryStatuses(): Promise<RepositoryStatus[]> {
    const repositories = this.repositories.list(), results: Array<RepositoryStatus | undefined> = new Array(repositories.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, repositories.length) }, async () => {
      while (next < repositories.length) {
        const index = next++, repo = repositories[index];
        try { results[index] = await this.git.repositoryStatus(repo); }
        catch (error) { this.output.appendLine(redactSecrets(`[repository-status:${repo.name}] ${error instanceof Error ? error.message : String(error)}`)); }
      }
    }));
    return results.filter((result): result is RepositoryStatus => !!result);
  }
  private recordFingerprint(snapshot: Snapshot): string {
    const { version: _version, ...state } = snapshot; const key = JSON.stringify(state); this.fingerprints.set(snapshot.repository.id, key); return key;
  }
  private async poll(): Promise<void> {
    const ids=[...new Set([...this.panels.values()].filter(entry=>entry.panel.visible).map(entry=>entry.activeRepository).filter((id):id is string=>!!id))];
    if (!ids.length || this.polling || !vscode.workspace.isTrusted) return;
    this.polling = true;
    try {
      for(const id of ids){try{const repo=this.repositories.get(id);if(this.isBusy(repo.commonDir))continue;const previous=this.fingerprints.get(repo.id),snapshot=await this.git.snapshot(repo);if(this.recordFingerprint(snapshot)!==previous)this.post({type:'changed',repoId:repo.id,changes:{paths:[]}});}catch(error){this.output.appendLine(redactSecrets(`[refresh] ${error instanceof Error?error.message:String(error)}`));}}
    }
    finally { this.polling = false; }
  }
  private selectPanelRepository(entry:WorkbenchPanel,repoId:string):void {entry.activeRepository=repoId;this.activeRepository=repoId;this.lastPanel=entry;this.updatePanelTitle(entry);entry.panel.reveal();this.post({type:'selectRepository',repoId},entry);}
  externalRepositoryActivity(commonDir:string,busy:boolean,label:string):void {const key=this.repositoryKey(commonDir);if(busy)this.externalBusy.add(key);else this.externalBusy.delete(key);for(const repo of this.repositories.list().filter(repo=>this.repositoryKey(repo.commonDir)===key)){this.post({type:'activity',repoId:repo.id,busy,label});if(!busy)this.post({type:'changed',repoId:repo.id});}}
  private updatePanelTitle(entry:WorkbenchPanel):void {let name:string|undefined;try{name=entry.activeRepository?groupRepositories(this.repositories.list(),entry.activeRepository).find(group=>group.members.some(repo=>repo.id===entry.activeRepository))?.name:undefined;}catch{/* Repository discovery can remove a stale restored ID. */}entry.panel.title=name?`AlwayGit — ${name}`:'AlwayGit';}
  private post(message: HostMessage,target?:WorkbenchPanel): void {if(target){void target.panel.webview.postMessage(message);return;}for(const entry of this.panels.values())void entry.panel.webview.postMessage(message);}
  private async html(webview: vscode.Webview,activeRepository?:string,blank=false): Promise<string> {
    const root = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    let html = await readFile(vscode.Uri.joinPath(root, 'index.html').fsPath, 'utf8');
    const nonce = randomBytes(20).toString('base64');
    html = html.replace(/(src|href)="\.\/([^"\s]+)"/g, (_match, attr, resource: string) => `${attr}="${webview.asWebviewUri(vscode.Uri.joinPath(root, resource))}"`);
    html = html.replace(/<script /g, `<script nonce="${nonce}" `);
    const saved = this.context.workspaceState.get<Record<string, unknown>>('alwaygit.session', {});
    const session = JSON.stringify({ ...panelSession(saved,activeRepository,blank), language: saved.language ?? preferredLanguage() }).replace(/</g, '\\u003c');
    html = html.replace('</head>', `<script nonce="${nonce}">window.__ALWAYGIT_SESSION__=${session};</script></head>`);
    return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">`);
  }
  dispose(): void { clearInterval(this.interval);const panels=[...this.panels.keys()];this.panels.clear();this.lastPanel=undefined;for(const panel of panels)panel.dispose();this.presenceEmitter.dispose();for (const disposable of this.disposables) disposable.dispose(); }
}
