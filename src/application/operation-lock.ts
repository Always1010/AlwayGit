import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import path from 'node:path';

const LEGACY_STALE_AFTER = 60_000;
const BUSY_MESSAGE = 'A Git operation is already running for this repository in another AlwayGit window.';
const LEASE_PROTOCOL = 'alwaygit-operation-lease-v1';

export class RepositoryOperationBusyError extends Error {}
export class RepositoryOperationRecoveryRequiredError extends Error {
  readonly code = 'REPOSITORY_RECOVERY_REQUIRED';
  constructor(readonly token: string, readonly label: string, readonly pid?: number) { super('The previous Git operation was interrupted. Confirm that its Git processes have ended and inspect the repository before removing its protection.'); }
}
export interface OperationLease { release(): Promise<void>; markRunning(): Promise<void>; quarantine(pid?: number): Promise<void> }
interface LeaseRecord { owner: string; ownerPid?: number; token: string; label: string; acquiredAt: number; port: number; running?: boolean; quarantined?: boolean; pid?: number }

function normalized(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => { server.removeListener('error', reject); resolve(); });
  });
  server.unref();
  return (server.address() as { port: number }).port;
}
async function stop(server: Server): Promise<void> {
  if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
}

/** A live OS-owned endpoint holds each lease; a short OS mutex serializes registry changes. */
export class RepositoryOperationLock {
  private readonly leases = new Map<string, { lease: OperationLease; close(): Promise<void> }>();
  private readonly gatePort: number;
  private closed = false;
  constructor(private readonly directory: string, private readonly owner: string) {
    // Collisions only serialize registry transactions; they cannot grant two repository leases.
    this.gatePort = 12000 + createHash('sha256').update(normalized(directory)).digest().readUInt32BE(0) % 16000;
  }
  private filename(key: string): string {
    return path.join(this.directory, createHash('sha256').update(normalized(key)).digest('hex') + '.lock');
  }
  private async transaction<T>(task: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const gate = createServer(socket => socket.destroy());
      try { await listen(gate, this.gatePort); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
        if (Date.now() >= deadline) throw new RepositoryOperationBusyError(BUSY_MESSAGE);
        await new Promise(resolve => setTimeout(resolve, 20 + Math.floor(Math.random() * 20)));
        continue;
      }
      try { return await task(); }
      finally { await stop(gate); }
    }
  }
  private async live(record: LeaseRecord): Promise<boolean> {
    return new Promise(resolve => {
      const socket = createConnection({ host: '127.0.0.1', port: record.port });
      let finished = false, data = '';
      const finish = (alive: boolean) => { if (finished) return; finished = true; socket.destroy(); resolve(alive); };
      // Paused/slow owners remain busy; unknown listeners and transport errors are conservative.
      socket.setTimeout(1000, () => finish(true));
      socket.once('error', error => finish((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED'));
      socket.once('close', () => finish(true));
      socket.once('connect', () => socket.write(record.token + '\n'));
      socket.on('data', chunk => {
        data += chunk.toString('utf8');
        if (data.includes('\n')) {
          try {
            const response = JSON.parse(data.slice(0, data.indexOf('\n'))) as { protocol?: unknown; token?: unknown };
            // A verified AlwayGit endpoint with another identity proves the old port was reused.
            finish(!(response.protocol === LEASE_PROTOCOL && typeof response.token === 'string' && /^[a-f0-9]{64}$/.test(response.token)) || response.token === record.token);
          } catch { finish(true); }
        } else if (data.length > 256) finish(true);
      });
    });
  }
  private async occupied(filename: string, requireRecovery = false): Promise<boolean> {
    try {
      const text = await readFile(filename, 'utf8');
      let record: Partial<LeaseRecord> = {};
      try { record = JSON.parse(text) as Partial<LeaseRecord>; } catch { /* Partial legacy files use age-based migration. */ }
      if (typeof record.port === 'number' && Number.isInteger(record.port) && record.port > 0 && record.port <= 65535 && typeof record.token === 'string') {
        if (await this.live(record as LeaseRecord)) return true;
        if (record.running || record.quarantined) {
          if (requireRecovery) throw new RepositoryOperationRecoveryRequiredError(record.token, record.label ?? 'Git', record.pid);
          return false;
        }
        return false;
      }
      // Older extension versions have no endpoint. Preserve fresh leases during migration.
      return Date.now() - (await stat(filename)).mtimeMs <= LEGACY_STALE_AFTER;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  async isBusy(key: string): Promise<boolean> {
    return this.transaction(() => this.occupied(this.filename(key)));
  }
  async recover(key: string, token: string): Promise<void> {
    await this.transaction(async () => {
      const filename = this.filename(key), record = JSON.parse(await readFile(filename, 'utf8')) as LeaseRecord;
      if (record.token !== token || await this.live(record)) throw new RepositoryOperationBusyError(BUSY_MESSAGE);
      for (const pid of [record.ownerPid, record.pid].filter((pid): pid is number => !!pid)) {
        try { process.kill(pid, 0); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') continue; throw new RepositoryOperationBusyError(BUSY_MESSAGE); }
        throw new RepositoryOperationBusyError(BUSY_MESSAGE);
      }
      await rm(filename, { force: true });
    });
  }
  async acquire(key: string, label: string): Promise<OperationLease> {
    if (this.closed) throw new Error('Repository operation lock is closed.');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    return this.transaction(async () => {
      if (this.closed) throw new Error('Repository operation lock is closed.');
      const filename = this.filename(key);
      if (await this.occupied(filename, true)) throw new RepositoryOperationBusyError(BUSY_MESSAGE);
      const token = randomBytes(32).toString('hex'), sockets = new Set<Socket>();
      const server = createServer(socket => {
        sockets.add(socket); socket.unref();
        socket.once('close', () => sockets.delete(socket));
        socket.on('error', () => {});
        socket.setTimeout(1000, () => socket.destroy());
        let data = '';
        socket.on('data', chunk => {
          data += chunk.toString('utf8');
          if (data.includes('\n')) socket.end(JSON.stringify({ protocol: LEASE_PROTOCOL, token }) + '\n');
          else if (data.length > 128) socket.destroy();
        });
      });
      const port = await listen(server, 0);
      server.on('error', () => { /* Registry remains conservative on endpoint errors. */ });
      const record: LeaseRecord = { owner: this.owner, ownerPid: process.pid, token, label, acquiredAt: Date.now(), port };
      const persist = async () => {
        const temporary = filename + '.' + token + '.tmp';
        try {
          await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
          await rename(temporary, filename);
        } catch (error) { await rm(temporary, { force: true }).catch(() => {}); throw error; }
      };
      try { await persist(); }
      catch (error) { await stop(server); throw error; }
      let releasing: Promise<void> | undefined;
      const closeEndpoint = async () => { for (const socket of sockets) socket.destroy(); await stop(server); };
      const lease: OperationLease = {
        markRunning: () => this.transaction(async () => { record.running = true; await persist(); }),
        quarantine: pid => this.transaction(async () => { record.quarantined = true; record.pid = pid; await persist(); }),
        release: () => releasing ??= this.transaction(async () => {
        // Ownership cleanup and endpoint teardown are atomic relative to acquisitions.
        try {
          const current = JSON.parse(await readFile(filename, 'utf8')) as Partial<LeaseRecord>;
          if (current.token === token && !record.quarantined) await rm(filename, { force: true });
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        finally {
          this.leases.delete(filename);
          await closeEndpoint();
        }
      }) };
      this.leases.set(filename, { lease, close: async () => {
        if (!record.running && !record.quarantined) await lease.release();
        else await closeEndpoint();
      } });
      return lease;
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.leases.values()].map(entry => entry.close()));
  }
  dispose(): void { void this.close().catch(() => {}); }
}
