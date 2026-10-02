import * as vscode from 'vscode';

class WorkbenchLauncherProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }

  getChildren(): vscode.TreeItem[] {
    // Empty views render the native command buttons contributed by viewsWelcome.
    return [];
  }
}

export function createWorkbenchActivityLauncher(): vscode.Disposable {
  return vscode.window.createTreeView('alwaygit.workbenchLauncher', {
    treeDataProvider: new WorkbenchLauncherProvider(),
    showCollapseAll: false,
  });
}
