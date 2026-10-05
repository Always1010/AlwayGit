import { hostText, preferredLanguage } from '../application/language';
import { translate } from '../i18n/index';
import * as vscode from 'vscode';
import { GitService } from '../git/service';
import { RepositoryManager } from '../repositories/manager';
import { GitDocuments } from '../editor/documents';
import { Workbench } from './workbench';
import { credentialEnvironment } from '../application/credentials';
import { redactSecrets } from '../application/logging';
import { ProjectWindows } from './project-windows';
import { statusBarPresentation } from './workbench-entry';
import { createWorkbenchActivityLauncher } from './workbench-launcher';

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('AlwayGit');
  const gitPath = vscode.workspace.getConfiguration('alwaygit').get<string>('gitPath') || undefined;
  const git = new GitService({
    gitPath,
    resolveGitPath: async () => {
      if (vscode.workspace.isTrusted) {
        try {
          const builtin = vscode.extensions.getExtension<{ getAPI(version: number): { git: { path: string } } }>('vscode.git');
          if (builtin) return (await builtin.activate()).getAPI(1).git.path;
        } catch { /* PATH fallback supports disabled built-in Git. */ }
      }
      return undefined;
    },
    allowDetachedHead: () => vscode.workspace.getConfiguration('alwaygit').get<boolean>('allowDetachedHead', false) === true,
    onOutput: (repo, text) => output.append(redactSecrets(`[${repo.name}] ${text}`)),
    environment: async (_repo, args) => {
      if (!['fetch', 'pull', 'push'].includes(args[0])) return {};
      return credentialEnvironment(vscode.Uri.joinPath(context.extensionUri, 'dist', 'askpass.cjs').fsPath,
        async (message, password, signal) => {
          const cancellation = new vscode.CancellationTokenSource(), cancel = () => cancellation.cancel();
          signal.addEventListener('abort', cancel, { once: true });
          if (signal.aborted) cancel();
          try { return await vscode.window.showInputBox({ title: hostText(preferredLanguage(), "extension.alwayGitGitAuthentication"), prompt: message, password, ignoreFocusOut: true }, cancellation.token); }
          finally { signal.removeEventListener('abort', cancel); cancellation.dispose(); }
        });
    },
  });
  const manager = new RepositoryManager(git, context, output);
  const documents = new GitDocuments(git);
  let workbench: Workbench;
  const projects = new ProjectWindows(
    context, output, manager, documents,
    (repoId, blank) => workbench.open(repoId, undefined, false, blank),
    () => manager.synchronizeSharedState(),
    (commonDir, busy, label) => workbench.externalRepositoryActivity(commonDir, busy, label),
  );
  workbench = new Workbench(context, git, manager, documents, output, projects);
  const launcher = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  launcher.name = 'AlwayGit'; launcher.text = translate('en', "extension.gitMergeAlwayGit"); launcher.command = 'alwaygit.showWorkbench';
  const updateLauncher = () => { const presentation=statusBarPresentation(workbench.presence, preferredLanguage());launcher.tooltip=presentation.tooltip;launcher.accessibilityInformation={label:presentation.tooltip};if(presentation.visible)launcher.show();else launcher.hide(); };
  context.subscriptions.push(output, manager, workbench, projects,
    launcher,
    vscode.workspace.registerTextDocumentContentProvider('alwaygit-content', documents),
    workbench.onDidChangePresence(updateLauncher),
    vscode.workspace.onDidCloseTextDocument(document => { if (document.uri.scheme === 'alwaygit-content') documents.release(document.uri); }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void manager.scan()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => { void manager.scan(); if (workbench.openMode !== 'editor') void workbench.show(); }),
    vscode.commands.registerCommand('alwaygit.showWorkbench', () => workbench.show()),
    vscode.commands.registerCommand('alwaygit.openWorkbenchInEditor', () => workbench.show('editor')),
    vscode.commands.registerCommand('alwaygit.openWorkbenchInSidebar', () => workbench.show('sidebar')),
    vscode.commands.registerCommand('alwaygit.openWorkbenchInAuxiliary', () => workbench.show('auxiliary')),
    vscode.commands.registerCommand('alwaygit.openWorkbenchInPanel', () => workbench.show('panel')),
    vscode.commands.registerCommand('alwaygit.workbenchOpenModeSettings', () => workbench.showOpenModeSettings()),
    // Webview view titles do not forward a source context: bind each native gear explicitly.
    vscode.commands.registerCommand('alwaygit.sidebarLocationSettings', () => workbench.showOpenModeSettings('alwaygit.workbenchLauncher')),
    vscode.commands.registerCommand('alwaygit.auxiliaryLocationSettings', () => workbench.showOpenModeSettings('alwaygit.workbenchAuxiliary')),
    vscode.commands.registerCommand('alwaygit.panelLocationSettings', () => workbench.showOpenModeSettings('alwaygit.workbenchPanel')),
    vscode.commands.registerCommand('alwaygit.copyWorkbenchToEditor', () => workbench.copyWorkbenchToEditor()),
    vscode.commands.registerCommand('alwaygit.moveWorkbenchView', () => workbench.moveDockedView()),
    vscode.commands.registerCommand('alwaygit.newTerminal', () => workbench.requestTerminal()),
    vscode.commands.registerCommand('alwaygit.openWorkbenchInNewWindow', () => projects.openBlankWorkbenchInNewWindow()),
    vscode.commands.registerCommand('alwaygit.open', (repoId?: string) => workbench.open(typeof repoId === 'string' ? repoId : undefined)),
    vscode.commands.registerCommand('alwaygit.refresh', async () => { await manager.scan(); for (const repo of manager.list()) manager.notify(repo.id); }),
    vscode.commands.registerCommand('alwaygit.showLog', () => output.show(true)),
    createWorkbenchActivityLauncher(workbench),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('alwaygit.gitPath') || e.affectsConfiguration('alwaygit.refreshInterval')) void vscode.window.showInformationMessage(hostText(preferredLanguage(), "extension.reloadTheVSCodeWindowToApplyAlwayGitRuntime")); }),
    vscode.window.registerWebviewPanelSerializer('alwaygit.workbench', { async deserializeWebviewPanel(panel, state: { repoId?: string } | undefined) { await workbench.open(state?.repoId, panel, false, state?.repoId===undefined); } }),
  );
  await projects.start();
  // Window routing and commands are ready before Git discovery completes.
  void workbench.initializeRepositories().catch(error => output.appendLine(`[discovery] ${redactSecrets(String(error))}`));
  updateLauncher();
  output.appendLine(translate('en', "extension.alwayGitActivatedGitOperationsRunInTheWorkspaceExtension"));
  return { git, manager, documents, workbench, projects };
}
export function deactivate(): void {}
