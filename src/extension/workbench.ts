import { message, MessageError } from '../i18n';
import { translate, type MessageKey, type MessageArgs } from '../i18n/index';
import { TerminalSessions } from '../application/terminal-sessions';
import { spawnTerminal, terminalShell } from './terminal-runtime';
import { terminalAckSchema, terminalCreateSchema, terminalIdSchema, terminalInputSchema, terminalResizeSchema, terminalRenameSchema } from '../protocol/terminal';
import { SnapshotCoordinator } from '../application/snapshot-coordinator';
import { QueryCoordinator } from '../application/query-coordinator';
import { readQueryCategory } from '../protocol/queries';
import { externalUrlSchema, remoteLinksSchema, cancelQuerySchema, actionSchema, operationSettingsSchema, requestSchema, historySchema, detailsSchema, comparisonSchema, cherryPickCheckSchema, diffSchema, fileSchema, sessionSchema, copySchema, openRepositorySchema, openWorkbenchSchema, openWorktreeSchema, repositoryKeysSchema, repositoryCollectionSchema, moveRepositoriesSchema, repositoryDiscoverySchema, cancelRepositoryDiscoverySchema, addRepositoriesSchema, reorderRepositorySchema, createRepositoryCollectionSchema } from '../protocol/validation';
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AddRepositoriesResult, GitAction, GitServiceContract, HostMessage, RepositoryChanges, RepositoryCollection, RepositoryDiscoveryPreview, RepositoryStatus, RpcRequest, Snapshot, OperationSettings, PushResult } from '../protocol/types';

import type { RepositoryManager } from '../repositories/manager';
import type { DiscoveryResult } from '../repositories/discovery';
import type { GitDocuments } from '../editor/documents';
import { confirmAction } from '../application/confirm';
import { redactSecrets, requestErrorText, serializeRequestError } from '../application/logging';
import { hostText, preferredLanguage, type Language } from '../application/language';
import type { ProjectWindows } from './project-windows';
import { groupRepositories } from '../protocol/repositories';
import { panelSession } from './workbench-entry';
import { mergeSessionBaseline, SessionWriter } from '../application/session-persistence';
import type { SessionState } from '../protocol/session';
import { interfaceSettingsSchema, interfaceSettingsUpdateSchema, legacyInterfaceSettings, mergeInterfaceSettings, overlayInterfaceSettings, type InterfacePreferences } from '../protocol/interface-settings';
import { RepositoryOperationBusyError, RepositoryOperationRecoveryRequiredError } from '../application/operation-lock';
import { discardRequestSchema } from '../protocol/validation';

interface WorkbenchPanel { panel: vscode.WebviewPanel; visible: boolean; activeRepository?: string; blank: boolean; session?: SessionState; savedSession?: SessionState; pendingTerminal?: boolean; pendingChanges?: { repoId: string; changes?: RepositoryChanges }; catalogDirty?: boolean }
interface RepositoryDiscoverySession { source?: WorkbenchPanel; cancelled: boolean; root: string; discovery?: DiscoveryResult }
export interface WorkbenchPresence { open: boolean; active: boolean }

