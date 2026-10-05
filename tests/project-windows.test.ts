import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectWindows } from '../src/extension/project-windows';
import { WindowBridge, canonicalPath } from '../src/application/window-bridge';

vi.mock('vscode', () => ({
  workspace: { isTrusted: true, workspaceFolders: [], onDidChangeWorkspaceFolders: () => ({ dispose() {} }) },
  window: { state: { focused: true }, onDidChangeWindowState: () => ({ dispose() {} }) },
  commands: { getCommands: async () => ['workbench.action.focusWindow'], executeCommand: vi.fn(async () => {}) },
  Uri: { file: (root: string) => ({ scheme: 'file', fsPath: root }) },
  env: { appRoot: 'project-window-test' },
}));

const directories: string[] = [], projects: ProjectWindows[] = [], targets: WindowBridge[] = [];
beforeEach(() => {
  vi.mocked(vscode.commands.executeCommand).mockReset().mockResolvedValue(undefined);
  Object.assign(vscode.workspace, { isTrusted: true });
});
afterEach(async () => {
  await Promise.all(targets.splice(0).map(bridge => bridge.close()));
  for (const project of projects.splice(0)) { await project.bridge.close(); project.dispose(); }
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('alwaygit-project-test-')) throw new Error('Unsafe test cleanup target');
    await rm(directory, { recursive: true, force: true });
  }
});

async function setup(mode: 'exact' | 'parent' | 'multi' | 'other' = 'exact') {
  const directory = await mkdtemp(path.join(tmpdir(), 'alwaygit-project-test-')); directories.push(directory);
  const root = path.join(directory, 'project'), other = path.join(directory, 'other');
  await Promise.all([mkdir(root), mkdir(other)]);
  const folders = mode === 'parent' ? [directory] : mode === 'multi' ? [other, root] : mode === 'other' ? [other] : [root];
  Object.assign(vscode.workspace, { workspaceFolders: folders.map(fsPath => ({ uri: vscode.Uri.file(fsPath) })) });
  const log = { appendLine: vi.fn() }, repositories = { add: vi.fn() }, showWorkbench = vi.fn();
  const project = new ProjectWindows({ globalStorageUri: { toString: () => directory } } as unknown as vscode.ExtensionContext,
    log as never, repositories as never, {} as never, showWorkbench);
  // Isolate the real IPC registry and all cleanup under this test's temporary directory.
  Object.assign(project.bridge, { directory: path.join(directory, 'registry') });
  projects.push(project); await project.start();
  return { project, root, log, repositories, showWorkbench };
}

describe('Open Repository Folder', () => {
  it.each(['exact', 'parent', 'multi'] as const)('shows Explorer for the current %s workspace without reopening editors or the project', async mode => {
    const { project, root, repositories, showWorkbench } = await setup(mode);
    for (let click = 0; click < 2; click++) {
      await expect(project.openProject(root)).resolves.toEqual({ kind: 'current-window', root, exactRoot: mode === 'exact' });
    }
    expect(vi.mocked(vscode.commands.executeCommand).mock.calls).toEqual([
      ['workbench.files.action.focusFilesExplorer'], ['revealInExplorer', vscode.Uri.file(root)],
      ['workbench.files.action.focusFilesExplorer'], ['revealInExplorer', vscode.Uri.file(root)],
    ]);
    expect(repositories.add).not.toHaveBeenCalled(); expect(showWorkbench).not.toHaveBeenCalled();
  });
  it('still shows Explorer when directory reveal is unavailable', async () => {
    const { project, root, log } = await setup();
    vi.mocked(vscode.commands.executeCommand).mockImplementation(async command => {
      if (command === 'revealInExplorer') throw new Error('reveal unavailable');
    });
    await expect(project.openProject(root)).resolves.toMatchObject({ kind: 'current-window' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.files.action.focusFilesExplorer');
    expect(log.appendLine).toHaveBeenCalledWith(expect.stringContaining('reveal unavailable'));
  });
  it('reports Explorer activation failures instead of returning success', async () => {
    const { project, root } = await setup();
    vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('Explorer unavailable'));
    await expect(project.openProject(root)).rejects.toThrow('Explorer unavailable');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('revealInExplorer', expect.anything());
  });
  it('keeps the trust check before displaying Explorer', async () => {
    const { project, root } = await setup(); Object.assign(vscode.workspace, { isTrusted: false });
    await expect(project.openProject(root)).rejects.toThrow(/trust/i);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });
  it.each([false, true])('routes to another window without displaying Explorer in the source (new window: %s)', async newWindow => {
    const { project, root } = await setup('other'), received: unknown[] = [];
    const register = async () => {
      const target = new WindowBridge(project.bridge.directory, async request => { received.push(request); });
      targets.push(target); await target.start([root]);
    };
    if (newWindow) vi.mocked(vscode.commands.executeCommand).mockImplementation(async command => {
      if (command === 'vscode.openFolder') await register();
    });
    else await register();
    await expect(project.openProject(root)).resolves.toEqual({ kind: 'other-window' });
    expect(received).toEqual([{ root: await canonicalPath(root), action: 'project' }]);
    expect(vi.mocked(vscode.commands.executeCommand).mock.calls).toEqual(newWindow
      ? [['vscode.openFolder', vscode.Uri.file(await canonicalPath(root)), { forceNewWindow: true }]] : []);
  });
});
