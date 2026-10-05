import { translate, message as localizeMessage, MessageError } from '../i18n/index';
import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WindowBridge, canonicalPath, type ProjectRequest, type WindowRecord } from '../application/window-bridge';
import { RepositoryOperationLock } from '../application/operation-lock';
import type { GitDocuments } from '../editor/documents';
import type { RepositoryManager } from '../repositories/manager';
import type { DiffTarget, OpenProjectResult } from '../protocol/types';

/** Routes only to windows where the repository is part of the actual workspace. */
export class ProjectWindows implements vscode.Disposable {
  readonly bridge: WindowBridge;
  private readonly operationLock: RepositoryOperationLock;
  private readonly disposables: vscode.Disposable[] = [];
  private focusCommand = false;
  private readonly opening = new Map<string, Promise<WindowRecord>>();
  constructor(context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel, private readonly repositories: RepositoryManager, private readonly documents: GitDocuments, private readonly showWorkbench: (repoId?: string, blank?: boolean) => Promise<void>, private readonly synchronizeRepositories: () => Promise<void> = async () => {}, private readonly repositoryActivity: (commonDir: string, busy: boolean, label: string) => void = () => {}) {
    const scope = createHash('sha256').update([context.globalStorageUri.toString(), vscode.env.appRoot, vscode.env.remoteName ?? '', process.env.VSCODE_IPC_HOOK ?? ''].join('|')).digest('hex').slice(0, 24);
    this.bridge = new WindowBridge(path.join(tmpdir(), 'alwaygit-windows-' + scope), request => this.execute(request), message => this.log.appendLine('[project-window] ' + message));
    this.operationLock = new RepositoryOperationLock(path.join(this.bridge.directory, 'operation-locks'), this.bridge.record.id);
  }
  private roots(): string[] { return (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath); }
  async start(): Promise<void> {
    this.focusCommand = (await vscode.commands.getCommands(true)).includes('workbench.action.focusWindow');
    await this.bridge.start(this.roots(), vscode.window.state.focused);
    const update = () => { void this.bridge.update(this.roots(), vscode.window.state.focused).catch(error => this.log.appendLine(String(error))); };
    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(update), vscode.window.onDidChangeWindowState(update));
  }
  async openProject(root: string): Promise<OpenProjectResult> {
    const canonical = await canonicalPath(root);
    const target = await this.route({ root: canonical, action: 'project' });
    if (target.id !== this.bridge.record.id) return { kind: 'other-window' };
    // Reveal the folder only in the requesting window. Other project windows
    // retain their editor and sidebar state when the command merely focuses them.
    await vscode.commands.executeCommand('workbench.files.action.focusFilesExplorer');
    try { await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(root)); }
    catch (error) { this.log.appendLine(translate('en', 'projectWindows.repositoryRevealFailed', { value: String(error) })); }
    return { kind: 'current-window', root, exactRoot: target.roots.length === 1 && target.roots.includes(canonical) };
  }
  async openWorkbenchInNewWindow(root: string): Promise<void> {
    const canonical = await canonicalPath(root), key = `workbench:${canonical}`;
    let opened = this.opening.get(key);
    if (!opened) {
      opened = this.openNewAndWait(canonical);
      this.opening.set(key, opened);
      void opened.finally(() => { if (this.opening.get(key) === opened) this.opening.delete(key); }).catch(() => {});
    }
    await WindowBridge.send(await opened, { root: canonical, action: 'workbench' });
  }
  async openBlankWorkbenchInNewWindow(): Promise<void> {
    const key = 'blank-workbench';
    let opened = this.opening.get(key);
    if (!opened) {
      opened = this.openBlankAndWait();
      this.opening.set(key, opened);
      void opened.finally(() => { if (this.opening.get(key) === opened) this.opening.delete(key); }).catch(() => {});
    }
    await WindowBridge.send(await opened, { action: 'show-workbench' });
  }
  async openFile(root: string, filename: string): Promise<void> { await this.route({ root, action: 'file', path: filename }); }
  async openDiff(root: string, target: DiffTarget): Promise<void> { await this.route({ root, action: 'diff', target }); }
  async notifyCatalogChanged(): Promise<void> { await this.bridge.broadcast({ action: 'catalog-changed' }); }
  async isRepositoryBusy(commonDir: string): Promise<boolean> { return this.operationLock.isBusy(await canonicalPath(commonDir)); }
  async recoverRepositoryOperation(commonDir: string, token: string): Promise<void> { await this.operationLock.recover(await canonicalPath(commonDir), token); }
  private async notifyActivity(commonDir: string, busy: boolean, label: string): Promise<void> {
    try { await this.bridge.broadcast({ action: 'repository-activity', commonDir, busy, label }); }
    catch (error) { try { this.log.appendLine(translate('en', "projectWindows.repositoryActivity", { value: (error instanceof Error ? error.message : String(error)) })); } catch { /* Disposal must not affect the Git operation or its lease. */ } }
  }
  async runRepositoryOperation<T>(commonDir: string, label: string, task: () => Promise<T>): Promise<T> {
    const canonical = await canonicalPath(commonDir), lease = await this.operationLock.acquire(canonical, label);
    let unconfirmed = false;
    try {
      await this.notifyActivity(canonical, true, label);
      await lease.markRunning();
      return await task();
    }
    catch (error) {
      if ((error as { terminationUnconfirmed?: unknown })?.terminationUnconfirmed === true) {
        unconfirmed = true;
        await lease.quarantine((error as { pid?: number }).pid);
      }
      throw error;
    }
    finally {
      if (!unconfirmed) {
        await lease.release();
        await this.notifyActivity(canonical, false, label);
      }
    }
  }
  private async execute(request: ProjectRequest): Promise<void> {
    if (request.action === 'catalog-changed') { await this.synchronizeRepositories(); return; }
    if (request.action === 'repository-activity') { this.repositoryActivity(request.commonDir, request.busy, request.label); return; }
    if (!vscode.workspace.isTrusted) throw new MessageError(localizeMessage("projectWindows.trustTheProjectWorkspaceBeforeOpeningItFromAlwayGit"));
    if (request.action === 'show-workbench') {
      await this.showWorkbench(undefined, true);
      await this.focus();
      return;
    }
    if (request.action !== 'project') {
      const repo = await this.repositories.add(request.root, false);
      if (await canonicalPath(repo.root) !== request.root) throw new MessageError(localizeMessage("projectWindows.theRepositoryDirectoryChangedReopenItFromAlwayGit"));
      if (request.action === 'workbench') await this.showWorkbench(repo.id);
      else if (request.action === 'file') await this.documents.openFile(repo, request.path);
      else await this.documents.diff(repo, request.target);
    }
    await this.focus();
  }
  private async focus(): Promise<void> {
    if (vscode.window.state.focused) return;
    if (this.focusCommand) await vscode.commands.executeCommand('workbench.action.focusWindow');
    else {
      // Older native builds reuse an already-open workspace by its identity, without changing its folders.
      const workspace = vscode.workspace.workspaceFile ?? vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!workspace) throw new MessageError(localizeMessage("projectWindows.theProjectWindowHasNoWorkspaceToActivate"));
      await vscode.commands.executeCommand('vscode.openFolder', workspace, { forceNewWindow: false, noRecentEntry: true });
    }
    const deadline = Date.now() + 4000;
    while (!vscode.window.state.focused && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    if (!vscode.window.state.focused) throw new MessageError(localizeMessage("projectWindows.vSCodeCouldNotActivateTheSelectedProjectWindow"));
  }
  private async route(request: ProjectRequest): Promise<WindowRecord> {
    if (request.action === 'show-workbench' || request.action === 'catalog-changed' || request.action === 'repository-activity') throw new MessageError(localizeMessage("projectWindows.aWindowLevelRequestCannotBeRoutedAsA"));
    const root = await canonicalPath(request.root);
    const existing = await this.find(root);
    if (existing) { await WindowBridge.send(existing, { ...request, root }); return existing; }
    let opened = this.opening.get(root);
    if (!opened) {
      opened = this.openAndWait(root);
      this.opening.set(root, opened);
      void opened.finally(() => { if (this.opening.get(root) === opened) this.opening.delete(root); }).catch(() => {});
    }
    // Concurrent clicks share startup, but each action is delivered once after readiness.
    const target = await opened;
    await WindowBridge.send(target, { ...request, root });
    return target;
  }
  private async find(root: string): Promise<WindowRecord | undefined> {
    for (const candidate of await this.bridge.candidates(root)) {
      try { await WindowBridge.send(candidate, undefined, 500); return candidate; }
      catch { /* A stale endpoint is not an open project window. */ }
    }
    return undefined;
  }
  private async openAndWait(root: string): Promise<WindowRecord> {
    const existing = await this.find(root);
    if (existing) return existing;
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), { forceNewWindow: true });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const candidate = await this.find(root);
      if (candidate) return candidate;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new MessageError(localizeMessage("projectWindows.theProjectWasOpenedButAlwayGitDidNotRespond"));
  }
  private async openNewAndWait(root: string): Promise<WindowRecord> {
    const previous = new Set((await this.bridge.candidates(root)).map(candidate => candidate.id));
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), { forceNewWindow: true });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      for (const candidate of await this.bridge.candidates(root)) {
        if (previous.has(candidate.id)) continue;
        try { await WindowBridge.send(candidate, undefined, 500); return candidate; }
        catch { /* The new extension host has not finished starting. */ }
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new MessageError(localizeMessage("projectWindows.theProjectWasOpenedInANewWindowBut"));
  }
  private async openBlankAndWait(): Promise<WindowRecord> {
    const previous = new Set((await this.bridge.windows()).map(candidate => candidate.id));
    await vscode.commands.executeCommand('workbench.action.newWindow');
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      for (const candidate of await this.bridge.windows()) {
        if (previous.has(candidate.id)) continue;
        try { await WindowBridge.send(candidate, undefined, 500); return candidate; }
        catch { /* The new extension host has not finished starting. */ }
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new MessageError(localizeMessage("projectWindows.theNewWindowOpenedButAlwayGitDidNotRespond"));
  }
  dispose(): void { this.operationLock.dispose();this.bridge.dispose(); for (const disposable of this.disposables) disposable.dispose(); }
}
