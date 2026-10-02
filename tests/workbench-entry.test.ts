import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { panelSession, statusBarPresentation } from '../src/extension/workbench-entry';
import { createWorkbenchActivityLauncher } from '../src/extension/workbench-launcher';
import { Workbench } from '../src/extension/workbench';

vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners = new Set<(value: T) => void>();
    event = (listener: (value: T) => void) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
    fire(value: T) { for (const listener of this.listeners) listener(value); }
    dispose() { this.listeners.clear(); }
  }
  return {
    EventEmitter, ViewColumn: { Active: -1 }, Uri: { joinPath: vi.fn(() => ({})) },
    workspace: { isTrusted: true, onDidChangeConfiguration: () => ({ dispose() {} }), getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
    window: { createTreeView: vi.fn(), createWebviewPanel: vi.fn() },
    commands: { executeCommand: vi.fn(), registerCommand: vi.fn() },
  };
});

function panelFixture() {
  const closed = new vscode.EventEmitter<void>(), stateChanged = new vscode.EventEmitter<vscode.WebviewPanelOnDidChangeViewStateEvent>();
  const panel = {
    active: true, visible: true, title: '',
    webview: { options: {}, html: '', onDidReceiveMessage: () => ({ dispose() {} }), postMessage: vi.fn(async () => true) },
    reveal: vi.fn(), dispose: () => closed.fire(), onDidDispose: closed.event, onDidChangeViewState: stateChanged.event,
  };
  return { panel, stateChanged };
}

const workbenches: Workbench[] = [];
beforeEach(() => vi.clearAllMocks());
afterEach(() => { for (const workbench of workbenches.splice(0)) workbench.dispose(); vi.useRealTimers(); });

function workbenchFixture() {
  const repositories = { scan: vi.fn(async () => {}), list: () => [], onDidChange: () => ({ dispose() {} }), onDidChangeRepositories: () => ({ dispose() {} }) };
  const workbench = new Workbench({ extensionUri: {}, workspaceState: { get: (_key: string, fallback: unknown) => fallback, update: async () => {} } } as unknown as vscode.ExtensionContext, {} as never, repositories as never, {} as never, {} as never, {} as never);
  vi.spyOn(workbench as unknown as { html(): Promise<string> }, 'html').mockResolvedValue('<html></html>');
  workbenches.push(workbench);
  return workbench;
}

describe('Workbench entry presentation', () => {
  it('opens a missing workbench and focuses an existing hidden workbench', () => {
    expect(statusBarPresentation({ open: false, active: false })).toEqual({ visible: true, tooltip: 'Open AlwayGit Workbench' });
    expect(statusBarPresentation({ open: true, active: false })).toEqual({ visible: true, tooltip: 'Show AlwayGit Workbench' });
  });

  it('keeps the launcher available while Workbench is active', () => {
    expect(statusBarPresentation({ open: true, active: true })).toEqual({ visible: true, tooltip: 'Show AlwayGit Workbench' });
  });

  it('contributes a stable Activity Bar Workbench launcher', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      activationEvents?: string[];
      contributes?: {
        viewsContainers?: { activitybar?: Array<{ id?: string }> };
        views?: Record<string, Array<{ id?: string }>>;
        viewsWelcome?: Array<{ view?: string; contents?: string }>;
      };
    };
    expect(manifest.contributes?.viewsContainers?.activitybar?.some(item => item.id === 'alwaygit')).toBe(true);
    expect(manifest.contributes?.views?.alwaygit?.some(item => item.id === 'alwaygit.workbenchLauncher')).toBe(true);
    expect(manifest.activationEvents).toContain('onView:alwaygit.workbenchLauncher');
    expect(manifest.contributes?.viewsWelcome?.filter(item => item.view === 'alwaygit.workbenchLauncher').map(item => item.contents)).toEqual([
      '[Show Git Workbench](command:alwaygit.showWorkbench)\n[Open Workbench in New Window](command:alwaygit.openWorkbenchInNewWindow)',
    ]);
  });

  it.each([false, true])('does not launch or close the sidebar when launcher visibility starts at %s', visible => {
    vi.useFakeTimers();
    const visibility = new vscode.EventEmitter<vscode.TreeViewVisibilityChangeEvent>();
    vi.mocked(vscode.window.createTreeView).mockReturnValue({ visible, onDidChangeVisibility: visibility.event, dispose() {} } as vscode.TreeView<vscode.TreeItem>);
    const launcher = createWorkbenchActivityLauncher();
    const options = vi.mocked(vscode.window.createTreeView).mock.calls[0][1];
    expect(options.treeDataProvider.getChildren()).toEqual([]);
    visibility.fire({ visible: true });
    expect(vi.getTimerCount()).toBe(0);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(vscode.commands.registerCommand).not.toHaveBeenCalled();
    launcher.dispose(); visibility.dispose();
  });

  it('creates one Workbench, reveals it on repeated Show, and recreates it after closing', async () => {
    vi.mocked(vscode.window.createWebviewPanel).mockImplementation(() => panelFixture().panel as unknown as vscode.WebviewPanel);
    const workbench = workbenchFixture();
    await workbench.open();
    const panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0].value as vscode.WebviewPanel;
    panel.webview.html = 'existing content and session';
    await workbench.open(); await workbench.open();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panel.reveal).toHaveBeenCalledTimes(2);
    expect(panel.webview.html).toBe('existing content and session');
    panel.dispose();
    await workbench.open();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
  });

  it('shows the active Workbench before the last panel and remembers activation when editors take focus', async () => {
    const first = panelFixture(), second = panelFixture();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValueOnce(first.panel as unknown as vscode.WebviewPanel).mockReturnValueOnce(second.panel as unknown as vscode.WebviewPanel);
    const workbench = workbenchFixture();
    await workbench.open(); await workbench.open(undefined, undefined, true, true);
    second.panel.active = false;
    await workbench.open();
    expect(first.panel.reveal).toHaveBeenCalledTimes(1);
    expect(second.panel.reveal).not.toHaveBeenCalled();
    first.panel.active = false; second.panel.active = true;
    second.stateChanged.fire({ webviewPanel: second.panel as unknown as vscode.WebviewPanel });
    second.panel.active = false;
    first.stateChanged.fire({ webviewPanel: first.panel as unknown as vscode.WebviewPanel });
    await workbench.open();
    expect(second.panel.reveal).toHaveBeenCalledTimes(1);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
  });

  it('creates a blank tab without copying the last repository',()=>{
    expect(panelSession({repoId:'previous',language:'zh-CN'},undefined,true)).toEqual({language:'zh-CN'});
    expect(panelSession({repoId:'previous'},'selected')).toEqual({repoId:'selected'});
  });
});
