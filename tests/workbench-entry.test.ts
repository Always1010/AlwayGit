import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { panelSession, statusBarPresentation } from '../src/extension/workbench-entry';
import { createWorkbenchActivityLauncher } from '../src/extension/workbench-launcher';
import { Workbench } from '../src/extension/workbench';
import type { RepositoryChanges, Snapshot, GitServiceContract } from '../src/protocol/types';
import type { RepositoryManager } from '../src/repositories/manager';
import type { SessionState } from '../src/protocol/session';
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
    workspace: { isTrusted: true, get workspaceFolders() { return undefined; }, onDidChangeConfiguration: () => ({ dispose() {} }), getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback, inspect: () => undefined, update: async () => {} }) },
    window: { createTreeView: vi.fn(), createWebviewPanel: vi.fn() },
    commands: { executeCommand: vi.fn(), registerCommand: vi.fn() },
  };
});

function panelFixture() {
  const closed = new vscode.EventEmitter<void>(), stateChanged = new vscode.EventEmitter<vscode.WebviewPanelOnDidChangeViewStateEvent>();
  let receive!: (message: unknown) => Promise<void>;
  const panel = {
    active: true, visible: true, title: '',
    webview: { options: {}, html: '', onDidReceiveMessage: (listener: typeof receive) => { receive = listener; return { dispose() {} }; }, postMessage: vi.fn(async (_message: unknown) => true) },
    reveal: vi.fn(), dispose: () => closed.fire(), onDidDispose: closed.event, onDidChangeViewState: stateChanged.event,
  };
  return { panel, stateChanged, receive: (message: unknown) => receive(message) };
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
    expect(manifest.activationEvents).toContain('*');
    expect(manifest.activationEvents).not.toContain('onStartupFinished');
    const english = JSON.parse(readFileSync(new URL('../package.nls.json', import.meta.url), 'utf8')) as Record<string, string>;
    expect(manifest.contributes?.viewsWelcome?.filter(item => item.view === 'alwaygit.workbenchLauncher').map(item => item.contents?.replace(/^%(.*)%$/, (_, key: string) => english[key]))).toEqual([
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
