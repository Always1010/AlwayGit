import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { panelSession, statusBarPresentation } from '../src/extension/workbench-entry';
import { createWorkbenchActivityLauncher, workbenchContainerIds, workbenchLauncherHtml, workbenchLocationSettingsCommands } from '../src/extension/workbench-launcher';
import { Workbench } from '../src/extension/workbench';
import type { RepositoryChanges, Snapshot, GitServiceContract } from '../src/protocol/types';
import type { RepositoryManager } from '../src/repositories/manager';
import type { SessionState } from '../src/protocol/session';
import { readWorkbenchLocations, type WorkbenchLocation } from '../src/protocol/workbench-host';
import { affectsWorkingDiff } from '../webview/refresh';

vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners = new Set<(value: T) => void>();
    event = (listener: (value: T) => void) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
    fire(value: T) { for (const listener of this.listeners) listener(value); }
    dispose() { this.listeners.clear(); }
  }
  return {
    EventEmitter, ConfigurationTarget: { Global: 1, Workspace: 2 }, ViewColumn: { Active: -1 }, Uri: { joinPath: vi.fn(() => ({})) }, env: { language: 'en' },
    workspace: { isTrusted: true, get workspaceFolders() { return undefined; }, onDidGrantWorkspaceTrust: () => ({ dispose() {} }), onDidChangeConfiguration: () => ({ dispose() {} }), getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback, inspect: () => undefined, update: async () => {} }) },
    window: { registerWebviewViewProvider: vi.fn(() => ({ dispose() {} })), showQuickPick: vi.fn(), showErrorMessage: vi.fn(), createWebviewPanel: vi.fn() },
    commands: { executeCommand: vi.fn(), registerCommand: vi.fn() },
  };
});

function panelFixture() {
  const closed = new vscode.EventEmitter<void>(), stateChanged = new vscode.EventEmitter<vscode.WebviewPanelOnDidChangeViewStateEvent>();
  let receive!: (message: unknown) => Promise<void>;
  const panel = {
    active: true, visible: true, title: '',
    webview: { options: {}, html: '', cspSource: 'vscode-webview:', asWebviewUri: () => 'vscode-webview:/launcher', onDidReceiveMessage: (listener: typeof receive) => { receive = listener; return { dispose() {} }; }, postMessage: vi.fn(async (_message: unknown) => true) },
    reveal: vi.fn(), dispose: () => closed.fire(), onDidDispose: closed.event, onDidChangeViewState: stateChanged.event,
  };
  return { panel, stateChanged, receive: (message: unknown) => receive(message) };
}

function viewFixture() {
  const panel = panelFixture(), visibility = new vscode.EventEmitter<void>();
  const { active, reveal, onDidChangeViewState, ...surface } = panel.panel;
  const view = { ...surface, viewType: 'alwaygit.workbenchLauncher', show: vi.fn(), onDidChangeVisibility: visibility.event };
  return { view, visibility, receive: panel.receive };
}

const workbenches: Workbench[] = [];
beforeEach(() => vi.clearAllMocks());
afterEach(() => { for (const workbench of workbenches.splice(0)) workbench.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });

function workbenchFixture(output = { appendLine: vi.fn() }, events?: { changes: vscode.EventEmitter<{ repoId: string; changes?: RepositoryChanges }>; catalog: vscode.EventEmitter<void> }, overrides: Partial<Pick<RepositoryManager, 'scan' | 'list' | 'collections' | 'order'>> = {}) {
  const repositories = { scan: vi.fn(async () => {}), list: () => [], onDidChange: events?.changes.event ?? (() => ({ dispose() {} })), onDidChangeRepositories: events?.catalog.event ?? (() => ({ dispose() {} })), ...overrides };
  const workbench = new Workbench({ extensionUri: {}, workspaceState: { get: (_key: string, fallback: unknown) => fallback, update: async () => {} } } as unknown as vscode.ExtensionContext, {} as never, repositories as never, {} as never, output as never, {} as never);
  vi.spyOn(workbench as unknown as { html(): Promise<string> }, 'html').mockResolvedValue('<html></html>');
  workbenches.push(workbench);
  return workbench;
}

