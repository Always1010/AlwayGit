import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WindowBridge, canonicalPath, type ProjectRequest, type WindowRecord } from '../application/window-bridge';
import type { GitDocuments } from '../editor/documents';
import type { RepositoryManager } from '../repositories/manager';
import type { DiffTarget } from '../protocol/types';

/** Routes only to windows where the repository is part of the actual workspace. */
export class ProjectWindows implements vscode.Disposable {
  readonly bridge: WindowBridge;
  private readonly disposables: vscode.Disposable[] = [];
  private focusCommand = false;
  private readonly opening = new Map<string, Promise<WindowRecord>>();
  constructor(context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel, private readonly repositories: RepositoryManager, private readonly documents: GitDocuments) {
    const scope = createHash('sha256').update([context.globalStorageUri.toString(), vscode.env.appRoot, vscode.env.remoteName ?? '', process.env.VSCODE_IPC_HOOK ?? ''].join('|')).digest('hex').slice(0, 24);
    this.bridge = new WindowBridge(path.join(tmpdir(), 'alwaygit-windows-' + scope), request => this.execute(request), message => this.log.appendLine('[project-window] ' + message));
  }
  private roots(): string[] { return (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath); }
  async start(): Promise<void> {
    this.focusCommand = (await vscode.commands.getCommands(true)).includes('workbench.action.focusWindow');
    await this.bridge.start(this.roots(), vscode.window.state.focused);
    const update = () => { void this.bridge.update(this.roots(), vscode.window.state.focused).catch(error => this.log.appendLine(String(error))); };
    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(update), vscode.window.onDidChangeWindowState(update));
  }
  async openProject(root: string): Promise<void> { await this.route({ root, action: 'project' }); }
  async openFile(root: string, filename: string): Promise<void> { await this.route({ root, action: 'file', path: filename }); }
  async openDiff(root: string, target: DiffTarget): Promise<void> { await this.route({ root, action: 'diff', target }); }
  private async execute(request: ProjectRequest): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new Error('Trust the project workspace before opening it from AlwayGit.');
    if (request.action !== 'project') {
      const repo = await this.repositories.add(request.root, false);
      if (await canonicalPath(repo.root) !== request.root) throw new Error('The repository directory changed. Reopen it from AlwayGit.');
      if (request.action === 'file') await this.documents.openFile(repo, request.path);
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
      if (!workspace) throw new Error('The project window has no workspace to activate.');
      await vscode.commands.executeCommand('vscode.openFolder', workspace, { forceNewWindow: false, noRecentEntry: true });
    }
    const deadline = Date.now() + 4000;
    while (!vscode.window.state.focused && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    if (!vscode.window.state.focused) throw new Error('VS Code could not activate the selected project window. Switch to that window and try again.');
  }
  private async route(request: ProjectRequest): Promise<void> {
    const root = await canonicalPath(request.root);
    const existing = await this.find(root);
    if (existing) { await WindowBridge.send(existing, { ...request, root }); return; }
    let opened = this.opening.get(root);
    if (!opened) {
      opened = this.openAndWait(root);
      this.opening.set(root, opened);
      void opened.finally(() => { if (this.opening.get(root) === opened) this.opening.delete(root); }).catch(() => {});
    }
    // Concurrent clicks share startup, but each action is delivered once after readiness.
    await WindowBridge.send(await opened, { ...request, root });
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
    throw new Error('The project was opened, but AlwayGit did not respond. Enable AlwayGit and trust that project window, then try again.');
  }
  dispose(): void { this.bridge.dispose(); for (const disposable of this.disposables) disposable.dispose(); }
}