export class Workbench implements vscode.Disposable {
  private readonly panels = new Map<vscode.WebviewPanel, WorkbenchPanel>();
  private lastPanel?: WorkbenchPanel;
  private readonly terminals = new TerminalSessions(spawnTerminal, (owner, event) => this.post(event, owner as WorkbenchPanel));
  private activeRepository?: string;
  private readonly snapshots = new SnapshotCoordinator();
  private readonly queries = new QueryCoordinator();
  private readonly fingerprints = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly busy = new Set<string>();
  private readonly externalBusy = new Map<string, { label: string }>();
  private polling = false;
  private requestCount = 0;
  private readonly repositoryDiscoveries = new Map<string, RepositoryDiscoverySession>();
  private readonly presenceEmitter = new vscode.EventEmitter<WorkbenchPresence>();
  readonly onDidChangePresence = this.presenceEmitter.event;
  get presence(): WorkbenchPresence { return { open: this.panels.size > 0, active: [...this.panels.keys()].some(panel => panel.active) }; }
  /** Diagnostic count used to verify the real Webview message bridge. */
  get receivedWebviewRequests(): number { return this.requestCount; }
  private readonly interval: ReturnType<typeof setInterval>;
  private initialScan?: Promise<void>;
  private preferenceMigration?: Promise<void>;
  private preferenceWrites: Promise<unknown> = Promise.resolve();
  private interfaceSettings(): InterfacePreferences {
    const configuration = vscode.workspace.getConfiguration('alwaygit');
    const parsed = interfaceSettingsSchema.safeParse(configuration.get('interfaceSettings', {}));
    return { ...(parsed.success ? parsed.data : {}), language: preferredLanguage() };
  }
  private migrateInterfaceSettings(): Promise<void> {
    return this.preferenceMigration ??= (async () => {
      const configuration = vscode.workspace.getConfiguration('alwaygit');
      const legacy = legacyInterfaceSettings(this.context.workspaceState.get<SessionState>('alwaygit.session', {}));
      const { language, ...settings } = legacy;
      if (configuration.inspect?.('interfaceSettings')?.globalValue === undefined && Object.keys(settings).length) {
        await configuration.update('interfaceSettings', settings, vscode.ConfigurationTarget.Global);
      }
      if (configuration.inspect?.('language')?.globalValue === undefined && language) {
        await configuration.update('language', language, vscode.ConfigurationTarget.Global);
      }
    })().catch(error => { this.preferenceMigration = undefined; throw error; });
  }
  private readonly sessions = new SessionWriter(session => this.context.workspaceState.update('alwaygit.session', session));
  private operationSettings(): OperationSettings { const configuration=vscode.workspace.getConfiguration('alwaygit'),configuredResetMode=configuration.get<string>('defaultResetMode','mixed'),defaultResetMode:OperationSettings['defaultResetMode']=['soft','mixed','hard'].includes(configuredResetMode)?configuredResetMode as OperationSettings['defaultResetMode']:'mixed';return { allowDetachedHead: configuration.get<boolean>('allowDetachedHead', false) === true, pushFollowTags: configuration.get<boolean>('pushFollowTags', false) === true, pushTagAfterCreate: configuration.get<boolean>('pushTagAfterCreate', false) === true, defaultResetMode, scope: vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length ? 'workspace' : 'user' }; }
  private readonly requestLanguage = new AsyncLocalStorage<Language>();
  private panelLanguage(_source?: WorkbenchPanel): Language { return preferredLanguage(); }
  private language(): Language { return this.requestLanguage.getStore() ?? this.panelLanguage(); }
  private text<K extends MessageKey>(key: K, ...args: MessageArgs<K>): string { return hostText(this.language(), key, ...args); }
  private repositoryKey(commonDir: string): string { const resolved=path.resolve(commonDir);return process.platform==='win32'?resolved.toLowerCase():resolved; }
  private isBusy(commonDir: string): boolean { const key=this.repositoryKey(commonDir);return this.busy.has(key)||this.externalBusy.has(key); }
  constructor(private readonly context: vscode.ExtensionContext, private readonly git: GitServiceContract, private readonly repositories: RepositoryManager, private readonly documents: GitDocuments, private readonly output: vscode.OutputChannel, private readonly projects: ProjectWindows) {
    this.disposables.push(repositories.onDidChange(event => { this.snapshots.invalidate(event.repoId); this.post({ type: 'changed', ...event }); }), repositories.onDidChangeRepositories(() => {
      for (const entry of this.panels.values()) this.updatePanelTitle(entry);
      this.post({ type: 'repositoriesChanged' });
    }));
    this.disposables.push(vscode.workspace.onDidChangeConfiguration(event => { if (['allowDetachedHead','pushFollowTags','pushTagAfterCreate','defaultResetMode'].some(name=>event.affectsConfiguration(`alwaygit.${name}`))) this.post({ type: 'operationSettingsChanged', settings: this.operationSettings() }); }));
    this.disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('alwaygit.interfaceSettings') || event.affectsConfiguration('alwaygit.language')) {
        this.post({ type: 'interfaceSettingsChanged', settings: this.interfaceSettings() });
      }
    }));
    const seconds = vscode.workspace.getConfiguration('alwaygit').get<number>('refreshInterval', 15);
    this.interval = setInterval(() => void this.poll(), seconds * 1000);
  }
  /** Share startup discovery with data requests, without holding up panel creation. */
  initializeRepositories(): Promise<void> {
    if (!this.initialScan) {
      const scan = this.repositories.scan().catch(error => {
        if (this.initialScan === scan) this.initialScan = undefined;
        throw error;
      });
      this.initialScan = scan;
    }
    return this.initialScan;
  }
  async open(repoId?: string, restoredPanel?: vscode.WebviewPanel, newTab = false, blank = false): Promise<void> {
    if (!vscode.workspace.isTrusted) { await vscode.window.showWarningMessage(this.text("host.trustThisWorkspaceUsingVSCodeWorkspaceTrustThen")); return; }
    if (repoId) this.activeRepository = repoId;
    const existing=!restoredPanel&&!newTab?([...this.panels.values()].find(entry=>entry.panel.active)??this.lastPanel??[...this.panels.values()].at(-1)):undefined;
    if(existing){existing.panel.reveal();this.lastPanel=existing;this.post({type:'repositoriesChanged'},existing);if(repoId)this.selectPanelRepository(existing,repoId);this.presenceEmitter.fire(this.presence);return;}
    const options = { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')] };
    const panel = restoredPanel ?? vscode.window.createWebviewPanel('alwaygit.workbench', 'AlwayGit', vscode.ViewColumn.Active, options);
    panel.webview.options = options;
    const entry:WorkbenchPanel={panel,visible:panel.visible,activeRepository:repoId,blank,savedSession:this.context.workspaceState.get<SessionState>('alwaygit.session',{})};
    this.panels.set(panel,entry);this.lastPanel=entry;this.updatePanelTitle(entry);this.presenceEmitter.fire(this.presence);
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'alwaygit.svg');
    panel.onDidDispose(() => { this.terminals.disposeOwner(entry);this.queries.cancelOwner(entry);this.panels.delete(panel);for(const [id,scan] of this.repositoryDiscoveries)if(scan.source===entry){scan.cancelled=true;this.repositoryDiscoveries.delete(id);}if(this.lastPanel===entry)this.lastPanel=[...this.panels.values()].at(-1);this.presenceEmitter.fire(this.presence); });
    panel.webview.onDidReceiveMessage(async (raw: unknown) => {
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) return;
      this.requestCount++;
      try { const result = await this.handleRequest(parsed.data,entry); this.post({ type: 'response', id: parsed.data.id, result },entry); }
      catch (error) {
        const failure = serializeRequestError(error, this.panelLanguage(entry));
        this.output.appendLine(`[request:${parsed.data.method}] ${requestErrorText(failure)}`);
        this.post({ type: 'response', id: parsed.data.id, error: failure },entry);
      }
    });
    panel.onDidChangeViewState(event => {
      const revealed = event.webviewPanel.visible && !entry.visible;
      entry.visible = event.webviewPanel.visible;
      if (event.webviewPanel.active) { this.lastPanel=entry; if(entry.session)void this.saveSessionBaseline(entry.session,entry).catch(error=>this.output.appendLine(`[session] ${redactSecrets(String(error))}`)); }
      if (revealed) {
        if (entry.catalogDirty) { entry.catalogDirty = false; this.post({ type: 'repositoriesChanged' }, entry); }
        const pending = entry.pendingChanges; entry.pendingChanges = undefined;
        if (entry.activeRepository) this.post({ type: 'changed', repoId: entry.activeRepository, changes: pending?.repoId === entry.activeRepository ? pending.changes : { paths: [] } }, entry);
      }
      this.presenceEmitter.fire(this.presence);
    });
    panel.webview.html = await this.html(panel.webview,repoId,blank);
  }
  async requestTerminal(): Promise<void> {
    await this.open();
    const target = [...this.panels.values()].find(entry => entry.panel.active) ?? this.lastPanel;
    if (target) {
      if (target.session?.repoId) this.post({ type: 'terminalRequested' }, target);
      else target.pendingTerminal = true;
    }
  }
  async pickRepositoryDirectory():Promise<string|undefined>{
    const selected=await vscode.window.showOpenDialog({canSelectFolders:true,canSelectFiles:false,canSelectMany:false,title:this.text("host.selectARepositoryOrAFolderContainingRepositories"),openLabel:this.text("host.scanFolder")});
    return selected?.[0]?.fsPath;
  }
  async discoverRepositories(scanId:string,root:string,source?:WorkbenchPanel):Promise<RepositoryDiscoveryPreview>{
    for(const [id,scan] of this.repositoryDiscoveries)if(scan.source===source){scan.cancelled=true;this.repositoryDiscoveries.delete(id);}
    const session:RepositoryDiscoverySession={source,cancelled:false,root};this.repositoryDiscoveries.set(scanId,session);
    try{
      const discovery=await this.repositories.discoverDirectory(root,{isCancelled:()=>session.cancelled,onProgress:progress=>this.post({type:'repositoryDiscoveryProgress',scanId,...progress},source)});
      session.discovery=discovery;
      for(const issue of discovery.issues)this.output.appendLine(redactSecrets(`[discovery] ${issue.path}: ${issue.message}`));
      const issues=discovery.issues.map(issue=>({...issue,message:redactSecrets(issue.message)}));
      if(discovery.cancelled){this.repositoryDiscoveries.delete(scanId);return {scanId,root,scanned:discovery.scanned,found:discovery.found,cancelled:true,candidates:[],issues};}
      const existingKeys=new Set(this.repositories.groups().map(group=>group.key));
      const candidates=groupRepositories(discovery.repositories).map(group=>({key:group.key,name:group.name,path:group.repository.root,existing:existingKeys.has(group.key)})).sort((left,right)=>left.name.localeCompare(right.name));
      return {scanId,root,scanned:discovery.scanned,found:discovery.found,cancelled:false,candidates,issues};
    }catch(error){this.repositoryDiscoveries.delete(scanId);throw error;}
  }
  cancelRepositoryDiscovery(scanId:string,source?:WorkbenchPanel):void{const session=this.repositoryDiscoveries.get(scanId);if(!session||session.source!==source)return;session.cancelled=true;if(session.discovery)this.repositoryDiscoveries.delete(scanId);}
  async addRepository(scanId:string,keys:string[],collectionId:string|undefined,newCollectionName:string|undefined,source?:WorkbenchPanel):Promise<AddRepositoriesResult>{
    const session=this.repositoryDiscoveries.get(scanId);if(!session||session.source!==source||!session.discovery||session.discovery.cancelled)throw new Error(this.text("host.theRepositoryScanHasExpiredScanTheFolderAgain"));
    this.repositoryDiscoveries.delete(scanId);
    const discoveredGroups=groupRepositories(session.discovery.repositories),availableKeys=new Set(discoveredGroups.map(group=>group.key)),selectedKeys=new Set(keys.filter(key=>availableKeys.has(key)));
    if(!selectedKeys.size)throw new Error(this.text("host.selectAtLeastOneAvailableRepository"));
    if(collectionId&&!this.repositories.collections().some(collection=>collection.id===collectionId))throw new Error(this.text("host.theSelectedRepositoryGroupNoLongerExists"));
    if(newCollectionName){const problem=this.collectionNameProblem(newCollectionName);if(problem)throw new Error(problem);}
    const repositories=discoveredGroups.filter(group=>selectedKeys.has(group.key)).flatMap(group=>group.members);
    const result=await this.repositories.registerDiscovered({...session.discovery,repositories,found:selectedKeys.size},{},{collectionId,newCollectionName});
    // Existing candidates can change collection assignments without adding a new repository.
    if(result.added||result.existing||result.collection)await this.projects.notifyCatalogChanged();
    return {added:result.added,existing:result.existing,skipped:result.issues.length,...(result.collection?{collection:result.collection}:{})};
  }
  async removeRepositories(keys: string[]): Promise<number> {
    const groups=this.repositories.groups().filter(group=>keys.includes(group.key));
    if(!groups.length)return 0;
    if(groups.some(group=>group.members.some(repo=>this.isBusy(repo.commonDir))))throw new Error(this.text("host.waitForTheRunningGitOperationBeforeRemovingThis"));
    const removed=await this.repositories.remove(groups.map(group=>group.key));if(removed)await this.projects.notifyCatalogChanged();return removed;
  }
  async createRepositoryCollection(name:string): Promise<RepositoryCollection> {
    const problem=this.collectionNameProblem(name);if(problem)throw new Error(problem);
    const collection=await this.repositories.createCollection(name);await this.projects.notifyCatalogChanged();return collection;
  }
  async renameRepositoryCollection(id:string):Promise<void>{const collection=this.repositories.collections().find(item=>item.id===id);if(!collection)return;const name=await vscode.window.showInputBox({title:this.text("host.renameRepositoryGroup"),value:collection.name,validateInput:value=>this.collectionNameProblem(value,id)});if(name!==undefined){await this.repositories.renameCollection(id,name);await this.projects.notifyCatalogChanged();}}
  async deleteRepositoryCollection(id:string):Promise<void>{const collection=this.repositories.collections().find(item=>item.id===id);if(!collection)return;const remove=this.text("host.deleteGroup"),confirmed=await vscode.window.showWarningMessage(this.text("host.deleteRepositoryGroupItsRepositoriesWillRemainAtThe", { name: (collection.name) }),{modal:true},remove);if(confirmed===remove){await this.repositories.deleteCollection(id);await this.projects.notifyCatalogChanged();}}
  async moveRepositories(keys:string[]):Promise<number>{const collections=this.repositories.collections();type Destination=vscode.QuickPickItem&{collectionId?:string};const choices:Destination[]=[{label:this.text("host.repositoryRoot"),description:this.text("host.placeAlongsideRepositoryGroups")},...collections.map(collection=>({label:collection.name,collectionId:collection.id}))];const destination=await vscode.window.showQuickPick(choices,{title:this.text("host.moveRepositories", { count: (keys.length) }),placeHolder:this.text("host.chooseARepositoryGroupOrTheRepositoryRoot")});if(!destination)return 0;const moved=await this.repositories.move(keys,destination.collectionId);if(moved)await this.projects.notifyCatalogChanged();return moved;}
  private collectionNameProblem(value:string,currentId?:string):string|undefined{const name=value.trim();if(!name)return this.text("host.enterAGroupName");if(name.length>80)return this.text("host.useNoMoreThan80Characters");if(this.repositories.collections().some(item=>item.id!==currentId&&item.name.localeCompare(name,undefined,{sensitivity:'accent'})===0))return this.text("host.aGroupWithThisNameAlreadyExists");return undefined;}
  /** All UI requests go through the same validated, trusted application boundary. */
  async handle(request: RpcRequest): Promise<unknown> { return this.handleRequest(request); }
  private async handleRequest(request: RpcRequest, source?:WorkbenchPanel): Promise<unknown> {
    return this.requestLanguage.run(this.panelLanguage(source), () => this.routeRequest(request, source));
  }
  private async routeRequest(request: RpcRequest, source?:WorkbenchPanel): Promise<unknown> {
    if(request.method==='cancelQuery'){this.queries.cancelOwner(source??this,cancelQuerySchema.parse(request.payload).requestId);return null;}
    const category=readQueryCategory(request.method);
    if(category)return this.queries.run(source??this,category,request.id,signal=>this.git.withReadSignal?this.git.withReadSignal(signal,()=>this.executeRequest(request,source)):this.executeRequest(request,source));
    return this.executeRequest(request,source);
  }
  private async executeRequest(request: RpcRequest, source?:WorkbenchPanel): Promise<unknown> {
    if (request.method === 'interfaceSettings') { await this.migrateInterfaceSettings(); return this.interfaceSettings(); }
    if (request.method === 'saveInterfaceSettings') {
      const update = interfaceSettingsUpdateSchema.parse(request.payload);
      const write = this.preferenceWrites.catch(() => {}).then(async () => {
        await this.migrateInterfaceSettings();
        const configuration = vscode.workspace.getConfiguration('alwaygit');
        const { language, ...settings } = mergeInterfaceSettings(this.interfaceSettings(), update);
        await configuration.update('interfaceSettings', settings, vscode.ConfigurationTarget.Global);
        if (update.language !== undefined) await configuration.update('language', language, vscode.ConfigurationTarget.Global);
        const saved = this.interfaceSettings();
        this.post({ type: 'interfaceSettingsChanged', settings: saved }); return saved;
      });
      this.preferenceWrites = write; return write;
    }
    if (request.method === 'operationSettings') return this.operationSettings();
    if (request.method === 'saveOperationSettings') {
      const settings = operationSettingsSchema.parse(request.payload);
      const target=this.operationSettings().scope === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global,configuration=vscode.workspace.getConfiguration('alwaygit');
      await configuration.update('allowDetachedHead', settings.allowDetachedHead, target);
      await configuration.update('pushFollowTags', settings.pushFollowTags, target);
      await configuration.update('pushTagAfterCreate', settings.pushTagAfterCreate, target);
      await configuration.update('defaultResetMode', settings.defaultResetMode, target);
      const saved = this.operationSettings(); this.post({ type: 'operationSettingsChanged', settings: saved }); return saved;
    }
    if (request.method === 'openKeyboardShortcuts') { await vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', '@ext:alwaygit-dev.alwaygit'); return null; }
    if (request.method === 'showLog') { this.output.show(true); return null; }
    if (request.method === 'saveSession') {
      const session = sessionSchema.parse(request.payload);
      if (source) {
        if(source.activeRepository!==session.repoId)this.queries.cancelOwner(source);
        source.session = session;
        source.activeRepository = session.repoId;
        source.blank = source.blank && !session.repoId;
        this.updatePanelTitle(source);
      }
      // Hidden panels retain their own Webview state without replacing the active baseline.
      if (!source || source.panel.active) await this.saveSessionBaseline(session, source);
      return null;
    }
    if (request.method === 'openExternal') { const data = externalUrlSchema.parse(request.payload); if (!await vscode.env.openExternal(vscode.Uri.parse(data.url))) throw new Error(this.text('host.couldNotOpenWebLink')); return null; }
    if (request.method === 'copyText') { await vscode.env.clipboard.writeText(copySchema.parse(request.payload).text); return null; }
    if (!vscode.workspace.isTrusted) throw new Error(this.text("host.gitExecutionRequiresATrustedWorkspace"));
    if (['repositories', 'repositoryCollections', 'repositoryOrder'].includes(request.method)) await this.initializeRepositories();
    if (request.method === 'repositories') { const list = this.repositories.list(),active=source?.activeRepository??this.activeRepository; return active ? list.sort((a, b) => Number(b.id === active) - Number(a.id === active)) : list; }
    if (request.method === 'repositoryCollections') return this.repositories.collections();
    if (request.method === 'repositoryOrder') return this.repositories.order();
    if (request.method === 'reorderRepository') { await this.repositories.reorder(reorderRepositorySchema.parse(request.payload)); await this.projects.notifyCatalogChanged(); return this.repositories.order(); }
    if (request.method === 'repositoryStatuses') return this.repositoryStatuses();
    if(request.method==='pickRepositoryDirectory')return this.pickRepositoryDirectory();
    if(request.method==='discoverRepositories'){const data=repositoryDiscoverySchema.parse(request.payload);return this.discoverRepositories(data.scanId,data.path,source);}
    if(request.method==='cancelRepositoryDiscovery'){const data=cancelRepositoryDiscoverySchema.parse(request.payload);this.cancelRepositoryDiscovery(data.scanId,source);return null;}
    if(request.method==='addRepository'){const data=addRepositoriesSchema.parse(request.payload);return this.addRepository(data.scanId,data.keys,data.collectionId,data.newCollectionName,source);}
    if (request.method === 'removeRepositories') return this.removeRepositories(repositoryKeysSchema.parse(request.payload).keys);
    if (request.method === 'createRepositoryCollection') return this.createRepositoryCollection(createRepositoryCollectionSchema.parse(request.payload).name);
    if (request.method === 'renameRepositoryCollection') { await this.renameRepositoryCollection(repositoryCollectionSchema.parse(request.payload).id); return null; }
    if (request.method === 'deleteRepositoryCollection') { await this.deleteRepositoryCollection(repositoryCollectionSchema.parse(request.payload).id); return null; }
    if (request.method === 'moveRepositories') { const data=moveRepositoriesSchema.parse(request.payload);if(data.collectionId===undefined)return this.moveRepositories(data.keys);const moved=await this.repositories.move(data.keys,data.collectionId);if(moved)await this.projects.notifyCatalogChanged();return moved; }
    if(request.method==='openWorkbench'){const data=openWorkbenchSchema.parse(request.payload??{});if(data.newTab)await this.open(undefined,undefined,true,true);else await this.projects.openBlankWorkbenchInNewWindow();return null;}
    if (request.method === 'pickWorktree') {
      const value = await vscode.window.showSaveDialog({ title: this.text("host.newWorktreeDirectory"), saveLabel: this.text("host.useDirectory"), defaultUri: vscode.Uri.file(path.join(path.dirname(this.repositories.get(request.repoId).root), 'new-worktree')) });
      return value?.fsPath;
    }
    if (request.method.startsWith('terminal')) {
      if (!source || !this.panels.has(source.panel)) throw new MessageError(message('dock.liveWorkbench'));
      if (request.method === 'terminalList') return this.terminals.list(source);
      if (request.method === 'terminalCreate') {
        const data = terminalCreateSchema.parse(request.payload);
        const repository = this.repositories.get(request.repoId);
        return this.terminals.create(source, repository.id, repository.root, data.shell, terminalShell(data.shell), data.cols, data.rows);
      }
      const { sessionId } = terminalIdSchema.parse({ sessionId: (request.payload as { sessionId?: unknown } | undefined)?.sessionId });
      switch (request.method) {
        case 'terminalClipboard': terminalIdSchema.parse(request.payload); this.terminals.snapshot(source, sessionId); return vscode.env.clipboard.readText();
        case 'terminalAck': this.terminals.acknowledge(source, sessionId, terminalAckSchema.parse(request.payload).sequence); break;
        case 'terminalSync': terminalIdSchema.parse(request.payload); return this.terminals.snapshot(source, sessionId);
        case 'terminalInput': this.terminals.input(source, sessionId, terminalInputSchema.parse(request.payload).data); break;
        case 'terminalResize': { const data = terminalResizeSchema.parse(request.payload); this.terminals.resize(source, sessionId, data.cols, data.rows); break; }
        case 'terminalClose': terminalIdSchema.parse(request.payload); this.terminals.close(source, sessionId); break;
        case 'terminalStop': terminalIdSchema.parse(request.payload); this.terminals.stop(source, sessionId); break;
        case 'terminalRename': this.terminals.rename(source, sessionId, terminalRenameSchema.parse(request.payload).title); break;
        case 'terminalRestart': {
          terminalIdSchema.parse(request.payload);
          const previous = this.terminals.snapshot(source, sessionId);
          if (previous.status !== 'exited') throw new MessageError(message('dock.stopBeforeRestart'));
          const repository = this.repositories.get(previous.repoId);
          return this.terminals.create(source, repository.id, previous.cwd, previous.shell, terminalShell(previous.shell), 80, 24, sessionId);
        }
      }
      return null;
    }
    const repo = this.repositories.get(request.repoId);
    switch (request.method) {
      case 'snapshot': {
        if (source?.pendingTerminal) { source.pendingTerminal = false; this.post({ type: 'terminalRequested' }, source); }
        if(source&&source.activeRepository!==repo.id)this.queries.cancelOwner(source);
        this.activeRepository = repo.id;if(source){source.activeRepository=repo.id;this.lastPanel=source;this.updatePanelTitle(source);}
        const snapshot = await this.snapshots.read(repo.id, () => this.git.snapshot(repo)); this.recordFingerprint(snapshot); return snapshot;
      }
      case 'remoteLinks': { const data=remoteLinksSchema.parse(request.payload??{});return this.git.remoteLinks?.(repo,data.remote,data.branch)??{repositories:[]}; }
      case 'history': return this.git.history(repo, { limit: vscode.workspace.getConfiguration('alwaygit').get<number>('historyPageSize', 300), ...historySchema.parse(request.payload ?? {}) });
      case 'cherryPickCheck': { const data=cherryPickCheckSchema.parse(request.payload); return this.git.cherryPickCheck(repo,data.commits,data); }
      case 'operationReview': return this.git.reviewOperation(repo);
      case 'prepareDiscard': return this.git.prepareDiscard(repo, discardRequestSchema.parse(request.payload));
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
        const snapshot = await this.snapshots.read(repo.id, () => this.git.snapshot(repo));
        const normalized = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
        const worktree = snapshot.worktrees.find(w => normalized(w.path) === normalized(data.path));
        if (!worktree || worktree.bare) throw new Error(this.text("host.selectARegisteredNonBareWorktree"));
        if (normalized(worktree.path) === normalized(repo.root) && !data.newWindow) { if(source)this.selectPanelRepository(source,repo.id);else await this.open(repo.id); return null; }
        const registered = await this.repositories.add(worktree.path);
        await this.projects.notifyCatalogChanged();
        if (data.newWindow !== false) await this.projects.openWorkbenchInNewWindow(worktree.path);
        else if(source)this.selectPanelRepository(source,registered.id);else await this.open(registered.id);
        return null;
      }
      case 'action': {
        let action: GitAction = actionSchema.parse(request.payload);
        await this.refreshExternalActivity(repo.commonDir);
        if (this.isBusy(repo.commonDir)) throw new Error(this.text("host.anOperationIsAlreadyRunningInThisRepository"));
        if (action.type === 'merge' || action.type === 'rebase' || action.type === 'reset' || action.type === 'discard') action = await this.git.prepareAction(repo, action);
        const operation = action.type === 'operation.abort' ? (await this.snapshots.read(repo.id, () => this.git.snapshot(repo))).operation : undefined;
        if (!await confirmAction(repo, action, this.language(), operation)) throw new Error(this.text("host.operationCancelled"));
        await this.refreshExternalActivity(repo.commonDir);
        if (this.isBusy(repo.commonDir)) throw new Error(this.text("host.anOperationIsAlreadyRunningInThisRepository"));
        const operationKey=this.repositoryKey(repo.commonDir);this.busy.add(operationKey);
        for (const member of this.repositories.list().filter(member => member.commonDir === repo.commonDir)) this.snapshots.invalidate(member.id);
        for (const r of this.repositories.list().filter(r => r.commonDir === repo.commonDir)) this.post({ type: 'activity', repoId: r.id, busy: true, label: action.type });
        let result: PushResult | void;
        try { result = await this.projects.runRepositoryOperation(repo.commonDir,action.type,()=>this.git.execute(repo, action, progress => this.post({ type: 'fileOperationProgress', repoId: repo.id, progress }))); }
        catch(error){
          if((error as {terminationUnconfirmed?:unknown})?.terminationUnconfirmed===true)this.externalBusy.set(operationKey,{label:action.type});
          if(error instanceof RepositoryOperationRecoveryRequiredError){
            const recover=this.text("host.removeProtection");
            const chosen=await vscode.window.showWarningMessage(this.text("host.thePreviousGitOperationWasInterrupted"),{modal:true,detail:this.text("host.confirmThatThePreviousAlwayGitWindowAndAllOf")},recover);
            if(chosen===recover){await this.projects.recoverRepositoryOperation(repo.commonDir,error.token);throw new Error(this.text("host.protectionRemovedRefreshTheRepositoryAndRetryTheOperation"));}
            throw error;
          }
          if(error instanceof RepositoryOperationBusyError)throw new Error(this.text("host.aGitOperationIsAlreadyRunningForThisRepository"));throw error;
        }
        finally {
          this.busy.delete(operationKey);
          for (const r of this.repositories.list().filter(r => r.commonDir === repo.commonDir)) { this.snapshots.invalidate(r.id); this.post({ type: 'activity', repoId: r.id, busy: this.isBusy(repo.commonDir), label: action.type }); this.post({ type: 'changed', repoId: r.id }); }
        }
        try {
          const snapshot = await this.snapshots.read(repo.id, () => this.git.snapshot(repo)); this.recordFingerprint(snapshot); return { snapshot, result };
        } catch (error) { return { result, refreshWarning: redactSecrets(error instanceof Error ? error.message : String(error)) }; }
      }
    }
  }
  private async saveSessionBaseline(session: SessionState, source?: WorkbenchPanel): Promise<void> {
    const panelBaseline = source?.savedSession, blank = source?.blank;
    await this.sessions.save(() => mergeSessionBaseline(this.context.workspaceState.get<SessionState>('alwaygit.session', {}), session, panelBaseline, blank));
    if (source) source.savedSession = session;
  }
  private async repositoryStatuses(): Promise<RepositoryStatus[]> {
    const repositories = this.repositories.list(), results: Array<RepositoryStatus | undefined> = new Array(repositories.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, repositories.length) }, async () => {
      while (next < repositories.length) {
        const index = next++, repo = repositories[index];
        try { results[index] = await this.git.repositoryStatus(repo); }
        catch (error) { this.output.appendLine(redactSecrets(translate('en', "host.repositoryStatus", { name: (repo.name), value: (error instanceof Error ? error.message : String(error)) }))); }
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
      await Promise.all([...this.externalBusy.keys()].map(key=>this.refreshExternalActivity(key).catch(error=>this.output.appendLine(redactSecrets(translate('en', "host.activityRefresh", { value: (error instanceof Error?error.message:String(error)) }))))));
      for(const id of ids){try{const repo=this.repositories.get(id);if(this.isBusy(repo.commonDir))continue;const previous=this.fingerprints.get(repo.id),snapshot=await this.snapshots.read(repo.id, () => this.git.snapshot(repo));if(this.recordFingerprint(snapshot)!==previous)this.post({type:'changed',repoId:repo.id,changes:{paths:[]},snapshot});}catch(error){this.output.appendLine(redactSecrets(translate('en', "host.refresh", { value: (error instanceof Error?error.message:String(error)) })));}}
    }
    finally { this.polling = false; }
  }
  private selectPanelRepository(entry:WorkbenchPanel,repoId:string):void {if(entry.activeRepository!==repoId)this.queries.cancelOwner(entry);entry.activeRepository=repoId;this.activeRepository=repoId;this.lastPanel=entry;this.updatePanelTitle(entry);entry.panel.reveal();this.post({type:'selectRepository',repoId},entry);}
  private async refreshExternalActivity(commonDir:string):Promise<void>{
    const key=this.repositoryKey(commonDir),activity=this.externalBusy.get(key);if(!activity)return;
    if(await this.projects.isRepositoryBusy(commonDir)||this.externalBusy.get(key)!==activity)return;
    this.externalRepositoryActivity(commonDir,false,activity.label);
  }
  externalRepositoryActivity(commonDir:string,busy:boolean,label:string):void {const key=this.repositoryKey(commonDir);if(busy)this.externalBusy.set(key,{label});else this.externalBusy.delete(key);for(const repo of this.repositories.list().filter(repo=>this.repositoryKey(repo.commonDir)===key)){this.post({type:'activity',repoId:repo.id,busy:this.isBusy(commonDir),label});if(!busy)this.post({type:'changed',repoId:repo.id});}}
  private updatePanelTitle(entry:WorkbenchPanel):void {let name:string|undefined;try{name=entry.activeRepository?groupRepositories(this.repositories.list(),entry.activeRepository).find(group=>group.members.some(repo=>repo.id===entry.activeRepository))?.name:undefined;}catch{/* Repository discovery can remove a stale restored ID. */}entry.panel.title=name?translate('en', "host.alwayGit", { name: (name) }):'AlwayGit';}
  private post(message: HostMessage, target?: WorkbenchPanel): void {
    for (const entry of target ? [target] : this.panels.values()) {
      // Retain invalidation on the host: hidden Webviews need not receive or process these messages.
      if (!entry.panel.visible && message.type === 'repositoriesChanged') { entry.catalogDirty = true; continue; }
      if (!entry.panel.visible && message.type === 'changed') {
        if (message.repoId === entry.activeRepository) {
          const previous = entry.pendingChanges;
          const changes = previous?.repoId !== message.repoId ? message.changes
            : previous.changes?.paths && message.changes?.paths
              ? { paths: [...new Set([...previous.changes.paths, ...message.changes.paths])], index: !!(previous.changes.index || message.changes.index) }
              : undefined;
          entry.pendingChanges = { repoId: message.repoId, changes };
        }
        continue;
      }
      void entry.panel.webview.postMessage(message);
    }
  }
  private async html(webview: vscode.Webview,activeRepository?:string,blank=false): Promise<string> {
    await this.migrateInterfaceSettings();
    const root = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    let html = await readFile(vscode.Uri.joinPath(root, 'index.html').fsPath, 'utf8');
    const nonce = randomBytes(20).toString('base64');
    html = html.replace(/(src|href)="\.\/([^"\s]+)"/g, (_match, attr, resource: string) => `${attr}="${webview.asWebviewUri(vscode.Uri.joinPath(root, resource))}"`);
    html = html.replace(/<script /g, `<script nonce="${nonce}" `);
    const saved = this.context.workspaceState.get<Record<string, unknown>>('alwaygit.session', {});
    const preferences = this.interfaceSettings();
    const session = JSON.stringify(overlayInterfaceSettings(panelSession(saved,activeRepository,blank) as SessionState, preferences)).replace(/</g, '\\u003c');
    const settings = JSON.stringify(preferences).replace(/</g, '\\u003c');
    html = html.replace('</head>', `<script nonce="${nonce}">window.__ALWAYGIT_SESSION__=${session};window.__ALWAYGIT_PREFERENCES__=${settings};</script></head>`);
    return html.replace('<head>', `<head><meta property="csp-nonce" nonce="${nonce}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">`);
  }
  dispose(): void { this.terminals.dispose();this.snapshots.dispose();this.queries.dispose();clearInterval(this.interval);for(const scan of this.repositoryDiscoveries.values())scan.cancelled=true;this.repositoryDiscoveries.clear();const panels=[...this.panels.keys()];this.panels.clear();this.lastPanel=undefined;for(const panel of panels)panel.dispose();this.presenceEmitter.dispose();for (const disposable of this.disposables) disposable.dispose(); }
}