describe('Workbench entry presentation', () => {
  function configure(enabled: WorkbenchLocation[], defaultLocation: WorkbenchLocation) {
    const values = new Map<string, unknown>([['workbenchLocations', { enabled, default: defaultLocation }]]);
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: (key: string, fallback: unknown) => values.get(key) ?? fallback, inspect: () => undefined, update: async (key: string, value: unknown) => { values.set(key, value); } } as unknown as vscode.WorkspaceConfiguration);
    return values;
  }
  it('normalizes legacy preferences and keeps the default among enabled locations', () => {
    expect(readWorkbenchLocations(undefined, 'docked')).toEqual({ enabled: ['editor', 'sidebar'], default: 'sidebar' });
    expect(readWorkbenchLocations(undefined)).toEqual({ enabled: ['editor'], default: 'editor' });
    expect(readWorkbenchLocations({ enabled: ['panel', 'panel'], default: 'editor' })).toEqual({ enabled: ['panel'], default: 'panel' });
  });
  it('keeps all four location drafts independent while routing Show only to the default', async () => {
    const values = configure(['editor', 'sidebar', 'auxiliary', 'panel'], 'panel');
    const workbench = workbenchFixture(), editor = panelFixture(), sidebar = viewFixture(), auxiliary = viewFixture(), bottom = viewFixture();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(editor.panel as unknown as vscode.WebviewPanel);
    await workbench.open('editor');
    await workbench.resolveDockedView(sidebar.view as unknown as vscode.WebviewView, { repoId: 'sidebar', drafts: { sidebar: 'side draft' } });
    await workbench.resolveDockedView(bottom.view as unknown as vscode.WebviewView, { repoId: 'panel', drafts: { panel: 'panel draft' } }, 'panel');
    await workbench.resolveDockedView(auxiliary.view as unknown as vscode.WebviewView, { repoId: 'auxiliary', drafts: { auxiliary: 'independent' } }, 'auxiliary');
    const context = (workbench as unknown as { context: vscode.ExtensionContext }).context;
    const save = vi.spyOn(context.workspaceState, 'update');
    await sidebar.receive({ id: 'side-save', method: 'saveSession', payload: { repoId: 'sidebar', drafts: { sidebar: 'updated sidebar' } } });
    await bottom.receive({ id: 'panel-save', method: 'saveSession', payload: { repoId: 'panel', drafts: { panel: 'updated panel' } } });
    await auxiliary.receive({ id: 'aux-save', method: 'saveSession', payload: { repoId: 'auxiliary', drafts: { auxiliary: 'updated auxiliary' } } });
    expect(save).toHaveBeenCalledWith('alwaygit.auxiliarySession', expect.objectContaining({ drafts: { auxiliary: 'updated auxiliary' } }));
    expect(save).toHaveBeenCalledWith('alwaygit.dockedSession', expect.objectContaining({ drafts: { sidebar: 'updated sidebar' } }));
    expect(save).toHaveBeenCalledWith('alwaygit.panelSession', expect.objectContaining({ drafts: { panel: 'updated panel' } }));
    await workbench.show(); await workbench.show();
    expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith('alwaygit.workbenchPanel.focus');
    expect(auxiliary.view.show).not.toHaveBeenCalled();
    expect(sidebar.view.show).not.toHaveBeenCalled();
    expect(editor.panel.reveal).not.toHaveBeenCalled();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
    await workbench.handle({ id: 'apply', method: 'saveWorkbenchLocations', payload: { enabled: ['editor', 'sidebar', 'panel'], default: 'editor' } });
    expect(values.get('workbenchLocations')).toEqual({ enabled: ['editor', 'sidebar', 'panel'], default: 'editor' });
    expect(bottom.view.webview.html).toBe('<html></html>');
    await workbench.show();
    expect(editor.panel.reveal).toHaveBeenCalledOnce();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
  });
  it.each(['panel', 'auxiliary'] as const)('applies from a sidebar launcher and opens the cold default %s only after the dialog closes', async destination => {
    const values = configure(['editor'], 'editor'), workbench = workbenchFixture(), sidebar = viewFixture(), bottom = viewFixture();
    await workbench.resolveDockedView(sidebar.view as unknown as vscode.WebviewView, undefined, 'sidebar');
    await sidebar.receive({ id: 'ready', method: 'workbenchLocationsReady' });
    await workbench.showOpenModeSettings('alwaygit.workbenchLauncher');
    const applied = { enabled: ['editor', 'sidebar', destination], default: destination };
    const viewId = destination === 'panel' ? 'alwaygit.workbenchPanel' : 'alwaygit.workbenchAuxiliary';
    await sidebar.receive({ id: 'apply', method: 'saveWorkbenchLocations', payload: applied });
    (workbench as unknown as { refreshLaunchers(): void }).refreshLaunchers();
    expect(sidebar.view.webview.postMessage).toHaveBeenCalledWith({ type: 'response', id: 'apply', result: applied });
    expect(sidebar.view.webview.html).toContain('locations-root');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const nativeContainerCommands = new Set(Object.values(manifest.contributes.viewsContainers).flatMap(containers =>
      (containers as Array<{ id: string }>).filter(container => /^[a-z0-9_-]+$/i.test(container.id))
        .map(container => `workbench.view.extension.${container.id}.resetViewContainerLocation`)));
    vi.mocked(vscode.commands.executeCommand).mockImplementation(async command => {
      if (command.endsWith('.resetViewContainerLocation') && !nativeContainerCommands.has(command)) throw new Error(`command '${command}' not found`);
      if (command === `${viewId}.focus`) await workbench.resolveDockedView(bottom.view as unknown as vscode.WebviewView, { drafts: { destination: 'restored' } }, destination);
    });
    await sidebar.receive({ id: 'close', method: 'workbenchLocationsClosed' });
    expect(values.get('workbenchLocations')).toEqual(applied);
    expect(bottom.view.webview.html).toBe('<html></html>');
    expect(sidebar.view.webview.html).toContain('locations-root');
    expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(`${viewId}.focus`);
    expect(sidebar.view.webview.html).toContain(`Opens in: ${destination === 'panel' ? 'Panel' : 'Secondary Sidebar'}`);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    vi.mocked(vscode.commands.executeCommand).mockClear();
    await sidebar.receive({ id: 'duplicate-close', method: 'workbenchLocationsClosed' });
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });
  it.each(['editor', 'sidebar', 'auxiliary', 'panel'] as const)('Apply in a live workbench opens %s after close and preserves the source draft', async destination => {
    configure(['editor', 'sidebar', 'auxiliary', 'panel'], 'sidebar');
    const workbench = workbenchFixture(), sidebar = viewFixture(), target = viewFixture(), editor = panelFixture();
    await workbench.resolveDockedView(sidebar.view as unknown as vscode.WebviewView, { drafts: { source: 'keep' } }, 'sidebar');
    if (destination !== 'editor' && destination !== 'sidebar') await workbench.resolveDockedView(target.view as unknown as vscode.WebviewView, undefined, destination);
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(editor.panel as unknown as vscode.WebviewPanel);
    await sidebar.receive({ id: 'apply', method: 'saveWorkbenchLocations', payload: { enabled: ['editor', 'sidebar', 'auxiliary', 'panel'], default: destination } });
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    await sidebar.receive({ id: 'closed', method: 'workbenchLocationsClosed' });
    if (destination === 'editor') expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
    else {
      const viewId = destination === 'sidebar' ? 'alwaygit.workbenchLauncher' : destination === 'auxiliary' ? 'alwaygit.workbenchAuxiliary' : 'alwaygit.workbenchPanel';
      const containerId = destination === 'sidebar' ? 'alwaygit' : 'alwaygit-' + destination;
      expect(vi.mocked(vscode.commands.executeCommand).mock.calls.map(call => call[0])).toEqual([
        `workbench.view.extension.${containerId}.resetViewContainerLocation`, `${viewId}.resetViewLocation`, `${viewId}.focus`,
      ]);
    }
    expect(sidebar.view.webview.html).toBe('<html></html>');
    await sidebar.receive({ id: 'save-draft', method: 'saveSession', payload: { drafts: { source: 'still typing' } } });
    expect(workbench.presence.open).toBe(true);
  });
  it('does not open any location on cancel or failed Apply from a live workbench', async () => {
    configure(['sidebar', 'panel'], 'sidebar');
    const workbench = workbenchFixture(), sidebar = viewFixture();
    await workbench.resolveDockedView(sidebar.view as unknown as vscode.WebviewView, undefined, 'sidebar');
    await sidebar.receive({ id: 'cancel', method: 'workbenchLocationsClosed' });
    vi.spyOn(vscode.workspace.getConfiguration('alwaygit'), 'update').mockRejectedValueOnce(new Error('write failed'));
    await sidebar.receive({ id: 'apply', method: 'saveWorkbenchLocations', payload: { enabled: ['sidebar', 'panel'], default: 'panel' } });
    await sidebar.receive({ id: 'close', method: 'workbenchLocationsClosed' });
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    expect(sidebar.view.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'apply', error: expect.objectContaining({ message: 'write failed' }) }));
  });
  it('opens a dialog in the requested native view after it is ready, with no configuration write or editor creation', async () => {
    const values = configure(['editor'], 'editor'), workbench = workbenchFixture(), sidebar = viewFixture(), bottom = viewFixture();
    const update = vi.spyOn(vscode.workspace.getConfiguration('alwaygit'), 'update');
    await workbench.resolveDockedView(sidebar.view as unknown as vscode.WebviewView, undefined, 'sidebar');
    await workbench.resolveDockedView(bottom.view as unknown as vscode.WebviewView, undefined, 'panel');
    await workbench.showOpenModeSettings('alwaygit.workbenchPanel');
    expect(bottom.view.webview.postMessage).not.toHaveBeenCalled();
    await bottom.receive({ id: 'ready', method: 'workbenchLocationsReady' });
    expect(bottom.view.webview.postMessage).toHaveBeenCalledWith({ type: 'showWorkbenchLocations', locations: values.get('workbenchLocations'), language: 'en' });
    expect(sidebar.view.webview.postMessage).not.toHaveBeenCalled();
    await bottom.receive({ id: 'cancel', method: 'workbenchLocationsClosed' });
    expect(update).not.toHaveBeenCalled();
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    await sidebar.receive({ id: 'git', method: 'snapshot', repoId: 'any' });
    expect(sidebar.view.webview.postMessage).not.toHaveBeenCalled();
  });
  it('delivers an early native dialog request only after the full workbench listener is ready', async () => {
    configure(['sidebar', 'panel'], 'sidebar');
    const workbench = workbenchFixture(), sidebar = viewFixture();
    await workbench.resolveDockedView(sidebar.view as unknown as vscode.WebviewView, undefined, 'sidebar');
    await workbench.showOpenModeSettings('alwaygit.workbenchLauncher');
    expect(sidebar.view.webview.postMessage).not.toHaveBeenCalled();
    await sidebar.receive({ id: 'ready', method: 'workbenchReady' });
    expect(sidebar.view.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'showWorkbenchLocations' }));
  });
  it('writes the entire location preference once and preserves the previous value when persistence fails', async () => {
    const values = configure(['editor'], 'editor'), workbench = workbenchFixture();
    const configuration = vscode.workspace.getConfiguration('alwaygit'), update = vi.spyOn(configuration, 'update');
    const next = { enabled: ['editor', 'sidebar', 'panel'], default: 'panel' };
    await workbench.handle({ id: 'apply', method: 'saveWorkbenchLocations', payload: next });
    expect(update).toHaveBeenCalledExactlyOnceWith('workbenchLocations', next, vscode.ConfigurationTarget.Global);
    update.mockRejectedValueOnce(new Error('write failed'));
    await expect(workbench.handle({ id: 'fail', method: 'saveWorkbenchLocations', payload: { enabled: ['editor'], default: 'editor' } })).rejects.toThrow('write failed');
    expect(values.get('workbenchLocations')).toEqual(next);
    await expect(workbench.handle({ id: 'duplicate', method: 'saveWorkbenchLocations', payload: { enabled: ['editor', 'editor'], default: 'editor' } })).rejects.toThrow();
    expect(update).toHaveBeenCalledTimes(2);
  });
  it('copies live sidebar state into a fresh editor while retaining source and existing tabs', async () => {
    configure(['editor', 'sidebar'], 'sidebar');
    const workbench = workbenchFixture(), existing = panelFixture(), fresh = panelFixture(), sidebar = viewFixture();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValueOnce(existing.panel as unknown as vscode.WebviewPanel).mockReturnValueOnce(fresh.panel as unknown as vscode.WebviewPanel);
    await workbench.open('existing'); existing.panel.webview.html = 'existing draft';
    await workbench.resolveDockedView(sidebar.view as unknown as vscode.WebviewView, { repoId: 'side' });
    await sidebar.receive({ id: 'ready', method: 'workbenchReady' });
    const transfer = { session: { repoId: 'side', drafts: { side: 'just typed' } }, workingFilters: { side: 'src/' }, activeTerminal: 'diff', selectedOids: ['selected'] };
    sidebar.view.webview.postMessage.mockImplementation(async message => {
      if ((message as { type: string }).type === 'captureWorkbench') await sidebar.receive({ id: 'capture', method: 'captureWorkbench', payload: { ...transfer, token: (message as { token: string }).token } });
      return true;
    });
    await workbench.copyWorkbenchToEditor();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(existing.panel.webview.html).toBe('existing draft');
    expect(existing.panel.reveal).not.toHaveBeenCalled();
    expect(sidebar.view.webview.html).toBe('<html></html>');
    const calls = vi.mocked((workbench as unknown as { html: (...args: unknown[]) => Promise<string> }).html).mock.calls;
    expect(calls.at(-1)?.[5]).toEqual({ session: transfer.session, workingFilters: transfer.workingFilters, selectedOids: transfer.selectedOids });
  });
  it('leaves the source intact when a live state copy times out', async () => {
    vi.useFakeTimers(); configure(['editor', 'sidebar'], 'sidebar');
    const workbench = workbenchFixture(), sidebar = viewFixture();
    await workbench.resolveDockedView(sidebar.view as unknown as vscode.WebviewView, { repoId: 'side' });
    await sidebar.receive({ id: 'ready', method: 'workbenchReady' });
    const copying = expect(workbench.copyWorkbenchToEditor()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5001); await copying;
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    expect(sidebar.view.webview.html).toBe('<html></html>');
    expect(workbench.openMode).toBe('sidebar');
  });
  it('waits for the correct view when a cold focus resolves asynchronously', async () => {
    configure(['sidebar', 'panel'], 'panel');
    const workbench = workbenchFixture(), bottom = viewFixture();
    vi.mocked(vscode.commands.executeCommand).mockImplementation(async command => {
      if (command === 'alwaygit.workbenchPanel.focus') setTimeout(() => { void workbench.resolveDockedView(bottom.view as unknown as vscode.WebviewView, { repoId: 'panel' }, 'panel'); }, 0);
    });
    await workbench.show();
    expect(workbench.presence.open).toBe(true);
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    const calls = vi.mocked((workbench as unknown as { html: (...args: unknown[]) => Promise<string> }).html).mock.calls;
    expect(calls.at(-1)?.[4]).toBe('panel');
  });
  it('returns the current-window Explorer result through the openProject RPC', async () => {
    const workbench = workbenchFixture(), repo = { id: 'repo', root: '/repo' };
    const result = { kind: 'current-window', root: repo.root, exactRoot: true };
    const openProject = vi.fn(async () => result);
    Object.assign(workbench as unknown as object, { repositories: { get: () => repo }, projects: { openProject } });
    await expect(workbench.handle({ id: 'open', method: 'openProject', repoId: repo.id })).resolves.toEqual(result);
    expect(openProject).toHaveBeenCalledWith(repo.root);
  });
  it.each([false, true])('revalidates visible Working Tree content with unchanged Git status while retaining historical and staged comparisons (untracked: %s)', async untracked => {
    const repository = { id: 'fixture', root: '/fixture', commonDir: '/fixture/.git', name: 'Fixture' };
    const snapshot: Snapshot = { repository, branch: 'main', ahead: 0, behind: 0, version: 1, refs: [], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, changes: [
      { path: 'a.txt', indexStatus: untracked ? '?' : 'M', worktreeStatus: untracked ? '?' : 'M', untracked, conflict: false },
      { path: 'staged.txt', indexStatus: 'M', worktreeStatus: ' ', untracked: false, conflict: false },
      { path: 'conflict.txt', indexStatus: 'U', worktreeStatus: 'U', untracked: false, conflict: true },
    ] };
    const workbench = workbenchFixture(undefined, undefined, { list: () => [repository] });
    const internals = workbench as unknown as { git: GitServiceContract; repositories: { get(): typeof repository }; poll(): Promise<void> };
    const read = vi.fn(async () => ({ ...snapshot, version: snapshot.version++ }));
    internals.git.snapshot = read; internals.repositories.get = () => repository;
    const working = panelFixture(), history = panelFixture(), staged = panelFixture(), hidden = panelFixture();
    for (const fixture of [working, history, staged, hidden]) {
      vi.mocked(vscode.window.createWebviewPanel).mockReturnValueOnce(fixture.panel as unknown as vscode.WebviewPanel);
      await workbench.open('fixture', undefined, true);
      const tab = fixture === history ? 'history' : 'changes', selectedFile = fixture === staged ? 'staged.txt' : 'a.txt';
      await fixture.receive({ id: selectedFile, method: 'saveSession', payload: { repoId: 'fixture', views: { fixture: { tab, search: '', selectedFile } } } });
    }
    hidden.panel.visible = false;
    await internals.poll();
    for (const fixture of [working, history, staged, hidden]) fixture.panel.webview.postMessage.mockClear();
    await internals.poll();
    expect(read).toHaveBeenCalledTimes(2);
    expect(working.panel.webview.postMessage).toHaveBeenCalledOnce();
    const event = working.panel.webview.postMessage.mock.calls[0][0] as { changes: RepositoryChanges };
    expect(event.changes).toEqual({ paths: ['a.txt'] });
    expect(history.panel.webview.postMessage).not.toHaveBeenCalled();
    expect(staged.panel.webview.postMessage).not.toHaveBeenCalled();
    expect(hidden.panel.webview.postMessage).not.toHaveBeenCalled();
    expect(affectsWorkingDiff(snapshot, snapshot, { kind: 'change', area: 'unstaged', path: 'a.txt' }, event.changes)).toBe(true);
    expect(affectsWorkingDiff(snapshot, snapshot, { kind: 'change', area: 'staged', path: 'a.txt' }, event.changes)).toBe(false);
    expect(affectsWorkingDiff(snapshot, snapshot, { kind: 'change', area: 'conflict', path: 'conflict.txt' }, { paths: ['conflict.txt'] })).toBe(true);
  });
  it.each([false, true])('uses the latest successful panel baseline when activation overlaps queued saves (failed first write: %s)', async failed => {
    const output = { appendLine: vi.fn() }, workbench = workbenchFixture(output);
    const baseline: SessionState = { repoId: 'a', drafts: { a: 'old A', b: 'old B' }, views: { a: { search: 'old', tab: 'history' } } };
    let stored = baseline, release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const writing = new Promise<void>(resolve => { started = resolve; });
    const context = (workbench as unknown as { context: vscode.ExtensionContext }).context;
    vi.spyOn(context.workspaceState, 'get').mockImplementation((_key, fallback) => stored ?? fallback);
    const write = vi.spyOn(context.workspaceState, 'update').mockImplementationOnce(async (_key, session) => {
      started(); await gate;
      if (failed) throw new Error('storage full');
      stored = session;
    }).mockImplementation(async (_key, session) => { stored = session; });
    const a = panelFixture(), b = panelFixture();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValueOnce(a.panel as unknown as vscode.WebviewPanel).mockReturnValueOnce(b.panel as unknown as vscode.WebviewPanel);
    await workbench.open('a'); await workbench.open('a', undefined, true);
    b.panel.active = false;
    const sessionA: SessionState = { ...baseline, drafts: { a: 'A draft', b: 'old B' }, views: { a: { search: 'A view', tab: 'history' } } };
    const saveA = a.receive({ id: 'a', method: 'saveSession', payload: sessionA });
    await writing;
    a.panel.active = false; b.panel.active = true;
    const sessionB: SessionState = { ...baseline, drafts: { a: 'B draft', b: 'B other draft' }, views: { a: { search: 'B view', tab: 'history' } } };
    const saveB = b.receive({ id: 'b', method: 'saveSession', payload: sessionB });
    b.panel.active = false; a.panel.active = true;
    a.stateChanged.fire({ webviewPanel: a.panel as unknown as vscode.WebviewPanel });
    // This final no-op save drains the real host writer, including the activation sync.
    const syncA = a.receive({ id: 'a-sync', method: 'saveSession', payload: sessionA });
    release(); await Promise.all([saveA, saveB, syncA]);
    expect(write).toHaveBeenCalledTimes(4);
    expect(stored).toMatchObject({ drafts: { a: failed ? 'A draft' : 'B draft', b: 'B other draft' }, views: { a: { search: failed ? 'A view' : 'B view' } } });
    expect(a.panel.webview.postMessage).toHaveBeenCalledWith(failed ? expect.objectContaining({ id: 'a', error: expect.anything() }) : { type: 'response', id: 'a', result: null });
  });
  it('writes the explicit Git settings scope while keeping workspace overrides effective', async () => {
    vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([{ name: 'project', index: 0, uri: {} as vscode.Uri }]);
    const user = new Map<string, unknown>(), workspace = new Map<string, unknown>([['allowDetachedHead', true], ['defaultResetMode', 'soft']]);
    const update = vi.fn(async (key: string, value: unknown, target: vscode.ConfigurationTarget) => { (target === vscode.ConfigurationTarget.Global ? user : workspace).set(key, value); });
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, fallback: unknown) => workspace.get(key) ?? user.get(key) ?? fallback,
      inspect: (key: string) => ({ globalValue: user.get(key), workspaceValue: workspace.get(key), defaultValue: key === 'defaultResetMode' ? 'mixed' : false }), update,
    } as unknown as vscode.WorkspaceConfiguration);
    const workbench = workbenchFixture();
    expect(await workbench.handle({ id: 'user', method: 'operationSettings', payload: { scope: 'user' } })).toMatchObject({ allowDetachedHead: false, defaultResetMode: 'mixed', overridden: true });
    const settings = { allowDetachedHead: false, pushFollowTags: true, pushTagAfterCreate: true, defaultResetMode: 'hard' };
    expect(await workbench.handle({ id: 'save-user', method: 'saveOperationSettings', payload: { ...settings, scope: 'user' } })).toMatchObject({ ...settings, scope: 'user' });
    expect(update.mock.calls.every(([, , target]) => target === vscode.ConfigurationTarget.Global)).toBe(true);
    expect(await workbench.handle({ id: 'effective', method: 'operationSettings' })).toMatchObject({ allowDetachedHead: true, defaultResetMode: 'soft' });
    update.mockClear();
    await workbench.handle({ id: 'save-workspace', method: 'saveOperationSettings', payload: { ...settings, scope: 'workspace' } });
    expect(update.mock.calls.every(([, , target]) => target === vscode.ConfigurationTarget.Workspace)).toBe(true);
    expect(await workbench.handle({ id: 'effective-2', method: 'operationSettings' })).toMatchObject(settings);
  });
  it('rejects explicit workspace settings in an empty window before writing configuration', async () => {
    const workbench = workbenchFixture();
    await expect(workbench.handle({ id: 'empty', method: 'operationSettings', payload: { scope: 'workspace' } })).rejects.toThrow();
    await expect(workbench.handle({ id: 'empty-save', method: 'saveOperationSettings', payload: { scope: 'workspace', allowDetachedHead: false, pushFollowTags: false, pushTagAfterCreate: false, defaultResetMode: 'mixed' } })).rejects.toThrow();
  });
  it('migrates legacy preferences once and broadcasts user updates without letting old session saves overwrite them', async () => {
    const values = new Map<string, unknown>();
    const update = vi.fn(async (key: string, value: unknown) => { values.set(key, value); });
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, fallback: unknown) => values.get(key) ?? fallback,
      inspect: (key: string) => ({ globalValue: values.get(key) }), update,
    } as unknown as vscode.WorkspaceConfiguration);
    const workbench = workbenchFixture(), legacy = { language: 'zh-CN', appearance: { theme: 'paper', palette: 'vivid', codeFont: 15 }, drafts: { a: 'draft' } };
    const context = (workbench as unknown as { context: vscode.ExtensionContext }).context;
    vi.spyOn(context.workspaceState, 'get').mockImplementation((_key, fallback) => legacy ?? fallback);
    const one = panelFixture(), two = panelFixture();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValueOnce(one.panel as unknown as vscode.WebviewPanel).mockReturnValueOnce(two.panel as unknown as vscode.WebviewPanel);
    await workbench.open(); await workbench.open(undefined, undefined, true, true);
    expect(await workbench.handle({ id: 'load', method: 'interfaceSettings' })).toMatchObject({ language: 'zh-CN', appearance: { theme: 'paper' } });
    expect(update).toHaveBeenCalledWith('interfaceSettings', { appearance: legacy.appearance }, vscode.ConfigurationTarget.Global);
    expect(values.get('interfaceSettings')).not.toHaveProperty('drafts');
    await workbench.handle({ id: 'apply', method: 'saveInterfaceSettings', payload: { appearance: { theme: 'forest' } } });
    for (const panel of [one, two]) expect(panel.panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'interfaceSettingsChanged', settings: expect.objectContaining({ appearance: expect.objectContaining({ theme: 'forest', codeFont: 15 }) }) }));
    const writes = update.mock.calls.length;
    await workbench.handle({ id: 'old', method: 'saveSession', payload: legacy });
    expect((await workbench.handle({ id: 'reload', method: 'interfaceSettings' })) as unknown).toMatchObject({ appearance: { theme: 'forest' } });
    expect(update).toHaveBeenCalledTimes(writes);
  });
  it('opens and reveals the panel during slow startup while catalog reads share the completed discovery', async () => {
    let finish!: () => void, ready = false;
    const gate = new Promise<void>(resolve => { finish = () => { ready = true; resolve(); }; });
    const scan = vi.fn(() => gate), repo = { id: 'fixture', name: 'Startup repository', root: '/fixture', commonDir: '/fixture/.git' };
    const collection = { id: 'collection', name: 'Saved collection' }, order = { root: ['collection:collection'], collections: { collection: ['repository:/fixture/.git'] } };
    const events = { changes: new vscode.EventEmitter<{ repoId: string; changes?: RepositoryChanges }>(), catalog: new vscode.EventEmitter<void>() };
    const workbench = workbenchFixture(undefined, events, { scan, list: () => ready ? [repo] : [], collections: () => ready ? [collection] : [], order: () => ready ? order : { root: [], collections: {} } });
    const fixture = panelFixture();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(fixture.panel as unknown as vscode.WebviewPanel);
    const startup = workbench.initializeRepositories();
    let readComplete = false;
    const reads = Promise.all(['repositories', 'repositoryCollections', 'repositoryOrder'].map(method => workbench.handle({ id: method, method: method as 'repositories' | 'repositoryCollections' | 'repositoryOrder' }))).then(result => { readComplete = true; return result; });
    try {
      await workbench.open(repo.id);
      await workbench.open();
      expect(fixture.panel.webview.html).toBe('<html></html>');
      expect(fixture.panel.reveal).toHaveBeenCalledOnce();
      expect(readComplete).toBe(false);
      expect(scan).toHaveBeenCalledOnce();
      finish(); await startup; events.catalog.fire();
      expect(await reads).toEqual([[repo], [collection], order]);
      expect(fixture.panel.title).toContain(repo.name);
      await workbench.open();
      expect(await workbench.handle({ id: 'later', method: 'repositories' })).toEqual([repo]);
      expect(scan).toHaveBeenCalledOnce();
    } finally { finish(); await startup; await reads; events.changes.dispose(); events.catalog.dispose(); }
  });

  it('keeps the panel available after failed startup discovery and retries on the next catalog request', async () => {
    const scan = vi.fn().mockRejectedValueOnce(new Error('catalog damaged')).mockResolvedValue(undefined);
    const fixture = panelFixture(), workbench = workbenchFixture(undefined, undefined, { scan });
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(fixture.panel as unknown as vscode.WebviewPanel);
    await workbench.open(undefined, undefined, false, true);
    await expect(workbench.initializeRepositories()).rejects.toThrow('catalog damaged');
    expect(workbench.presence.open).toBe(true);
    expect(await workbench.handle({ id: 'retry', method: 'repositories' })).toEqual([]);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('waits for startup before opening the add-directory picker',async()=>{
    let finish!:()=>void;
    const scan=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const workbench=workbenchFixture(undefined,undefined,{scan});
    const picker=vi.spyOn(workbench,'pickRepositoryDirectory').mockResolvedValue(undefined);
    const request=workbench.handle({id:'early-add',method:'pickRepositoryDirectory'});
    expect(picker).not.toHaveBeenCalled();
    finish();await request;
    expect(picker).toHaveBeenCalledOnce();expect(scan).toHaveBeenCalledOnce();
  });

  it('checks a revealed repository without rebuilding the catalog or reloading on focus changes', async () => {
    const fixture = panelFixture(), workbench = workbenchFixture();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(fixture.panel as unknown as vscode.WebviewPanel);
    await workbench.open('fixture');
    fixture.panel.webview.html = 'retained content';
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ retainContextWhenHidden: true }));
    fixture.panel.active = false;
    fixture.stateChanged.fire({ webviewPanel: fixture.panel as unknown as vscode.WebviewPanel });
    expect(fixture.panel.webview.postMessage).not.toHaveBeenCalled();
    fixture.panel.visible = false;
    fixture.stateChanged.fire({ webviewPanel: fixture.panel as unknown as vscode.WebviewPanel });
    fixture.panel.visible = true; fixture.panel.active = true;
    fixture.stateChanged.fire({ webviewPanel: fixture.panel as unknown as vscode.WebviewPanel });
    expect(fixture.panel.webview.postMessage.mock.calls).toEqual([[{ type: 'changed', repoId: 'fixture', changes: { paths: [] } }]]);
    fixture.stateChanged.fire({ webviewPanel: fixture.panel as unknown as vscode.WebviewPanel });
    expect(fixture.panel.webview.postMessage).toHaveBeenCalledOnce();
    expect(fixture.panel.webview.html).toBe('retained content');
  });

  it.each([false, true])('replays hidden catalog and file changes once, preserving unknown invalidation (%s)', async unknown => {
    const events = { changes: new vscode.EventEmitter<{ repoId: string; changes?: RepositoryChanges }>(), catalog: new vscode.EventEmitter<void>() };
    const hidden = panelFixture(), visible = panelFixture(), workbench = workbenchFixture(undefined, events);
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValueOnce(hidden.panel as unknown as vscode.WebviewPanel).mockReturnValueOnce(visible.panel as unknown as vscode.WebviewPanel);
    await workbench.open('fixture'); await workbench.open('fixture', undefined, true);
    hidden.panel.visible = false;
    hidden.stateChanged.fire({ webviewPanel: hidden.panel as unknown as vscode.WebviewPanel });
    events.changes.fire({ repoId: 'fixture', changes: { paths: ['a.txt'] } });
    events.changes.fire({ repoId: 'fixture', changes: unknown ? undefined : { paths: ['a.txt', 'b.txt'], index: true } });
    events.changes.fire({ repoId: 'other', changes: { paths: ['other.txt'] } });
    events.catalog.fire(); events.catalog.fire();
    expect(hidden.panel.webview.postMessage).not.toHaveBeenCalled();
    expect(visible.panel.webview.postMessage).toHaveBeenCalledTimes(5);
    hidden.panel.visible = true;
    hidden.stateChanged.fire({ webviewPanel: hidden.panel as unknown as vscode.WebviewPanel });
    expect(hidden.panel.webview.postMessage.mock.calls).toEqual([
      [{ type: 'repositoriesChanged' }],
      [{ type: 'changed', repoId: 'fixture', changes: unknown ? undefined : { paths: ['a.txt', 'b.txt'], index: true } }],
    ]);
    hidden.panel.webview.postMessage.mockClear();
    hidden.panel.visible = false; hidden.stateChanged.fire({ webviewPanel: hidden.panel as unknown as vscode.WebviewPanel });
    hidden.panel.visible = true; hidden.stateChanged.fire({ webviewPanel: hidden.panel as unknown as vscode.WebviewPanel });
    expect(hidden.panel.webview.postMessage.mock.calls).toEqual([[{ type: 'changed', repoId: 'fixture', changes: { paths: [] } }]]);
    events.changes.dispose(); events.catalog.dispose();
  });

  it('shares the script nonce with deferred Webview resource preloads without widening the CSP', async () => {
    const { mkdtemp, writeFile, unlink, rmdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const directory = await mkdtemp(join(tmpdir(), 'alwaygit-help-csp-'));
    const filename = join(directory, 'index.html');
    try {
      await writeFile(filename, '<html><head><script type="module" src="./assets/app.js"></script></head><body></body></html>');
      vi.mocked(vscode.Uri.joinPath).mockReturnValue({ fsPath: filename } as vscode.Uri);
      const workbench = workbenchFixture() as unknown as { html(webview: vscode.Webview): Promise<string> };
      vi.mocked(workbench.html).mockRestore();
      const markup = await workbench.html({ cspSource: 'vscode-webview://fixture', asWebviewUri: () => 'vscode-webview://fixture/assets/app.js' } as unknown as vscode.Webview);
      const nonce = markup.match(/<meta property="csp-nonce" nonce="([^"]+)"/)?.[1];
      expect(nonce).toBeTruthy();
      expect(markup).toContain(`script-src 'nonce-${nonce}'`);
      expect(markup).toContain(`<script nonce="${nonce}" type="module"`);
      expect(markup).not.toMatch(/script-src[^;"<>]*'unsafe-(?:inline|eval)'/);
    } finally {
      await unlink(filename);
      await rmdir(directory);
      vi.mocked(vscode.Uri.joinPath).mockReturnValue({} as vscode.Uri);
    }
  });
  it('sends and logs the same sanitized underlying Stash failure through the actual message bridge', async () => {
    const fixture = panelFixture(), output = { appendLine: vi.fn() }, workbench = workbenchFixture(output);
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(fixture.panel as unknown as vscode.WebviewPanel);
    const details = { kind: 'stash-apply', reason: 'restore-blocked', paths: ['notes.txt'], conflictPaths: [], selector: 'stash@{0}', stashOid: 'saved', stashRetained: true, workingTreeUnchanged: true, output: 'staged-only.txt: Index was not unstashed. https://user:secret@example.test/repo' };
    vi.spyOn(workbench as unknown as { handleRequest(): Promise<unknown> }, 'handleRequest').mockRejectedValue(Object.assign(new Error('Restore blocked; Stash retained.'), { code: 'STASH_RESTORE_BLOCKED', details }));
    await workbench.open();
    await fixture.receive({ id: 'blocked', method: 'action', repoId: 'fixture', payload: { type: 'stash.apply', selector: 'stash@{0}' } });
    const response = fixture.panel.webview.postMessage.mock.calls.at(-1)?.[0] as { error: { details: { output: string } } };
    expect(response).toMatchObject({ type: 'response', id: 'blocked', error: { code: 'STASH_RESTORE_BLOCKED', details: { output: 'staged-only.txt: Index was not unstashed. https://***@example.test/repo' } } });
    expect(output.appendLine).toHaveBeenCalledWith(`[request:action] Restore blocked; Stash retained.\n${response.error.details.output}`);
  });
  it.each(['undelivered', 'rejected'] as const)('logs a %s reply without exposing the saved draft', async failure => {
    const fixture = panelFixture(), output = { appendLine: vi.fn() }, workbench = workbenchFixture(output);
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(fixture.panel as unknown as vscode.WebviewPanel);
    await workbench.open();
    if (failure === 'undelivered') fixture.panel.webview.postMessage.mockResolvedValue(false);
    else fixture.panel.webview.postMessage.mockRejectedValue(new Error('transport unavailable'));
    await fixture.receive({ id: 'save', method: 'saveSession', payload: { drafts: { a: 'private draft' } } });
    expect(output.appendLine).toHaveBeenCalledWith(expect.stringContaining('[webview:response]'));
    expect(JSON.stringify(output.appendLine.mock.calls)).not.toContain('private draft');
  });
  it('distinguishes a stalled VS Code state write from a message delivery failure', async () => {
    vi.useFakeTimers();
    const fixture = panelFixture(), output = { appendLine: vi.fn() }, workbench = workbenchFixture(output);
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(fixture.panel as unknown as vscode.WebviewPanel);
    await workbench.open();
    let finish!: () => void;
    const context = (workbench as unknown as { context: vscode.ExtensionContext }).context;
    vi.spyOn(context.workspaceState, 'update').mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const save = fixture.receive({ id: 'save', method: 'saveSession', payload: { drafts: { a: 'keep' } } });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(output.appendLine).toHaveBeenCalledWith(expect.stringContaining('[request:saveSession]'));
    expect(fixture.panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'save' }));
    finish(); await save;
    expect(fixture.panel.webview.postMessage).toHaveBeenCalledWith({ type: 'response', id: 'save', result: null });
  });
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
        viewsContainers?: { activitybar?: Array<{ id?: string }>; secondarySidebar?: Array<{ id?: string }>; panel?: Array<{ id?: string }> };
        views?: Record<string, Array<{ id?: string }>>;
        viewsWelcome?: Array<{ view?: string; contents?: string }>;
        menus?: Record<string, Array<{ command: string; when?: string; group?: string }>>;
      };
    };
    // VS Code rejects dotted container IDs and falls their views back to Explorer.
    const containers = manifest.contributes!.viewsContainers!;
    const viewContributions = manifest.contributes!.views!;
    for (const [region, location, viewId] of [
      ['activitybar', 'sidebar', 'alwaygit.workbenchLauncher'],
      ['secondarySidebar', 'auxiliary', 'alwaygit.workbenchAuxiliary'],
      ['panel', 'panel', 'alwaygit.workbenchPanel'],
    ] as const) {
      const containerId = containers[region]![0].id!;
      expect(containerId).toMatch(/^[a-z0-9_-]+$/i);
      expect(viewContributions[containerId]).toEqual([expect.objectContaining({ id: viewId, type: 'webview' })]);
      expect(workbenchContainerIds[location]).toBe(`workbench.view.extension.${containerId}`);
    }
    expect(manifest.contributes?.viewsContainers?.activitybar?.some(item => item.id === 'alwaygit')).toBe(true);
    expect(manifest.contributes?.views?.alwaygit?.some(item => item.id === 'alwaygit.workbenchLauncher')).toBe(true);
    expect(manifest.contributes?.viewsContainers?.secondarySidebar).toEqual([expect.objectContaining({ id: 'alwaygit-auxiliary' })]);
    expect(manifest.contributes?.views?.['alwaygit-auxiliary']).toEqual([expect.objectContaining({ id: 'alwaygit.workbenchAuxiliary', type: 'webview' })]);
    // VS Code generates onView activation from contributed views since 1.74.
    expect(manifest.activationEvents?.filter(event => event.startsWith('onView:'))).toEqual([]);
    expect(manifest.activationEvents).toContain('onWebviewPanel:alwaygit.workbench');
    // Early window routing prevents new workbench windows waiting for startup to finish.
    expect(manifest.activationEvents).toContain('*');
    expect(manifest.activationEvents).not.toContain('onStartupFinished');
    expect(manifest.contributes?.views?.alwaygit?.[0]).toMatchObject({ type: 'webview' });
    expect(manifest.contributes?.menus?.['view/title']?.filter(item => item.group === 'navigation@1')).toEqual([
      { command: 'alwaygit.sidebarLocationSettings', when: 'view == alwaygit.workbenchLauncher', group: 'navigation@1' },
      { command: 'alwaygit.panelLocationSettings', when: 'view == alwaygit.workbenchPanel', group: 'navigation@1' },
      { command: 'alwaygit.auxiliaryLocationSettings', when: 'view == alwaygit.workbenchAuxiliary', group: 'navigation@1' },
    ]);
    const launcher = workbenchLauncherHtml();
    expect(launcher).toContain('command:alwaygit.showWorkbench');
    expect(launcher).toContain('command:alwaygit.openWorkbenchInNewWindow');
    expect(launcher).toContain("default-src 'none'");
    const interactive = workbenchLauncherHtml({ script: 'vscode-webview:/launcher.js', stylesheet: 'vscode-webview:/launcher.css', cspSource: 'vscode-webview:', nonce: 'test-nonce' });
    expect(interactive).toContain('id="locations-root"');
    expect(interactive).toContain('nonce="test-nonce"');
    expect(interactive).toContain('src="vscode-webview:/launcher.js"');
    expect(interactive).toContain('href="vscode-webview:/launcher.css"');
    expect(interactive).toContain('script-src &#39;nonce-test-nonce&#39;');
  });

  it.each(['sidebar', 'auxiliary', 'panel'] as const)('registers the retained %s launcher with its own settings entry without opening an editor', async location => {
    const workbench = workbenchFixture();
    const registration = createWorkbenchActivityLauncher(workbench);
    const provider = vi.mocked(vscode.window.registerWebviewViewProvider).mock.calls[['sidebar', 'auxiliary', 'panel'].indexOf(location)][1];
    const view = viewFixture();
    await provider.resolveWebviewView(view.view as unknown as vscode.WebviewView, { state: undefined }, {} as vscode.CancellationToken);
    expect(view.view.webview.html).toContain('command:alwaygit.showWorkbench');
    expect(view.view.webview.html).toContain(`command:${workbenchLocationSettingsCommands[location]}`);
    expect(view.view.webview.html).toContain('Opens in: Editor Tab');
    expect(view.view.webview.options).toMatchObject({ enableCommandUris: ['alwaygit.showWorkbench', 'alwaygit.openWorkbenchInNewWindow', workbenchLocationSettingsCommands[location]] });
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledTimes(3);
    expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledWith('alwaygit.workbenchAuxiliary', expect.anything(), { webviewOptions: { retainContextWhenHidden: true } });
    expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledWith('alwaygit.workbenchPanel', expect.anything(), { webviewOptions: { retainContextWhenHidden: true } });
    expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledWith('alwaygit.workbenchLauncher', expect.anything(), { webviewOptions: { retainContextWhenHidden: true } });
    registration.dispose();
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
