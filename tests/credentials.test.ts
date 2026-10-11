import { describe, it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chmod } from 'node:fs/promises';
import { credentialEnvironment, withGitHubAuthentication } from '../src/application/credentials';

describe('VS Code GitHub authentication', () => {
  it.each([false, true])('answers actual Git credentials from one command-local session (existing username: %s)', async existingUsername => {
    if (process.platform !== 'win32') await chmod(path.resolve('src/extension/askpass.sh'), 0o755);
    const fallback = vi.fn(async () => undefined);
    const getSession = vi.fn(async () => ({ account: { id: '123456' }, accessToken: 'test-github-token' }));
    const adapter = await credentialEnvironment(path.resolve('src/extension/askpass.cjs'), withGitHubAuthentication(fallback, getSession));
    try {
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn('git', ['-c', 'credential.helper=', 'credential', 'fill'], { env: { ...process.env, ...adapter.env }, windowsHide: true });
        let stdout = ''; let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.once('error', reject);
        child.once('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
        child.stdin.end(`protocol=https\nhost=github.com\n${existingUsername ? 'username=123456\n' : ''}\n`);
      });
      expect(output).toContain('username=123456'); expect(output).toContain('password=test-github-token');
      expect(getSession).toHaveBeenCalledOnce(); expect(fallback).not.toHaveBeenCalled();
      expect(JSON.stringify(adapter.env)).not.toContain('test-github-token');
    } finally { adapter.dispose(); }
  });

  it.each([
    "Password for 'https://github.com.evil.test': ",
    "Password for 'https://github.com@evil.test': ",
    "Password for 'http://github.com': ",
    "Password for 'https://github.com:8443': ",
    "Password for 'https://gitlab.com': ",
    "Enter passphrase for key '/home/user/.ssh/id_ed25519': ",
  ])('keeps GitHub tokens away from other hosts and SSH (%s)', async message => {
    const fallback = vi.fn(async () => 'manual-answer'), getSession = vi.fn(async () => ({ account: { id: '123456' }, accessToken: 'test-token' }));
    const prompt = withGitHubAuthentication(fallback, getSession), signal = new AbortController().signal;
    expect(await prompt(message, true, signal)).toBe('manual-answer');
    expect(getSession).not.toHaveBeenCalled(); expect(fallback).toHaveBeenCalledWith(message, true, signal);
  });

  it('uses the input fallback when GitHub authentication is unavailable', async () => {
    const fallback = vi.fn(async () => 'manual-user');
    const prompt = withGitHubAuthentication(fallback, async () => undefined);
    expect(await prompt("Username for 'https://github.com': ", false, new AbortController().signal)).toBe('manual-user');
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('uses the requested field even when a repository name contains password or token', async () => {
    const fallback = vi.fn(async () => undefined);
    const prompt = withGitHubAuthentication(fallback, async () => ({ account: { id: '123456' }, accessToken: 'test-token' }));
    expect(await prompt("Username for 'https://github.com/org/password-token-repo': ", true, new AbortController().signal)).toBe('123456');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('stops after login refusal without opening another input prompt', async () => {
    const fallback = vi.fn(async () => 'manual-user');
    const prompt = withGitHubAuthentication(fallback, async () => { throw new Error('User did not consent'); });
    await expect(prompt("Username for 'https://github.com': ", false, new AbortController().signal)).rejects.toThrow('User did not consent');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('stops waiting on cancellation and discards late authentication results', async () => {
    let finish!: (session: { account: { id: string }; accessToken: string }) => void;
    const session = new Promise<{ account: { id: string }; accessToken: string }>(resolve => { finish = resolve; });
    const getSession = vi.fn(() => session), fallback = vi.fn(async () => 'manual-user'), controller = new AbortController();
    const prompt = withGitHubAuthentication(fallback, getSession);
    const answer = prompt("Password for 'https://github.com': ", true, controller.signal);
    controller.abort();
    expect(await answer).toBeUndefined();
    finish({ account: { id: '123456' }, accessToken: 'late-token' });
    expect(await prompt("Password for 'https://github.com': ", true, controller.signal)).toBeUndefined();
    expect(getSession).toHaveBeenCalledOnce(); expect(fallback).not.toHaveBeenCalled();
  });
});

describe('Git AskPass bridge', () => {
  it.each(['cancelPrompts', 'dispose'] as const)('closes pending input when the command calls %s', async stop => {
    let ready!: () => void;
    const entered = new Promise<void>(resolve => { ready = resolve; });
    let promptSignal: AbortSignal | undefined;
    const adapter = await credentialEnvironment(path.resolve('src/extension/askpass.cjs'), async (_message, _password, signal) => {
      promptSignal = signal; ready();
      return new Promise<undefined>(resolve => signal.addEventListener('abort', () => resolve(undefined), { once: true }));
    });
    try {
      const child = spawn(process.execPath, ['src/extension/askpass.cjs', 'Password:'], { env: { ...process.env, ...adapter.env }, windowsHide: true });
      const finished = new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code ?? -1)); });
      await entered; adapter[stop]();
      expect(promptSignal?.aborted).toBe(true);
      expect(await finished).toBe(1);
    } finally { adapter.dispose(); }
  });
  it('answers actual Git prompts without persisting credentials', async () => {
    if (process.platform !== 'win32') await chmod(path.resolve('src/extension/askpass.sh'), 0o755);
    const prompts: { message: string; password: boolean }[] = [];
    const adapter = await credentialEnvironment(path.resolve('src/extension/askpass.cjs'), async (message, password) => { prompts.push({ message, password }); return password ? 'test-secret' : 'test-user'; });
    try {
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn('git', ['-c', 'credential.helper=', 'credential', 'fill'], { env: { ...process.env, ...adapter.env }, windowsHide: true });
        let stdout = ''; let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('error', reject);
        child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
        child.stdin.end('protocol=https\nhost=alwaygit.example.test\n\n');
      });
      expect(output).toContain('username=test-user'); expect(output).toContain('password=test-secret');
      expect(prompts.map(p => p.password)).toEqual([false, true]);
      expect(JSON.stringify(adapter.env)).not.toContain('test-secret');
    } finally { adapter.dispose(); }
  });
  it('lets a credential helper authenticate before falling back to AskPass', async () => {
    const prompts: string[] = [];
    const adapter = await credentialEnvironment(path.resolve('src/extension/askpass.cjs'), async message => { prompts.push(message); return undefined; });
    // Simulate an interactive helper without opening a browser or contacting a host.
    const helper = "!f() { if test \"$GCM_INTERACTIVE\" = never; then exit 1; fi; printf 'username=helper-user\\npassword=helper-secret\\n'; }; f";
    try {
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn('git', ['-c', 'credential.helper=', '-c', `credential.helper=${helper}`, 'credential', 'fill'], { env: { ...process.env, GCM_INTERACTIVE: undefined, ...adapter.env }, windowsHide: true });
        let stdout = ''; let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('error', reject);
        child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
        child.stdin.end('protocol=https\nhost=alwaygit.example.test\n\n');
      });
      expect(output).toContain('username=helper-user'); expect(output).toContain('password=helper-secret');
      expect(prompts).toEqual([]);
      expect(JSON.stringify(adapter.env)).not.toContain('helper-secret');
    } finally { adapter.dispose(); }
  });
  it('propagates user cancellation instead of producing an empty credential', async () => {
    const adapter = await credentialEnvironment(path.resolve('src/extension/askpass.cjs'), async () => undefined);
    try {
      const code = await new Promise<number>((resolve, reject) => {
        const child = spawn(process.execPath, ['src/extension/askpass.cjs', 'Password:'], { env: { ...process.env, ...adapter.env }, windowsHide: true });
        child.on('error', reject); child.on('close', value => resolve(value ?? -1));
      });
      expect(code).toBe(1);
    } finally { adapter.dispose(); }
  });
});
