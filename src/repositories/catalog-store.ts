import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { z } from 'zod';
import type { RepositoryCollection, RepositoryOrder } from '../protocol/types';

const orderSchema = z.object({ root: z.array(z.string()), collections: z.record(z.string(), z.array(z.string())) });
const schema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(),
  roots: z.array(z.string()), exclusions: z.array(z.string()),
  collections: z.array(z.object({ id: z.string(), name: z.string() })),
  assignments: z.record(z.string(), z.string()), order: orderSchema.optional(),
  importedWorkspaces: z.array(z.string()).optional(),
});
export interface RepositoryCatalog {
  schemaVersion: 1; revision: number; roots: string[]; exclusions: string[];
  collections: RepositoryCollection[]; assignments: Record<string, string>; order?: RepositoryOrder;
  importedWorkspaces?: string[];
}

/** The JSON file is authoritative; Memento is only a compatibility mirror. */
export class CatalogStore {
  private current: RepositoryCatalog;
  private queue: Promise<unknown> = Promise.resolve();
  readonly filename: string;
  constructor(private readonly directory: string, private readonly migrate: () => RepositoryCatalog) {
    this.filename = path.join(directory, 'repository-catalog.v1.json');
    this.current = { schemaVersion: 1, revision: 0, roots: [], exclusions: [], collections: [], assignments: {} };
  }
  snapshot(): RepositoryCatalog { return structuredClone(this.current); }
  private async read(): Promise<RepositoryCatalog | undefined> {
    let content: string;
    try { content = await readFile(this.filename, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    try { return schema.parse(JSON.parse(content)); }
    catch { throw new Error('The shared repository catalog is damaged or uses an unsupported schema. Its contents were preserved.'); }
  }
  private async write(catalog: RepositoryCatalog): Promise<void> {
    const temporary = this.filename + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, JSON.stringify(schema.parse(catalog)), { flag: 'wx', mode: 0o600 });
      await rename(temporary, this.filename);
    } finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
  private async locked<T>(task: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const canonical = await realpath(this.directory);
    const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    // Hash collisions merely serialize unrelated catalogs. The OS releases this gate on host exit.
    const port = 28000 + createHash('sha256').update(identity).digest().readUInt32BE(0) % 16000;
    const deadline = Date.now() + 10_000;
    for (;;) {
      const gate = createServer(socket => socket.destroy());
      try {
        await new Promise<void>((resolve, reject) => {
          gate.once('error', reject);
          gate.listen({ port, host: '127.0.0.1', exclusive: true }, () => { gate.removeListener('error', reject); resolve(); });
        });
        gate.unref();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
        if (Date.now() >= deadline) throw new Error('The shared repository catalog is busy. Try again.');
        await new Promise(resolve => setTimeout(resolve, 20)); continue;
      }
      try { return await task(); }
      finally { await new Promise<void>(resolve => gate.close(() => resolve())); }
    }
  }
  transaction<T>(reduce: (catalog: RepositoryCatalog) => T): Promise<T> {
    const operation = this.queue.then(() => this.locked(async () => {
      const saved = await this.read(), next = saved ?? schema.parse(this.migrate());
      const previous = JSON.stringify(next), result = reduce(next);
      schema.parse(next);
      if (!saved || JSON.stringify(next) !== previous) {
        next.revision++;
        await this.write(next);
      }
      this.current = structuredClone(next);
      return result;
    }));
    this.queue = operation.catch(() => {});
    return operation;
  }
  async reload(): Promise<void> { await this.transaction(() => {}); }
}
