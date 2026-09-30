import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CheckoutBlocker, GitServiceContract, HostMessage, RpcRequest, Snapshot } from '../protocol/types';
import { actionSchema, requestSchema, historySchema, detailsSchema, diffSchema, fileSchema, sessionSchema, copySchema, openRepositorySchema, openWorktreeSchema } from '../protocol/validation';
import type { RepositoryManager } from '../repositories/manager';
import type { GitDocuments } from '../editor/documents';
import { confirmAction } from '../application/confirm';
import { redactSecrets } from '../application/logging';
import { hostText, preferredLanguage, type Language } from '../application/language';
import type { ProjectWindows } from './project-windows';

export class Workbench implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private activeRepository?: string;
  private readonly fingerprints = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly busy = new Set<string>();
  private polling = false;
  private requestCount = 0;
  private addingRepositories = false;
  /** Diagnostic count used to verify the real Webview message bridge. */
  get receivedWebviewRequests(): number { return this.requestCount; }
  private readonly interval: ReturnType<typeof setInterval>;
  private language(): Language { return this.context.workspaceState.get<{ language?: Language }>('alwaygit.session', {}).language ?? preferredLanguage(); }
  private text(english: string, chinese: string): string { return hostText(english, chinese, this.language()); }
  constructor(private readonly context: vscode.ExtensionContext, private readonly git: GitServiceContract, private readonly repositories: RepositoryManager, private readonly documents: GitDocuments, private readonly output: vscode.OutputChannel, private readonly projects: ProjectWindows) {
    this.disposables.push(repositories.onDidChange(id => this.post({ type: 'changed', repoId: id })), repositories.onDidChangeRepositories(() => this.post({ type: 'repositoriesChanged' })));
    const seconds = vscode.workspace.getConfiguration('alwaygit').get<number>('refreshInterval', 15);
    this.interval = setInterval(() => void this.poll(), seconds * 1000);
  }
  async open(repoId?: string, restoredPanel?: vscode.WebviewPanel): Promise<void> {
    if (!vscode.workspace.isTrusted) { await vscode.window.showWarningMessage(this.text('Trust this workspace using VS Code Workspace Trust, then reopen AlwayGit.', '请在 VS Code 中信任此工作区，然后重新打开 AlwayGit。')); return; }
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
        const details = (error as { details?: CheckoutBlocker }).details;
        this.post({ type: 'response', id: parsed.data.id, error: { message, code: String((error as { code?: unknown }).code ?? 'FAILED'), ...(details ? { details } : {}) } });
      }
    });
    panel.onDidChangeViewState(event => { if (event.webviewPanel.visible) { this.post({ type: 'repositoriesChanged' }); if (this.activeRepository) this.post({ type: 'changed', repoId: this.activeRepository }); } });
    panel.webview.html = await this.html(panel.webview);
  }
  async addRepository(): Promise<unknown> {
    if (!vscode.workspace.isTrusted) throw new Error(this.text('Git execution requires a trusted workspace.', '请先信任工作区，再执行 Git 操作。'));
    if (this.addingRepositories) return undefined;
    this.addingRepositories = true;
    try {
      const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, title: this.text('Select a repository or a folder containing repositories', '选择仓库或存放多个仓库的目录'), openLabel: this.text('Add Repositories', '添加仓库') });
      if (!selected?.[0]) return undefined;
      const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: this.text('Discovering Git repositories', '正在查找 Git 仓库'), cancellable: true }, (progress, token) => {
        let lastReport = 0;
        return this.repositories.addDirectory(selected[0].fsPath, {
          isCancelled: () => token.isCancellationRequested,
          onProgress: ({ scanned, found }) => {
            if (Date.now() - lastReport < 100) return;
            lastReport = Date.now();
            progress.report({ message: this.text(`Scanned ${scanned} folders, found ${found} repositories`, `已扫描 ${scanned} 个目录，发现 ${found} 个仓库`) });
          },
        });
      });
      for (const issue of result.issues) this.output.appendLine(redactSecrets(`[discovery] ${issue.path}: ${issue.message}`));
      if (result.cancelled) {
        void vscode.window.showInformationMessage(this.text('Repository discovery cancelled. No repositories were added.', '已取消仓库扫描，未添加任何仓库。'));
      } else {
        const summary = result.found ? this.text(`Added ${result.added} repositories; ${result.existing} already registered.`, `新增 ${result.added} 个仓库，${result.existing} 个已存在。`) : this.text('No Git repositories found in the selected folder.', '所选目录中没有找到 Git 仓库。');
        if (result.issues.length) void vscode.window.showWarningMessage(summary + this.text(` Skipped ${result.issues.length} folders or repositories. See AlwayGit output for details.`, ` 跳过 ${result.issues.length} 个异常目录或仓库，详情请查看 AlwayGit 输出。`));
        else void vscode.window.showInformationMessage(summary);
      }
      return { added: result.added, existing: result.existing, skipped: result.issues.length, cancelled: result.cancelled };
    } finally { this.addingRepositories = false; }
  }
  /** All UI requests go through the same validated, trusted application boundary. */
  async handle(request: RpcRequest): Promise<unknown> {
    if (request.method === 'showLog') { this.output.show(true); return null; }
    if (request.method === 'saveSession') { await this.context.workspaceState.update('alwaygit.session', sessionSchema.parse(request.payload)); return null; }
    if (request.method === 'copyText') { await vscode.env.clipboard.writeText(copySchema.parse(request.payload).text); return null; }
    if (!vscode.workspace.isTrusted) throw new Error(this.text('Git execution requires a trusted workspace.', '请先信任工作区，再执行 Git 操作。'));
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
      case 'diff': await this.projects.openDiff(repo.root, diffSchema.parse(request.payload)); return null;
      case 'diffPreview': return this.documents.preview(repo, diffSchema.parse(request.payload));
      case 'openRepository': {
        const data = openRepositorySchema.parse(request.payload ?? {});
        if (data.newWindow) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(repo.root), { forceNewWindow: true });
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
        if (normalized(worktree.path) === normalized(repo.root) && !data.newWindow) { await this.open(repo.id); return null; }
        const registered = await this.repositories.add(worktree.path);
        if (data.newWindow !== false) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktree.path), { forceNewWindow: true });
        else await this.open(registered.id);
        return null;
      }
      case 'action': {
        const action = actionSchema.parse(request.payload);
        if (this.busy.has(repo.commonDir)) throw new Error(this.text('An operation is already running in this repository.', '此仓库已有正在执行的操作。'));
        if (!await confirmAction(repo, action, this.language())) throw new Error(this.text('Operation cancelled.', '操作已取消。'));
        if (this.busy.has(repo.commonDir)) throw new Error(this.text('An operation is already running in this repository.', '此仓库已有正在执行的操作。'));
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
    const saved = this.context.workspaceState.get<Record<string, unknown>>('alwaygit.session', {});
    const session = JSON.stringify({ ...saved, language: saved.language ?? preferredLanguage() }).replace(/</g, '\\u003c');
    html = html.replace('</head>', `<script nonce="${nonce}">window.__ALWAYGIT_SESSION__=${session};</script></head>`);
    return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">`);
  }
  dispose(): void { clearInterval(this.interval); this.panel?.dispose(); for (const disposable of this.disposables) disposable.dispose(); }
}
