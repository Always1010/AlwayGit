import * as vscode from 'vscode';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WindowBridge, canonicalPath, type ProjectRequest, type WindowRecord } from '../application/window-bridge';

/** Routes only to windows where the repository is part of the actual workspace. */
export class ProjectWindows implements vscode.Disposable {
  readonly bridge: WindowBridge;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly focusTokens = new Set<string>();
  private readonly opening = new Map<string, Promise<WindowRecord>>();
  constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel) {
    const scope = createHash('sha256').update([context.globalStorageUri.toString(), vscode.env.appRoot, vscode.env.remoteName ?? '', process.env.VSCODE_IPC_HOOK ?? ''].join('|')).digest('hex').slice(0, 24);
    this.bridge = new WindowBridge(path.join(tmpdir(), 'alwaygit-windows-' + scope), request => this.execute(request), message => this.log.appendLine('[project-window] ' + message));
    this.disposables.push(vscode.window.registerUriHandler({ handleUri: uri => {
      const token = new URLSearchParams(uri.query).get('token');
      if (uri.path === '/focus-project' && token && this.focusTokens.delete(token)) return;
      throw new Error('This project window request has expired.');
    } }));
  }
  private roots(): string[] { return (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath); }
  async start(): Promise<void> {
    await this.bridge.start(this.roots(), vscode.window.state.focused);
    const update = () => { void this.bridge.update(this.roots(), vscode.window.state.focused).catch(error => this.log.appendLine(String(error))); };
    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(update), vscode.window.onDidChangeWindowState(update));
  }
  async openProject(root: string): Promise<void> { await this.route({ root, action: 'project' }); }
  private async execute(_request: ProjectRequest): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new Error('Trust the project workspace before opening it from AlwayGit.');
    await this.focus();
  }
  private async focus(): Promise<void> {
    if (vscode.window.state.focused) return;
    const token = randomBytes(24).toString('hex');
    this.focusTokens.add(token);
    try {
      // Resolve in the receiving window. Never construct or edit VS Code's internal windowId.
      const callback = await vscode.env.asExternalUri(vscode.Uri.from({ scheme: vscode.env.uriScheme, authority: this.context.extension.id, path: '/focus-project', query: 'token=' + token }));
      if (!await vscode.env.openExternal(callback)) throw new Error('VS Code could not activate the project window.');
      const deadline = Date.now() + 4000;
      while (this.focusTokens.has(token) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      if (this.focusTokens.has(token)) throw new Error('VS Code did not activate the selected project window.');
    } finally { this.focusTokens.delete(token); }
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
