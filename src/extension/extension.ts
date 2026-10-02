import * as vscode from 'vscode';
import { GitService } from '../git/service';
import { RepositoryManager } from '../repositories/manager';
import { GitDocuments } from '../editor/documents';
import { Workbench } from './workbench';
import { credentialEnvironment } from '../application/credentials';
import { redactSecrets } from '../application/logging';
import { ProjectWindows } from './project-windows';
import { statusBarPresentation } from './workbench-entry';

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('AlwayGit');
  let gitPath = vscode.workspace.getConfiguration('alwaygit').get<string>('gitPath') || undefined;
  if (!gitPath && vscode.workspace.isTrusted) {
    try {
      const builtin = vscode.extensions.getExtension<{ getAPI(version: number): { git: { path: string } } }>('vscode.git');
      if (builtin) gitPath = (await builtin.activate()).getAPI(1).git.path;
    } catch { /* PATH fallback supports disabled built-in Git. */ }
  }
  const git = new GitService({
    gitPath,
    onOutput: (repo, text) => output.append(redactSecrets(`[${repo.name}] ${text}`)),
    environment: async (_repo, args) => {
      if (!['fetch', 'pull', 'push'].includes(args[0])) return {};
      return credentialEnvironment(vscode.Uri.joinPath(context.extensionUri, 'dist', 'askpass.cjs').fsPath,
        async (message, password) => vscode.window.showInputBox({ title: 'AlwayGit · Git Authentication', prompt: message, password, ignoreFocusOut: true }));
    },
  });
  const manager = new RepositoryManager(git, context, output);
  const documents = new GitDocuments(git);
  let workbench: Workbench;
  const projects = new ProjectWindows(context, output, manager, documents, (repoId, blank) => workbench.open(repoId, undefined, false, blank));
  workbench = new Workbench(context, git, manager, documents, output, projects);
  const launcher = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  launcher.name = 'AlwayGit'; launcher.text = '$(git-merge) AlwayGit'; launcher.command = 'alwaygit.showWorkbench';
  const updateLauncher = () => { const presentation=statusBarPresentation(workbench.presence);launcher.tooltip=presentation.tooltip;launcher.accessibilityInformation={label:presentation.tooltip};if(presentation.visible)launcher.show();else launcher.hide(); };
  context.subscriptions.push(output, manager, workbench, projects,
    launcher,
    vscode.workspace.registerTextDocumentContentProvider('alwaygit-content', documents),
    workbench.onDidChangePresence(updateLauncher),
    vscode.workspace.onDidCloseTextDocument(document => { if (document.uri.scheme === 'alwaygit-content') documents.release(document.uri); }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void manager.scan()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => void manager.scan()),
    vscode.commands.registerCommand('alwaygit.showWorkbench', () => workbench.open()),
    vscode.commands.registerCommand('alwaygit.openWorkbenchInNewWindow', () => projects.openBlankWorkbenchInNewWindow()),
    vscode.commands.registerCommand('alwaygit.open', (repoId?: string) => workbench.open(typeof repoId === 'string' ? repoId : undefined)),
    vscode.commands.registerCommand('alwaygit.refresh', async () => { await manager.scan(); for (const repo of manager.list()) manager.notify(repo.id); }),
    vscode.commands.registerCommand('alwaygit.showLog', () => output.show(true)),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('alwaygit.gitPath') || e.affectsConfiguration('alwaygit.refreshInterval')) void vscode.window.showInformationMessage('Reload the VS Code window to apply AlwayGit runtime configuration changes.'); }),
    vscode.window.registerWebviewPanelSerializer('alwaygit.workbench', { async deserializeWebviewPanel(panel, state: { repoId?: string } | undefined) { await workbench.open(state?.repoId, panel, false, state?.repoId===undefined); } }),
  );
  await projects.start();
  await manager.scan();
  updateLauncher();
  output.appendLine('AlwayGit activated. Git operations run in the workspace extension host.');
  return { git, manager, documents, workbench, projects };
}
export function deactivate(): void {}
