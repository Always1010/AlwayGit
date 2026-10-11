import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate } from '../src/extension/extension';
import type { GitServiceOptions } from '../src/git/service';
import { createConnection } from 'node:net';
import type { Repository } from '../src/protocol/types';

const startup = vi.hoisted(() => ({ scan: vi.fn(), builtin: vi.fn(), bridge: vi.fn(), session: vi.fn(), input: vi.fn(), githubAuth: true, options: undefined as GitServiceOptions | undefined }));
vi.mock('../src/git/service', () => ({ GitService: class { constructor(options: GitServiceOptions) { startup.options = options; } } }));
vi.mock('../src/repositories/manager', () => ({ RepositoryManager: class {
  scan = startup.scan;
  onDidChange = () => ({ dispose() {} });
  onDidChangeRepositories = () => ({ dispose() {} });
  list = () => [];
  dispose() {}
} }));
vi.mock('../src/editor/documents', () => ({ GitDocuments: class { releaseDiffOwner() {} } }));
vi.mock('../src/extension/project-windows', () => ({ ProjectWindows: class { start = startup.bridge; dispose() {} } }));
vi.mock('vscode', () => ({
  EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
  StatusBarAlignment: { Left: 1 }, env: { language: 'en' },
  Uri: { joinPath: () => ({ fsPath: '/extension/dist/askpass.cjs' }) },
  authentication: { getSession: startup.session },
  CancellationTokenSource: class { token = {}; cancel() {} dispose() {} },
  workspace: {
    isTrusted: true, getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === 'gitAuthentication' ? startup.githubAuth : fallback }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }), onDidGrantWorkspaceTrust: () => ({ dispose() {} }), onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  window: {
    showInputBox: startup.input,
    createOutputChannel: () => ({ appendLine: vi.fn(), dispose() {} }),
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
    registerWebviewViewProvider: () => ({ dispose() {} }), registerWebviewPanelSerializer: () => ({ dispose() {} }),
  },
  commands: { executeCommand: vi.fn(async () => {}), registerCommand: vi.fn(() => ({ dispose() {} })) },
  extensions: { getExtension: () => ({ activate: startup.builtin }) },
}));

beforeEach(() => { vi.clearAllMocks(); startup.bridge.mockResolvedValue(undefined); startup.githubAuth = true; });
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

it.each([true, false])('routes network AskPass through VS Code authentication while respecting GitHub settings (%s)', async enabled => {
  startup.scan.mockResolvedValue(undefined);
  startup.githubAuth = enabled;
  startup.session.mockResolvedValue({ account: { id: '123456' }, accessToken: 'session-token' });
  startup.input.mockResolvedValue('manual-answer');
  const context = { subscriptions: [], extensionUri: {}, workspaceState: { get: (_key: string, fallback: unknown) => fallback, update: async () => {} } } as unknown as vscode.ExtensionContext;
  await activate(context);
  const environment = startup.options!.environment;
  if (typeof environment !== 'function') throw new Error('Missing network environment adapter');
  const supplied = await environment({} as Repository, ['push']);
  if (!('env' in supplied) || typeof supplied.env !== 'object') throw new Error('Missing credential bridge');
  const adapter = supplied as { env: NodeJS.ProcessEnv; dispose?: () => void | Promise<void> };
  async function ask(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port: Number(adapter.env!.ALWAYGIT_ASKPASS_PORT) });
      let response = '';
      socket.once('error', reject);
      socket.once('connect', () => socket.write(JSON.stringify({ token: adapter.env!.ALWAYGIT_ASKPASS_TOKEN, prompt }) + '\n'));
      socket.on('data', chunk => { response += chunk; });
      socket.once('end', () => { socket.destroy(); resolve(JSON.parse(response).answer); });
    });
  }
  try {
    expect(await ask("Username for 'https://github.com': ")).toBe(enabled ? '123456' : 'manual-answer');
    if (enabled) {
      expect(await ask("Password for 'https://github.com': ")).toBe('session-token');
      expect(startup.session).toHaveBeenCalledExactlyOnceWith('github', ['repo', 'workflow', 'user:email', 'read:user'], { createIfNone: true });
      expect(startup.input).not.toHaveBeenCalled();
    } else {
      expect(startup.session).not.toHaveBeenCalled(); expect(startup.input).toHaveBeenCalledOnce();
    }
  } finally {
    adapter.dispose?.();
    for (const disposable of context.subscriptions) disposable.dispose();
  }
});
