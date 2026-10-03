import { message, MessageError } from '../i18n';
import { randomUUID } from 'node:crypto';
import type { TerminalEvent, TerminalSession, TerminalShell, TerminalSnapshot } from '../protocol/terminal';

export interface PtyProcess {
  write(data: string): void; resize(cols: number, rows: number): void; kill(): void;
  pause(): void; resume(): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void };
}
export interface ShellLaunch { file: string; args: string[]; name: string; env: Record<string, string> }
export type PtyFactory = (shell: ShellLaunch, cwd: string, cols: number, rows: number) => PtyProcess;
interface Entry {
  owner: object; session: TerminalSession; process: PtyProcess; output: string[]; outputLength: number;
  pending: string; sequence: number; inflight: Map<number, number>; unacknowledged: number; paused: boolean;
  timer?: ReturnType<typeof setTimeout>; subscriptions: { dispose(): void }[];
}
const replayLimit = 1024 * 1024;

/** Shells belong to one workbench, survive hidden views, and never enter the Git command queue. */
export class TerminalSessions {
  private readonly entries = new Map<string, Entry>();
  private readonly closedOwners = new WeakSet<object>();
  constructor(private readonly spawn: PtyFactory, private readonly emit: (owner: object, event: TerminalEvent) => void) {}
  create(owner: object, repoId: string, cwd: string, shell: TerminalShell, launch: ShellLaunch, cols: number, rows: number, replaceId?: string): TerminalSession {
    if (this.closedOwners.has(owner)) throw new MessageError(message('dock.closed'));
    const replacement = replaceId ? this.get(owner, replaceId) : undefined;
    if (replacement && replacement.session.status !== 'exited') throw new MessageError(message('dock.stopBeforeRestart'));
    if (this.list(owner).length >= 24 && !replacement) throw new MessageError(message('dock.limit'));
    const process = this.spawn(launch, cwd, cols, rows);
    const session: TerminalSession = { id: randomUUID(), repoId, cwd, shell, title: `${launch.name} ${this.list(owner).length + 1}`, status: 'running' };
    const entry: Entry = { owner, session, process, output: [], outputLength: 0, pending: '', sequence: 0, inflight: new Map(), unacknowledged: 0, paused: false, subscriptions: [] };
    this.entries.set(session.id, entry);
    entry.subscriptions.push(process.onData(data => {
      // Chunking bounds both IPC payloads and the replay buffer even for very large writes.
      for (let offset = 0; offset < data.length; offset += 32768) {
        entry.pending += data.slice(offset, offset + 32768);
        if (entry.pending.length >= 32768) this.flush(entry);
      }
      entry.timer ??= setTimeout(() => this.flush(entry), 16);
    }), process.onExit(({ exitCode }) => {
      this.flush(entry); entry.session = { ...entry.session, status: 'exited', exitCode };
      this.emit(owner, { type: 'terminalUpdated', session: { ...entry.session } });
    }));
    if (replacement) { this.rename(owner, session.id, replacement.session.title); this.close(owner, replacement.session.id); }
    return { ...entry.session };
  }
  list(owner: object): TerminalSession[] { return [...this.entries.values()].filter(entry => entry.owner === owner).map(entry => ({ ...entry.session })); }
  snapshot(owner: object, id: string): TerminalSnapshot {
    const entry = this.get(owner, id); this.flush(entry);
    return { ...entry.session, output: entry.output.join(''), sequence: entry.sequence };
  }
  input(owner: object, id: string, data: string): void { const entry = this.get(owner, id); if (entry.session.status === 'running') entry.process.write(data); }
  acknowledge(owner: object, id: string, sequence: number): void {
    const entry = this.get(owner, id);
    if (sequence > entry.sequence) throw new MessageError(message('dock.invalidAcknowledgement'));
    for (const [index, length] of entry.inflight) if (index <= sequence) { entry.unacknowledged -= length; entry.inflight.delete(index); }
    if (entry.paused && entry.unacknowledged < 32768 && entry.session.status === 'running') { entry.paused = false; entry.process.resume(); }
  }
  resize(owner: object, id: string, cols: number, rows: number): void { const entry = this.get(owner, id); if (entry.session.status === 'running') entry.process.resize(cols, rows); }
  rename(owner: object, id: string, title: string): void { const entry = this.get(owner, id); entry.session = { ...entry.session, title }; this.emit(owner, { type: 'terminalUpdated', session: { ...entry.session } }); }
  stop(owner: object, id: string): void { const entry = this.get(owner, id); if (entry.session.status === 'running') entry.process.kill(); }
  close(owner: object, id: string): void {
    const entry = this.get(owner, id); this.entries.delete(id); clearTimeout(entry.timer);
    for (const subscription of entry.subscriptions) subscription.dispose();
    if (entry.session.status === 'running') entry.process.kill();
    this.emit(owner, { type: 'terminalClosed', sessionId: id });
  }
  disposeOwner(owner: object): void { this.closedOwners.add(owner); for (const session of this.list(owner)) this.close(owner, session.id); }
  dispose(): void { for (const entry of [...this.entries.values()]) this.disposeOwner(entry.owner); }
  private get(owner: object, id: string): Entry {
    const entry = this.entries.get(id); if (!entry || entry.owner !== owner) throw new MessageError(message('dock.unavailable')); return entry;
  }
  private flush(entry: Entry): void {
    clearTimeout(entry.timer); entry.timer = undefined; if (!entry.pending || !this.entries.has(entry.session.id)) return;
    const data = entry.pending; entry.pending = ''; entry.output.push(data); entry.outputLength += data.length;
    while (entry.outputLength > replayLimit && entry.output.length > 1) entry.outputLength -= entry.output.shift()!.length;
    entry.inflight.set(++entry.sequence, data.length); entry.unacknowledged += data.length;
    if (entry.unacknowledged >= 131072 && !entry.paused && entry.session.status === 'running') { entry.paused = true; entry.process.pause(); }
    this.emit(entry.owner, { type: 'terminalOutput', sessionId: entry.session.id, sequence: entry.sequence, data });
  }
}
