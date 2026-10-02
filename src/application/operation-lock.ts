import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';

const STALE_AFTER = 60_000;
const HEARTBEAT = 5_000;

export class RepositoryOperationBusyError extends Error {}

export interface OperationLease { release(): Promise<void> }

/** Cross-extension-host lease used to serialize mutating Git commands per repository. */
export class RepositoryOperationLock {
  private readonly leases = new Map<string, { token: string; heartbeat: ReturnType<typeof setInterval> }>();
  constructor(private readonly directory: string, private readonly owner: string) {}
  private filename(key: string): string {
    const normalized = process.platform === 'win32' ? path.resolve(key).toLowerCase() : path.resolve(key);
    return path.join(this.directory, createHash('sha256').update(normalized).digest('hex') + '.lock');
  }
  async acquire(key: string, label: string): Promise<OperationLease> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const filename = this.filename(key), token = randomBytes(16).toString('hex');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await open(filename, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify({ owner: this.owner, token, label, acquiredAt: Date.now() })); }
        finally { await handle.close(); }
        const heartbeat = setInterval(() => { const now = new Date(); void utimes(filename, now, now).catch(() => {}); }, HEARTBEAT);
        heartbeat.unref();
        this.leases.set(filename, { token, heartbeat });
        let released = false;
        return { release: async () => {
          if (released) return;
          released = true;
          const lease = this.leases.get(filename);
          if (lease?.token === token) this.leases.delete(filename);
          clearInterval(heartbeat);
          try {
            const current = JSON.parse(await readFile(filename, 'utf8')) as { token?: unknown };
            if (current.token === token) await rm(filename, { force: true });
          } catch { /* A crashed or replaced lease is no longer ours to remove. */ }
        } };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (attempt === 0) {
          try {
            const info = await stat(filename);
            if (Date.now() - info.mtimeMs > STALE_AFTER) { await rm(filename, { force: true }); continue; }
          } catch (readError) {
            if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue;
          }
        }
        throw new RepositoryOperationBusyError('A Git operation is already running for this repository in another AlwayGit window.');
      }
    }
    throw new RepositoryOperationBusyError('A Git operation is already running for this repository in another AlwayGit window.');
  }
  async close(): Promise<void> {
    const active = [...this.leases.entries()];
    this.leases.clear();
    await Promise.all(active.map(async ([filename, lease]) => {
      clearInterval(lease.heartbeat);
      try {
        const current = JSON.parse(await readFile(filename, 'utf8')) as { token?: unknown };
        if (current.token === lease.token) await rm(filename, { force: true });
      } catch { /* Best-effort cleanup; stale leases recover automatically. */ }
    }));
  }
  dispose(): void { void this.close(); }
}
