import * as vscode from 'vscode';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { Workbench } from '../../src/extension/workbench';
import type { RepositoryManager } from '../../src/repositories/manager';
import type { ProjectWindows } from '../../src/extension/project-windows';
import type { RpcRequest } from '../../src/protocol/types';
import type { WorkbenchTransfer } from '../../src/protocol/workbench-host';

/** A test-only companion extension installed exclusively in the isolated test profile. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root || !path.basename(path.dirname(root)).startsWith('alwaygit-windows-test-')) return;
  const name = path.basename(root), mailbox = path.join(path.dirname(root), 'mailbox');
  const extension = vscode.extensions.getExtension<{ workbench: Workbench; manager: RepositoryManager; projects: ProjectWindows }>('alwaygit-dev.alwaygit');
  if (!extension) throw new Error('AlwayGit is missing from the isolated test profile');
  const api = await extension.activate();
  const sentinel = await vscode.workspace.openTextDocument({ content: 'Keep this unsaved editor\n', language: 'plaintext' });
  await vscode.window.showTextDocument(sentinel, { preview: false, viewColumn: vscode.ViewColumn.One });
  const edit = new vscode.WorkspaceEdit(); edit.insert(sentinel.uri, new vscode.Position(1, 0), 'Unsaved changes must survive\n'); await vscode.workspace.applyEdit(edit);
  if (name === 'source') { const repository = await api.manager.add(root); await api.workbench.open(repository.id); }
  const state = () => ({
    ready: true, name, focused: vscode.window.state.focused, registry: api.projects.bridge.directory,
    webviewRequests: api.workbench.receivedWebviewRequests,
    sentinel: { uri: sentinel.uri.toString(), dirty: sentinel.isDirty, text: sentinel.getText(), closed: sentinel.isClosed },
    groups: vscode.window.tabGroups.all.map(group => ({ column: group.viewColumn, tabs: group.tabs.map(tab => ({
      label: tab.label, preview: tab.isPreview, dirty: tab.isDirty,
      ...(tab.input instanceof vscode.TabInputText ? { uri: tab.input.uri.toString() } : {}),
      ...(tab.input instanceof vscode.TabInputTextDiff ? { left: tab.input.original.toString(), right: tab.input.modified.toString() } : {}),
    })) })),
    documents: vscode.workspace.textDocuments.filter(document => document.uri.scheme === 'alwaygit-content' || document.uri.scheme === 'file').map(document => ({ uri: document.uri.toString(), text: document.getText() })),
  });
  let busy = false, lastId = '';
  const poll = async () => {
    if (busy) return;
    busy = true;
    try {
      await writeFile(path.join(mailbox, name + '.state.json'), JSON.stringify(state()));
      const action = await readFile(path.join(mailbox, name + '.action.json'), 'utf8').then(value => JSON.parse(value)).catch(() => undefined);
      if (!action || action.id === lastId) return;
      lastId = action.id;
      let error: string | undefined, probe: WorkbenchTransfer | undefined;
      try {
        if (action.type === 'close') { await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor'); await vscode.commands.executeCommand('workbench.action.closeWindow'); return; }
        if (action.type === 'focus') {
          await api.projects.openProject(root);
        } else if (action.type === 'probe-workbench') {
          const repository = await api.manager.add(action.root, false);
          await api.workbench.open(repository.id);
          // Test the real Webview transport and production repositorySelected/captureWorkbench
          // handlers, rather than substituting a direct backend call for panel responsiveness.
          const diagnostic = api.workbench as unknown as {
            panels: Map<unknown, { ready: boolean; session?: { repoId?: string } }>;
            capture(panel: unknown): Promise<WorkbenchTransfer>;
          };
          const deadline = Date.now() + 15_000;
          while (Date.now() < deadline) {
            const panel = [...diagnostic.panels.values()].find(panel => panel.ready && panel.session?.repoId === repository.id);
            if (panel) {
              probe = await diagnostic.capture(panel);
              if (probe.session.repoId === repository.id && probe.session.views?.[repository.id]?.checkedRefs?.includes('refs/heads/main')) break;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          if (probe?.session.repoId !== repository.id || !probe.session.views?.[repository.id]?.checkedRefs?.includes('refs/heads/main')) throw new Error('The real panel did not acknowledge repository selection and snapshot state');
        } else {
          const repository = await api.manager.add(action.root, false);
          await api.workbench.handle({ id: action.id, method: action.method as RpcRequest['method'], repoId: repository.id, payload: action.payload });
        }
      } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
      await writeFile(path.join(mailbox, name + '.result.json'), JSON.stringify({ id: action.id, error, probe, state: state() }));
    } finally { busy = false; }
  };
  const interval = setInterval(() => { void poll().catch(() => {}); }, 100);
  context.subscriptions.push({ dispose() { clearInterval(interval); } });
  await poll();
}
