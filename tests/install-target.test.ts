import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

const { resolveInstallTarget } = await import(new URL('../scripts/install-target.mjs', import.meta.url).href);
const { assertCodeCompatibility } = await import(new URL('../scripts/install.mjs', import.meta.url).href);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-target-test-'));
  roots.push(root);
  const home = path.join(root, 'home');
  const platform = process.platform;
  const env = { PATH: '', VSCODE_AGENT_FOLDER: '', VSCODE_IPC_HOOK_CLI: '', VSCODE_CLIENT_COMMAND: '', SSH_CONNECTION: '' };
  const calls: { command: string; args: string[]; env: Record<string, string> }[] = [];
  const run = async (command: string, args: string[], options: { env: Record<string, string> }) => {
    calls.push({ command, args, env: options.env });
    if (args[0] === '--help') return '--install-extension --list-extensions --show-versions --server-data-dir --extensions-dir';
    let version = '1.141.0';
    if (path.basename(command).startsWith('code-server')) version = JSON.parse(await readFile(path.join(path.dirname(command), '../package.json'), 'utf8')).version;
    return `${version}\ncommit\nx64`;
  };
  return { root, home, platform, env, run, calls, host: 'linux-x64', checkVersion: (output: string, cli: string) => assertCodeCompatibility(output, '^1.106.0', cli) };
}

async function server(f: Awaited<ReturnType<typeof fixture>>, version: string, dataDir = path.join(f.home, '.vscode-server'), legacy = false) {
  const root = legacy ? path.join(dataDir, 'bin', version) : path.join(dataDir, 'cli/servers', `Stable-${version}`, 'server');
  await mkdir(path.join(root, 'bin/remote-cli'), { recursive: true });
  await mkdir(path.join(root, 'out'));
  await writeFile(path.join(root, 'product.json'), JSON.stringify({ serverApplicationName: 'code-server', serverDataFolderName: '.vscode-server' }));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version }));
  await writeFile(path.join(root, 'out/server-main.js'), '');
  const codePath = path.join(root, 'bin', f.platform === 'win32' ? 'code-server.cmd' : 'code-server');
  const remoteCli = path.join(root, 'bin/remote-cli/code');
  await writeFile(codePath, '', { mode: 0o755 });
  await writeFile(remoteCli, '', { mode: 0o755 });
  return { codePath, remoteCli, root, dataDir };
}

