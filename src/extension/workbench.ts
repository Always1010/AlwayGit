import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { GitServiceContract, HostMessage, RpcRequest, Snapshot } from '../protocol/types';
import { actionSchema, requestSchema, historySchema, detailsSchema, diffSchema, fileSchema, sessionSchema } from '../protocol/validation';
import type { RepositoryManager } from '../repositories/manager';
import type { GitDocuments } from '../editor/documents';
import { confirmAction } from '../application/confirm';
import { redactSecrets } from '../application/logging';

export class Workbench implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private activeRepository?: string;
  private readonly fingerprints = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly busy = new Set<string>();
  private polling = false;
  private requestCount = 0;
  /** Diagnostic count used to verify the real Webview message bridge. */
  get receivedWebviewRequests(): number { return this.requestCount; }
  private readonly interval: ReturnType<typeof setInterval>;
  constructor(private readonly context: vscode.ExtensionContext, private readonly git: GitServiceContract, private readonly repositories: RepositoryManager, private readonly documents: GitDocuments, private readonly output: vscode.OutputChannel) {
    this.disposables.push(repositories.onDidChange(id => this.post({ type: 'changed', repoId: id })), repositories.onDidChangeRepositories(() => this.post({ type: 'repositoriesChanged' })));
    const seconds = vscode.workspace.getConfiguration('alwaygit').get<number>('refreshInterval', 15);
    this.interval = setInterval(() => void this.poll(), seconds * 1000);
  }
  async open(repoId?: string, restoredPanel?: vscode.WebviewPanel): Promise<void> {
    if (!vscode.workspace.isTrusted) { await vscode.window.showWarningMessage('Trust this workspace using VS Code Workspace Trust, then reopen AlwayGit.'); return; }
    await this.repositories.scan();
    if (repoId) this.activeRepository = repoId;
    if (this.panel) { this.panel.reveal(); this.post({ type: 'repositoriesChanged' }); if (repoId) this.post({ type: 'selectRepository', repoId }); return; }
    const options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')] };
    const panel = restoredPanel ?? vscode.window.createWebviewPanel('alwaygit.workbench', 'AlwayGit', vscode.ViewColumn.Active, options);
    panel.webview.options = options;
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'alwaygit.svg');
    panel.onDidDispose(() => { this.panel = undefined; });
    panel.webview.onDidReceiveMessage(async (raw: unknown) => {
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) return;
      this.requestCount++;
      try { const result = await this.handle(parsed.data); this.post({ type: 'response', id: parsed.data.id, result }); }
      catch (error) {
        const message = redactSecrets(error instanceof Error ? error.message : String(error));
        this.output.appendLine(`[request:${parsed.data.method}] ${message}`);
        this.post({ type: 'response', id: parsed.data.id, error: { message, code: String((error as { code?: unknown }).code ?? 'FAILED') } });
      }
    });
    panel.onDidChangeViewState(event => { if (event.webviewPanel.visible) { this.post({ type: 'repositoriesChanged' }); if (this.activeRepository) this.post({ type: 'changed', repoId: this.activeRepository }); } });
    panel.webview.html = await this.html(panel.webview);
  }
  async addRepository(): Promise<unknown> {
    const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Add Git Repository' });
    if (!selected?.[0]) return undefined;
    return this.repositories.add(selected[0].fsPath);
  }
  /** All UI requests go through the same validated, trusted application boundary. */
  async handle(request: RpcRequest): Promise<unknown> {
    if (request.method === 'showLog') { this.output.show(true); return null; }
    if (request.method === 'saveSession') { await this.context.workspaceState.update('alwaygit.session', sessionSchema.parse(request.payload)); return null; }
    if (!vscode.workspace.isTrusted) throw new Error('Git execution requires a trusted workspace.');
    if (request.method === 'repositories') { const list = this.repositories.list(); return this.activeRepository ? list.sort((a, b) => Number(b.id === this.activeRepository) - Number(a.id === this.activeRepository)) : list; }
    if (request.method === 'addRepository') return this.addRepository();
    if (request.method === 'pickWorktree') {
      const value = await vscode.window.showSaveDialog({ title: 'New Worktree Directory', saveLabel: 'Use Directory', defaultUri: vscode.Uri.file(path.join(path.dirname(this.repositories.get(request.repoId).root), 'new-worktree')) });
      return value?.fsPath;
    }
    const repo = this.repositories.get(request.repoId);
    switch (request.method) {
      case 'snapshot': {
        this.activeRepository = repo.id;
        const snapshot = await this.git.snapshot(repo); this.recordFingerprint(snapshot); return snapshot;
      }
      case 'history': return this.git.history(repo, { limit: vscode.workspace.getConfiguration('alwaygit').get<number>('historyPageSize', 300), ...historySchema.parse(request.payload ?? {}) });
      case 'details': { const data = detailsSchema.parse(request.payload); return this.git.details(repo, data.oid, data.parent); }
      case 'diff': await this.documents.diff(repo, diffSchema.parse(request.payload)); return null;
      case 'openFile': await this.documents.openFile(repo, fileSchema.parse(request.payload).path); return null;
      case 'openWorktree': {
        const data = fileSchema.parse(request.payload);
        const snapshot = await this.git.snapshot(repo);
        const worktree = snapshot.worktrees.find(w => path.resolve(w.path) === path.resolve(data.path));
        if (!worktree || worktree.bare) throw new Error('Select a registered non-bare worktree.');
        if (path.resolve(worktree.path) === path.resolve(repo.root)) { await this.open(repo.id); return null; }
        await this.repositories.add(worktree.path);
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktree.path), { forceNewWindow: true });
        return null;
      }
      case 'action': {
        const action = actionSchema.parse(request.payload);
        if (this.busy.has(repo.commonDir)) throw new Error('An operation is already running in this repository.');
        if (!await confirmAction(repo, action)) throw new Error('Operation cancelled.');
        if (this.busy.has(repo.commonDir)) throw new Error('An operation is already running in this repository.');
        this.busy.add(repo.commonDir);
        for (const r of this.repositories.list().filter(r => r.commonDir === repo.commonDir)) this.post({ type: 'activity', repoId: r.id, busy: true, label: action.type });
        try { await this.git.execute(repo, action); }
        finally {
          this.busy.delete(repo.commonDir);
          for (const r of this.repositories.list().filter(r => r.commonDir === repo.commonDir)) { this.post({ type: 'activity', repoId: r.id, busy: false, label: action.type }); this.post({ type: 'changed', repoId: r.id }); }
        }
        const snapshot = await this.git.snapshot(repo); this.recordFingerprint(snapshot); return snapshot;
      }
    }
  }
  private recordFingerprint(snapshot: Snapshot): string {
    const { version: _version, ...state } = snapshot; const key = JSON.stringify(state); this.fingerprints.set(snapshot.repository.id, key); return key;
  }
  private async poll(): Promise<void> {
    if (!this.panel?.visible || !this.activeRepository || this.polling || !vscode.workspace.isTrusted) return;
    this.polling = true;
    try {
      const repo = this.repositories.get(this.activeRepository);
      if (this.busy.has(repo.commonDir)) return;
      const previous = this.fingerprints.get(repo.id);
      const snapshot = await this.git.snapshot(repo);
      if (this.recordFingerprint(snapshot) !== previous) this.post({ type: 'changed', repoId: repo.id });
    } catch (error) { this.output.appendLine(redactSecrets(`[refresh] ${error instanceof Error ? error.message : String(error)}`)); }
    finally { this.polling = false; }
  }
  private post(message: HostMessage): void { void this.panel?.webview.postMessage(message); }
  private async html(webview: vscode.Webview): Promise<string> {
    const root = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    let html = await readFile(vscode.Uri.joinPath(root, 'index.html').fsPath, 'utf8');
    const nonce = randomBytes(20).toString('base64');
    html = html.replace(/(src|href)="\.\/([^"\s]+)"/g, (_match, attr, resource: string) => `${attr}="${webview.asWebviewUri(vscode.Uri.joinPath(root, resource))}"`);
    html = html.replace(/<script /g, `<script nonce="${nonce}" `);
    const session = JSON.stringify(this.context.workspaceState.get('alwaygit.session', {})).replace(/</g, '\\u003c');
    html = html.replace('</head>', `<script nonce="${nonce}">window.__ALWAYGIT_SESSION__=${session};</script></head>`);
    return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">`);
  }
  dispose(): void { clearInterval(this.interval); this.panel?.dispose(); for (const disposable of this.disposables) disposable.dispose(); }
}
