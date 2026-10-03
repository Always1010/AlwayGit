import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalSessions, type PtyProcess, type ShellLaunch } from '../src/application/terminal-sessions';
import { terminalAckSchema, terminalCreateSchema, terminalInputSchema, terminalResizeSchema, terminalRenameSchema } from '../src/protocol/terminal';

const launch: ShellLaunch = { file: 'shell', args: [], name: 'shell', env: {} };
function fixture() {
  const processes: (PtyProcess & { data(value: string): void; exit(code: number): void })[] = [];
  const events = vi.fn();
  const spawn = vi.fn(() => {
    let onData: ((value: string) => void) | undefined, onExit: ((value: { exitCode: number }) => void) | undefined;
    const process = { write: vi.fn(), resize: vi.fn(), kill: vi.fn(), pause: vi.fn(), resume: vi.fn(),
      onData(listener: (value: string) => void) { onData = listener; return { dispose() { onData = undefined; } }; },
      onExit(listener: (value: { exitCode: number }) => void) { onExit = listener; return { dispose() { onExit = undefined; } }; },
      data(value: string) { onData?.(value); }, exit(code: number) { onExit?.({ exitCode: code }); },
    }; processes.push(process); return process;
  });
  return { manager: new TerminalSessions(spawn, events), spawn, events, processes };
}
afterEach(() => vi.useRealTimers());
describe('embedded terminal boundary and lifecycle', () => {
  it('isolates workbenches and keeps the creation directory independent of repository selection', () => {
    const { manager, spawn, processes } = fixture(), owner = {}, other = {};
    const terminal = manager.create(owner, 'repo-a', '/repo-a', 'default', launch, 80, 24);
    manager.create(owner, 'repo-b', '/repo-b', 'bash', launch, 100, 30);
    expect(spawn.mock.calls[0]).toEqual([launch, '/repo-a', 80, 24]);
    for (const action of [() => manager.input(other, terminal.id, 'danger'), () => manager.close(other, terminal.id), () => manager.snapshot(other, terminal.id), () => manager.acknowledge(other, terminal.id, 0)]) expect(action).toThrow();
    expect(manager.list(other)).toEqual([]);
    manager.input(owner, terminal.id, '中文\r'); manager.resize(owner, terminal.id, 120, 32);
    expect(processes[0].write).toHaveBeenCalledWith('中文\r'); expect(processes[0].resize).toHaveBeenCalledWith(120, 32);
    expect(manager.snapshot(owner, terminal.id).cwd).toBe('/repo-a'); manager.dispose();
    expect(processes.every(p => vi.mocked(p.kill).mock.calls.length === 1)).toBe(true);
    expect(() => manager.create(owner, 'repo', '/repo', 'default', launch, 80, 24)).toThrow();
  });
  it('batches output, flushes before replay/exit, pauses until acknowledged and retains bounded history', () => {
    vi.useFakeTimers(); const { manager, processes, events } = fixture(), owner = {};
    const terminal = manager.create(owner, 'repo', '/repo', 'default', launch, 80, 24);
    processes[0].data('hello'); processes[0].data('世界'); expect(events).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16); expect(events.mock.calls[0][1]).toMatchObject({ data: 'hello世界', sequence: 1 });
    for (let index = 0; index < 40; index++) processes[0].data('x'.repeat(32768));
    expect(processes[0].pause).toHaveBeenCalledOnce();
    const snapshot = manager.snapshot(owner, terminal.id); expect(snapshot.output.length).toBeLessThanOrEqual(1024 * 1024);
    expect(() => manager.acknowledge(owner, terminal.id, snapshot.sequence + 1)).toThrow();
    manager.acknowledge(owner, terminal.id, snapshot.sequence); expect(processes[0].resume).toHaveBeenCalledOnce();
    processes[0].data('last output'); processes[0].exit(7);
    expect(manager.snapshot(owner, terminal.id)).toMatchObject({ status: 'exited', exitCode: 7 });
    expect(events.mock.calls.at(-1)?.[1]).toMatchObject({ type: 'terminalUpdated', session: { exitCode: 7 } });
    manager.input(owner, terminal.id, 'ignored'); expect(processes[0].write).not.toHaveBeenCalled(); manager.dispose();
    expect(processes[0].kill).not.toHaveBeenCalled();
  });
  it('limits session count and releases only the closed workbench, including pending callbacks', () => {
    vi.useFakeTimers(); const { manager, processes, events } = fixture(), owner = {}, other = {};
    const terminals = Array.from({ length: 24 }, () => manager.create(owner, 'repo', '/repo', 'default', launch, 80, 24));
    expect(() => manager.create(owner, 'repo', '/repo', 'default', launch, 80, 24)).toThrow();
    processes[1].exit(0);
    manager.rename(owner, terminals[1].id, 'restart me');
    const restarted = manager.create(owner, 'repo', '/repo', 'default', launch, 80, 24, terminals[1].id);
    expect(restarted.title).toBe('restart me'); expect(manager.list(owner)).toHaveLength(24);
    const survivor = manager.create(other, 'repo', '/repo', 'default', launch, 80, 24);
    processes[0].data('pending'); manager.close(owner, terminals[0].id); vi.advanceTimersByTime(100);
    expect(events.mock.calls.some(([, event]) => event.type === 'terminalOutput')).toBe(false);
    manager.disposeOwner(owner); expect(manager.list(owner)).toEqual([]); expect(manager.list(other)).toHaveLength(1);
    manager.rename(other, survivor.id, 'dev'); expect(manager.snapshot(other, survivor.id).title).toBe('dev');
    manager.stop(other, survivor.id); expect(processes.at(-1)!.kill).toHaveBeenCalledOnce(); manager.dispose();
  });
  it('rejects arbitrary launch paths, malformed sizes and oversized input at the protocol boundary', () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    expect(terminalCreateSchema.parse({ cols: 80, rows: 24 }).shell).toBe('default');
    for (const payload of [{ cols: 0, rows: 24 }, { cols: 80, rows: 0 }, { cols: 80, rows: 24, cwd: '/other' }, { cols: 80, rows: 24, shell: '/arbitrary' }]) expect(terminalCreateSchema.safeParse(payload).success).toBe(false);
    expect(terminalInputSchema.safeParse({ sessionId, data: 'x'.repeat(65537) }).success).toBe(false);
    expect(terminalResizeSchema.safeParse({ sessionId, cols: 600, rows: 24 }).success).toBe(false);
    expect(terminalAckSchema.safeParse({ sessionId, sequence: -1 }).success).toBe(false);
    expect(terminalRenameSchema.safeParse({ sessionId, title: 'bad\u001btitle' }).success).toBe(false);
  });
});