describe('Explicit Desktop and Server installation targets', () => {
  it('defaults desktop resolution to a desktop CLI even when remote-cli is first on PATH, and removes remote forwarding variables', async () => {
    const f = await fixture();
    const s = await server(f, '1.141.0');
    const desktopDir = path.join(f.root, 'desktop');
    await mkdir(desktopDir);
    const desktop = path.join(desktopDir, 'code');
    await writeFile(desktop, '', { mode: 0o755 });
    f.env.PATH = [path.dirname(s.remoteCli), desktopDir].join(path.delimiter);
    f.env.VSCODE_IPC_HOOK_CLI = 'session';
    f.env.VSCODE_AGENT_FOLDER = s.dataDir;
    const result = await resolveInstallTarget('desktop', { ...f, previous: { codePath: s.remoteCli } });
    expect(result.codePath).toBe(desktop);
    expect(result.cliArgs).toEqual([]);
    expect(f.calls.every(call => !call.env.VSCODE_IPC_HOOK_CLI && !call.env.VSCODE_AGENT_FOLDER)).toBe(true);
    expect(f.env.VSCODE_IPC_HOOK_CLI).toBe('session');
  });

  it('finds the latest usable compatible Server automatically in ordinary SSH, including older bin layouts', async () => {
    const f = await fixture();
    await server(f, '1.105.0');
    await server(f, '2.0.0');
    const selected = await server(f, '1.141.0', undefined, true);
    f.env.SSH_CONNECTION = 'ordinary SSH';
    const result = await resolveInstallTarget('server', f);
    expect(result.codePath).toBe(selected.codePath);
    expect(result.cliArgs).toEqual(['--server-data-dir', selected.dataDir, '--extensions-dir', path.join(selected.dataDir, 'extensions')]);
  });

  it('pins the current VS Code session instead of choosing a newer downloaded Server', async () => {
    const f = await fixture();
    const current = await server(f, '1.106.0');
    await server(f, '1.141.0');
    f.env.PATH = path.dirname(current.remoteCli);
    f.env.VSCODE_IPC_HOOK_CLI = 'current session';
    expect((await resolveInstallTarget('server', f)).codePath).toBe(current.codePath);
    expect(f.calls.every(call => call.command === current.codePath)).toBe(true);
  });

  it('does not hide an incompatible current session by switching to another Server', async () => {
    const f = await fixture();
    const current = await server(f, '1.98.2');
    await server(f, '1.141.0');
    f.env.PATH = path.dirname(current.remoteCli);
    f.env.VSCODE_CLIENT_COMMAND = 'active client';
    await expect(resolveInstallTarget('server', f)).rejects.toThrow(/1\.98\.2.*不兼容/);
    expect(f.calls.every(call => call.command === current.codePath)).toBe(true);
  });

  it('uses a custom Server data root consistently', async () => {
    const f = await fixture();
    const custom = path.join(f.home, 'custom-server-data');
    const selected = await server(f, '1.141.0', custom);
    await server(f, '1.150.0');
    f.env.VSCODE_AGENT_FOLDER = custom;
    const result = await resolveInstallTarget('server', f);
    expect(result.codePath).toBe(selected.codePath);
    expect(result.serverDataDir).toBe(custom);
    expect(result.extensionsDir).toBe(path.join(custom, 'extensions'));
  });

  it('keeps a custom data root even when the Server binaries are installed under the standard root', async () => {
    const f = await fixture();
    const selected = await server(f, '1.141.0');
    f.env.VSCODE_AGENT_FOLDER = path.join(f.home, 'separate-data');
    const result = await resolveInstallTarget('server', f);
    expect(result.codePath).toBe(selected.codePath);
    expect(result.serverDataDir).toBe(f.env.VSCODE_AGENT_FOLDER);
    expect(result.extensionsDir).toBe(path.join(f.env.VSCODE_AGENT_FOLDER, 'extensions'));
  });

  it('rejects explicit CLI overrides for the wrong destination', async () => {
    const f = await fixture();
    const s = await server(f, '1.141.0');
    const unrelated = path.join(f.root, 'code-server');
    await writeFile(unrelated, '', { mode: 0o755 });
    await expect(resolveInstallTarget('desktop', { ...f, requestedCli: s.remoteCli })).rejects.toThrow(/属于 VS Code Server/);
    await expect(resolveInstallTarget('server', { ...f, requestedCli: unrelated })).rejects.toThrow(/不属于.*官方 Server/);
    expect(f.calls).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('recognizes a symlink to remote-cli and refuses to treat it as desktop', async () => {
    const f = await fixture();
    const s = await server(f, '1.141.0');
    const link = path.join(f.root, 'code');
    await symlink(s.remoteCli, link);
    await expect(resolveInstallTarget('desktop', { ...f, requestedCli: link })).rejects.toThrow(/属于 VS Code Server/);
  });

  it('does not fall back to desktop when Server is absent', async () => {
    const f = await fixture();
    const desktop = path.join(f.root, 'code');
    await writeFile(desktop, '', { mode: 0o755 });
    f.env.PATH = f.root;
    await expect(resolveInstallTarget('server', f)).rejects.toThrow(/找不到可用的官方 VS Code Server/);
    expect(f.calls).toEqual([]);
  });

  it('does not fall back to Server when desktop is absent', async () => {
    const f = await fixture();
    const s = await server(f, '1.141.0');
    f.env.PATH = path.dirname(s.remoteCli);
    // The fixture has no macOS application, regardless of the test machine's desktop installs.
    await expect(resolveInstallTarget('desktop', { ...f, platform: 'darwin' })).rejects.toThrow(/找不到当前机器的桌面 VS Code/);
    expect(f.calls).toEqual([]);
  });
});
