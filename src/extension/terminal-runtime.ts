import { message, MessageError } from '../i18n';
import * as vscode from 'vscode';
import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ShellLaunch, PtyFactory } from '../application/terminal-sessions';
import type { TerminalShell } from '../protocol/terminal';

function executable(name: string): string {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(directory, name); if (existsSync(candidate)) return candidate;
  }
  return name;
}
export function terminalShell(shell: TerminalShell): ShellLaunch {
  const programFiles = process.env.ProgramFiles ?? String.raw`C:\Program Files`;
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const windows = process.platform === 'win32';
  const platform = windows ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  const config = vscode.workspace.getConfiguration('terminal.integrated');
  let file = windows ? executable(existsSync(executable('pwsh.exe')) ? 'pwsh.exe' : 'powershell.exe') : process.env.SHELL ?? '/bin/bash';
  let args: string[] = windows ? ['-NoLogo'] : ['-l'];
  if (shell === 'cmd') { if (!windows) throw new MessageError(message('dock.cmdWindows')); file = process.env.ComSpec ?? 'cmd.exe'; args = []; }
  if (shell === 'powershell') { file = executable(windows ? existsSync(executable('pwsh.exe')) ? 'pwsh.exe' : 'powershell.exe' : 'pwsh'); args = ['-NoLogo']; }
  if (shell === 'bash') { file = windows ? path.join(programFiles, 'Git', 'bin', 'bash.exe') : '/bin/bash'; args = ['-l']; }
  if (shell === 'default') {
    const profileName = config.get<string>(`defaultProfile.${platform}`);
    const profiles = config.get<Record<string, { path?: string | string[]; args?: string[] | string; source?: string }>>(`profiles.${platform}`, {});
    const profile = profileName ? profiles[profileName] : undefined;
    const expand = (value: string) => value.replace(/\$\{env:([^}]+)\}/g, (_, key: string) => process.env[key] ?? '').replace(/\$\{userHome\}/g, os.homedir());
    const configured = typeof profile?.path === 'string' ? expand(profile.path) : profile?.path?.map(expand).find(value => existsSync(value));
    if (configured) { file = configured; args = /(?:powershell|pwsh)(?:\.exe)?$/i.test(file) ? ['-NoLogo'] : /(?:ba|z|fi)?sh(?:\.exe)?$/i.test(file) ? ['-l'] : []; }
    else if (profile?.source === 'Git Bash' || profileName === 'Git Bash') { file = path.join(programFiles, 'Git', 'bin', 'bash.exe'); args = ['-l']; }
    else if (windows && profileName === 'Command Prompt') { file = process.env.ComSpec ?? 'cmd.exe'; args = []; }
    if (Array.isArray(profile?.args)) args = profile.args;
    else if (typeof profile?.args === 'string') throw new MessageError(message('dock.profileArgs'));
  }
  // Apply configured terminal environment without mutating the extension host environment.
  for (const [key, value] of Object.entries(config.get<Record<string, string | null>>(`env.${platform}`, {}))) {
    if (value === null) delete env[key]; else env[key] = value.replace(/\$\{env:([^}]+)\}/g, (_, name: string) => process.env[name] ?? '');
  }
  env.TERM = 'xterm-256color'; env.COLORTERM = 'truecolor';
  return { file, args, name: path.basename(file).replace(/\.exe$/i, ''), env };
}

/** Load native binaries only on explicit creation, isolated from the VS Code extension host. */
export const spawnTerminal: PtyFactory = (shell, cwd, cols, rows) => {
  const child = fork(path.join(__dirname, 'terminal-host.cjs'), [], { windowsHide: true, execArgv: [],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const dataListeners = new Set<(data: string) => void>(), exitListeners = new Set<(event: { exitCode: number }) => void>();
  let exited = false, stopping = false, deadline: ReturnType<typeof setTimeout> | undefined;
  const output = (data: string) => { for (const listener of dataListeners) listener(data); };
  const exit = (exitCode: number) => { if (exited) return; exited = true; clearTimeout(deadline); for (const listener of exitListeners) listener({ exitCode }); };
  child.on('message', (event: { type: string; data?: string; exitCode?: number }) => {
    if (event.type === 'data') output(event.data!); else if (event.type === 'exit') exit(event.exitCode ?? 1);
  });
  child.stderr?.on('data', data => output(String(data)));
  child.on('error', error => { output(`\r\n${error.message}\r\n`); exit(1); });
  child.on('exit', code => exit(code ?? 1));
  const send = (value: object) => { if (child.connected && !exited) child.send(value, error => { if (error && !exited) { output(`\r\n${error.message}\r\n`); exit(1); } }); };
  send({ type: 'start', shell, cwd, cols, rows });
  return {
    write: data => send({ type: 'input', data }), resize: (cols, rows) => send({ type: 'resize', cols, rows }),
    pause: () => send({ type: 'pause' }), resume: () => send({ type: 'resume' }),
    kill() {
      if (stopping || exited) return; stopping = true; send({ type: 'kill' });
      deadline = setTimeout(() => { child.kill(); }, 5000); deadline.unref();
    },
    onData(listener) { dataListeners.add(listener); return { dispose() { dataListeners.delete(listener); } }; },
    onExit(listener) { exitListeners.add(listener); return { dispose() { exitListeners.delete(listener); } }; },
  };
};
