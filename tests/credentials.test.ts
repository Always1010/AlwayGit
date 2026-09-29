import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chmod } from 'node:fs/promises';
import { credentialEnvironment } from '../src/application/credentials';

describe('Git AskPass bridge', () => {
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
