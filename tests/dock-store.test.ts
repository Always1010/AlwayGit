import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSession } from '../src/protocol/terminal';

const bridge = vi.hoisted(() => ({ rpc: vi.fn(), subscribe: vi.fn(() => () => {}) }));
vi.mock('../webview/rpc', () => bridge);

const session: TerminalSession = { id: 'terminal-a', repoId: 'repo', cwd: '/repo', title: 'PowerShell', shell: 'default', status: 'running' };
beforeEach(() => { vi.resetModules(); bridge.rpc.mockReset(); });

describe('dock terminal loading recovery', () => {
  it('allows creation after a failed terminal list without requiring a reload', async () => {
    const { useDock } = await import('../webview/dock-store');
    const error = new Error('terminal list timed out');
    bridge.rpc.mockRejectedValueOnce(error).mockResolvedValueOnce(session);

    await expect(useDock.getState().load()).rejects.toBe(error);
    await useDock.getState().create('repo');

    expect(bridge.rpc).toHaveBeenLastCalledWith('terminalCreate', 'repo', { shell: 'default', cols: 80, rows: 24 });
    expect(useDock.getState()).toMatchObject({ sessions: [session], activeId: session.id, creating: false });
  });

  it('retries failed loads while sharing pending loads and caching a successful result', async () => {
    const { useDock } = await import('../webview/dock-store');
    const error = new Error('terminal list timed out');
    let rejectList!: (error: Error) => void;
    bridge.rpc.mockImplementationOnce(() => new Promise((_, reject) => { rejectList = reject; }));
    const first = useDock.getState().load();
    expect(useDock.getState().load()).toBe(first);
    const failed = expect(first).rejects.toBe(error);
    rejectList(error);
    await failed;

    let resolveList!: (sessions: TerminalSession[]) => void;
    const created = { ...session, id: 'terminal-b' };
    bridge.rpc.mockImplementationOnce(() => new Promise(resolve => { resolveList = resolve; })).mockResolvedValueOnce(created);
    const retry = useDock.getState().load();
    expect(useDock.getState().load()).toBe(retry);
    const creation = useDock.getState().create('repo');
    expect(bridge.rpc).toHaveBeenCalledTimes(2);
    resolveList([session]);
    await Promise.all([retry, creation]);

    expect(useDock.getState()).toMatchObject({ sessions: [session, created], activeId: created.id, creating: false });
    expect(useDock.getState().load()).toBe(retry);
    expect(bridge.rpc).toHaveBeenCalledTimes(3);
  });
});
