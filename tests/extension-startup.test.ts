import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate } from '../src/extension/extension';
import type { GitServiceOptions } from '../src/git/service';

const startup = vi.hoisted(() => ({ scan: vi.fn(), builtin: vi.fn(), bridge: vi.fn(), options: undefined as GitServiceOptions | undefined }));
vi.mock('../src/git/service', () => ({ GitService: class { constructor(options: GitServiceOptions) { startup.options = options; } } }));
vi.mock('../src/repositories/manager', () => ({ RepositoryManager: class {
  scan = startup.scan;
  onDidChange = () => ({ dispose() {} });
  onDidChangeRepositories = () => ({ dispose() {} });
  list = () => [];
  dispose() {}
} }));
vi.mock('../src/editor/documents', () => ({ GitDocuments: class {} }));
vi.mock('../src/extension/project-windows', () => ({ ProjectWindows: class { start = startup.bridge; dispose() {} } }));
vi.mock('vscode', () => ({
  EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
  StatusBarAlignment: { Left: 1 }, env: { language: 'en' },
  workspace: {
    isTrusted: true, getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }), onDidGrantWorkspaceTrust: () => ({ dispose() {} }), onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  window: {
    createOutputChannel: () => ({ appendLine: vi.fn(), dispose() {} }),
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
    registerWebviewViewProvider: () => ({ dispose() {} }), registerWebviewPanelSerializer: () => ({ dispose() {} }),
  },
  commands: { registerCommand: vi.fn(() => ({ dispose() {} })) },
  extensions: { getExtension: () => ({ activate: startup.builtin }) },
}));

beforeEach(() => { vi.clearAllMocks(); startup.bridge.mockResolvedValue(undefined); });
afterEach(() => { vi.restoreAllMocks(); });

it('registers commands and window routing without awaiting slow Git activation or repository restoration', async () => {
  let finishScan!: () => void, finishGit!: (value: unknown) => void;
  const scan = new Promise<void>(resolve => { finishScan = resolve; });
  startup.scan.mockReturnValue(scan);
  startup.builtin.mockReturnValue(new Promise(resolve => { finishGit = resolve; }));
  const context = { subscriptions: [], extensionUri: {}, workspaceState: { get: (_key: string, fallback: unknown) => fallback, update: async () => {} } } as unknown as vscode.ExtensionContext;
  let activated = false;
  const activating = activate(context).then(api => { activated = true; return api; });
  try {
    await vi.waitFor(() => expect(activated).toBe(true));
    expect(startup.bridge).toHaveBeenCalledOnce();
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith('alwaygit.showWorkbench', expect.any(Function));
    expect(startup.scan).toHaveBeenCalledOnce();
    expect(startup.builtin).not.toHaveBeenCalled();
    const api = await activating;
    const locations = vi.spyOn(api.workbench, 'showOpenModeSettings').mockResolvedValue(undefined);
    for (const [command, viewId] of [['alwaygit.sidebarLocationSettings', 'alwaygit.workbenchLauncher'], ['alwaygit.panelLocationSettings', 'alwaygit.workbenchPanel'], ['alwaygit.auxiliaryLocationSettings', 'alwaygit.workbenchAuxiliary']]) {
      const registration = vi.mocked(vscode.commands.registerCommand).mock.calls.find(([id]) => id === command);
      expect(registration).toBeDefined();
      await registration![1]();
      expect(locations).toHaveBeenLastCalledWith(viewId);
    }
    expect(api.workbench.presence.open).toBe(false);
    const path = startup.options!.resolveGitPath!();
    expect(startup.builtin).toHaveBeenCalledOnce();
    finishGit({ getAPI: () => ({ git: { path: 'D:\\BuiltinGit\\git.exe' } }) });
    expect(await path).toBe('D:\\BuiltinGit\\git.exe');
    startup.builtin.mockRejectedValueOnce(new Error('disabled'));
    expect(await startup.options!.resolveGitPath!()).toBeUndefined();
  } finally {
    finishScan(); finishGit({ getAPI: () => ({ git: { path: 'git' } }) });
    await activating;
    for (const disposable of context.subscriptions) disposable.dispose();
  }
});
