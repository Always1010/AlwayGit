import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminalShell } from '../src/extension/terminal-runtime';

const settings = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));
vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) => settings.values[key] ?? fallback }) } }));
afterEach(() => { settings.values = {}; vi.unstubAllEnvs(); });

describe('embedded terminal profile environment', () => {
  it('applies profile overrides after global terminal settings, expands variables and removes null entries', () => {
    const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
    vi.stubEnv('ALWAYGIT_TEST_PROFILE_BASE', 'host-value');
    vi.stubEnv('ALWAYGIT_TEST_PROFILE_REMOVE', 'host-value');
    vi.stubEnv('ALWAYGIT_TEST_GLOBAL_REMOVE', 'host-value');
    settings.values = {
      [`defaultProfile.${platform}`]: 'Configured',
      [`profiles.${platform}`]: { Configured: { path: process.execPath, args: [], env: {
        ALWAYGIT_TEST_PROFILE_BASE: 'profile-value',
        ALWAYGIT_TEST_PROFILE_REMOVE: null,
        ALWAYGIT_TEST_EXPANDED: '${env:ALWAYGIT_TEST_PROFILE_BASE}:${userHome}',
        ALWAYGIT_TEST_AUTH: 'profile-auth',
      } } },
      [`env.${platform}`]: { ALWAYGIT_TEST_PROFILE_BASE: 'global-value', ALWAYGIT_TEST_PROFILE_REMOVE: 'global-value', ALWAYGIT_TEST_GLOBAL_REMOVE: null, ALWAYGIT_TEST_AUTH: 'global-auth' },
    };
    const result = terminalShell('default', { ALWAYGIT_TEST_AUTH: 'injected-auth' });
    expect(result).toMatchObject({ file: process.execPath, args: [], env: {
      ALWAYGIT_TEST_PROFILE_BASE: 'profile-value', ALWAYGIT_TEST_EXPANDED: `host-value:${os.homedir()}`, ALWAYGIT_TEST_AUTH: 'profile-auth',
    } });
    expect(result.env).not.toHaveProperty('ALWAYGIT_TEST_PROFILE_REMOVE');
    expect(result.env).not.toHaveProperty('ALWAYGIT_TEST_GLOBAL_REMOVE');
    expect(process.env.ALWAYGIT_TEST_PROFILE_BASE).toBe('host-value');
    expect(process.env.ALWAYGIT_TEST_PROFILE_REMOVE).toBe('host-value');
    const explicit = terminalShell('bash', { ALWAYGIT_TEST_AUTH: 'injected-auth' });
    expect(explicit.env.ALWAYGIT_TEST_PROFILE_BASE).toBe('global-value');
    expect(explicit.env.ALWAYGIT_TEST_AUTH).toBe('global-auth');
    expect(explicit.env).not.toHaveProperty('ALWAYGIT_TEST_EXPANDED');
  });
});
