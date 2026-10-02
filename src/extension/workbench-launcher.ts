import * as vscode from 'vscode';

const launcherCommand = 'alwaygit.openWorkbenchFromActivityBar';

class WorkbenchLauncherProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }

  getChildren(): vscode.TreeItem[] {
    const item = new vscode.TreeItem('Show Git Workbench', vscode.TreeItemCollapsibleState.None);
    item.command = { command: launcherCommand, title: 'Show Git Workbench' };
    item.iconPath = new vscode.ThemeIcon('git-merge');
    item.tooltip = 'Show the AlwayGit Workbench';
    return [item];
  }
}

export function createWorkbenchActivityLauncher(
  showWorkbench: () => Promise<void>,
  log: (message: string) => void,
): vscode.Disposable {
  const view = vscode.window.createTreeView('alwaygit.workbenchLauncher', {
    treeDataProvider: new WorkbenchLauncherProvider(),
    showCollapseAll: false,
  });
  let ready = false;
  let launching = false;
  let disposed = false;
  const initiallyVisible = view.visible;

  const launch = async (): Promise<void> => {
    if (launching || disposed) return;
    launching = true;
    try {
      await showWorkbench();
      await vscode.commands.executeCommand('workbench.action.closeSidebar');
    } catch (error) {
      log(`Failed to open Workbench from the Activity Bar: ${String(error)}`);
    } finally {
      launching = false;
    }
  };

  const command = vscode.commands.registerCommand(launcherCommand, launch);
  const visibility = view.onDidChangeVisibility((event) => {
    if (ready && event.visible) void launch();
  });
  const initialization = setTimeout(() => {
    ready = true;
    if (!view.visible) return;
    if (initiallyVisible) {
      void vscode.commands.executeCommand('workbench.action.closeSidebar');
    } else {
      void launch();
    }
  }, 0);

  return vscode.Disposable.from(
    command,
    visibility,
    view,
    new vscode.Disposable(() => {
      disposed = true;
      clearTimeout(initialization);
    }),
  );
}
