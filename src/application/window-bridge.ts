import { createServer, createConnection, type Server, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const LIMIT = 64 * 1024;
const HEARTBEAT = 5000;
const recordSchema = z.object({ version: z.literal(1), id: z.string().regex(/^[a-f0-9]{32}$/), port: z.number().int().min(1).max(65535), token: z.string().regex(/^[a-f0-9]{64}$/), roots: z.array(z.string().max(4096)).max(128), focusedAt: z.number(), updatedAt: z.number() });
export type WindowRecord = z.infer<typeof recordSchema>;
export const projectRequestSchema = z.object({ root: z.string().min(1).max(4096).refine(value => path.isAbsolute(value) && !value.includes('\0')), action: z.literal('project') }).strict();
export type ProjectRequest = z.infer<typeof projectRequestSchema>;

export async function canonicalPath(value: string): Promise<string> {
  const resolved = path.resolve(await realpath(value));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Only actual workspace folders qualify; a remembered repository is not an open project. */
export function windowMatch(record: WindowRecord, root: string): number {
  if (record.roots.includes(root)) return Number.MAX_SAFE_INTEGER;
  return Math.max(-1, ...record.roots.map(folder => {
    const relation = path.relative(folder, root);
    return relation && relation !== '..' && !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation) ? folder.length : -1;
  }));
}

export class WindowTransportError extends Error {}

/** One authenticated loopback endpoint per extension host, with a disposable local registry. */
export class WindowBridge {
  private readonly sockets = new Set<Socket>();
  private readonly server: Server;
  private heartbeat?: ReturnType<typeof setInterval>;
  private closed = false;
  private writes: Promise<void> = Promise.resolve();
  readonly record: WindowRecord = { version: 1, id: randomBytes(16).toString('hex'), token: randomBytes(32).toString('hex'), port: 0, roots: [], focusedAt: 0, updatedAt: 0 };
  constructor(readonly directory: string, private readonly execute: (request: ProjectRequest) => Promise<void>, private readonly log: (message: string) => void = () => {}) {
    this.server = createServer(socket => {
      this.sockets.add(socket);
      socket.setTimeout(30000, () => socket.destroy());
      socket.once('close', () => this.sockets.delete(socket));
      socket.on('error', () => {});
      let data = Buffer.alloc(0), answered = false;
      socket.on('data', async chunk => {
        if (answered) return;
        data = Buffer.concat([data, chunk]);
        if (data.length > LIMIT) { socket.destroy(); return; }
        const end = data.indexOf(10);
        if (end < 0) return;
        answered = true;
        try {
          const envelope = JSON.parse(data.subarray(0, end).toString('utf8'));
          if (envelope.token !== this.record.token) { socket.destroy(); return; }
          if (envelope.ping === true) { socket.end('{"ok":true}\n'); return; }
          const request = projectRequestSchema.parse(envelope.request);
          const root = await canonicalPath(request.root);
          if (windowMatch(this.record, root) < 0) throw new Error('The project is no longer open in this window.');
          await this.execute({ ...request, root });
          socket.end('{"ok":true}\n');
        } catch (error) { socket.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n'); }
      });
    });
  }
  async start(roots: string[], focused = false): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => { this.server.removeListener('error', reject); resolve(); });
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Cannot register the project window.');
    this.record.port = address.port;
    this.server.on('error', error => this.log(error.message));
    await this.update(roots, focused);
    this.heartbeat = setInterval(() => { void this.publish().catch(error => this.log(String(error))); }, HEARTBEAT);
    this.heartbeat.unref();
  }
  async update(roots: string[], focused: boolean): Promise<void> {
    this.record.roots = (await Promise.all(roots.map(root => canonicalPath(root).catch(() => undefined)))).filter((root): root is string => !!root);
    if (focused) this.record.focusedAt = Date.now();
    await this.publish();
  }
  private publish(): Promise<void> {
    this.writes = this.writes.catch(() => {}).then(async () => {
      if (this.closed) return;
      this.record.updatedAt = Date.now();
      const destination = path.join(this.directory, this.record.id + '.json');
      const temporary = destination + '.tmp';
      await writeFile(temporary, JSON.stringify(this.record), { mode: 0o600 });
      await rename(temporary, destination);
    });
    return this.writes;
  }
  async candidates(root: string): Promise<WindowRecord[]> {
    const canonical = await canonicalPath(root);
    const filenames = (await readdir(this.directory)).filter(name => /^[a-f0-9]{32}\.json$/.test(name)).slice(0, 256);
    const entries = await Promise.all(filenames.map(async name => {
      try {
        const data = await readFile(path.join(this.directory, name));
        if (data.length > LIMIT) return undefined;
        const record = recordSchema.parse(JSON.parse(data.toString('utf8')));
        if (record.id + '.json' !== name || Date.now() - record.updatedAt > HEARTBEAT * 4 || windowMatch(record, canonical) < 0) return undefined;
        return record;
      } catch { return undefined; }
    }));
    return entries.filter((entry): entry is WindowRecord => !!entry).sort((a, b) => windowMatch(b, canonical) - windowMatch(a, canonical) || b.focusedAt - a.focusedAt || a.id.localeCompare(b.id));
  }
  static send(record: WindowRecord, request?: ProjectRequest, timeout = 20000): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port: record.port });
      let data = Buffer.alloc(0), settled = false;
      const finish = (error?: Error) => { if (settled) return; settled = true; socket.destroy(); if (error) reject(error); else resolve(); };
      socket.setTimeout(timeout, () => finish(new WindowTransportError('The project window did not respond.')));
      socket.once('error', () => finish(new WindowTransportError('The project window is unavailable.')));
      socket.once('close', () => { if (!settled) finish(new WindowTransportError('The project window closed before responding.')); });
      socket.once('connect', () => socket.write(JSON.stringify({ token: record.token, ...(request ? { request } : { ping: true }) }) + '\n'));
      socket.on('data', chunk => {
        data = Buffer.concat([data, chunk]);
        if (data.length > LIMIT) { finish(new WindowTransportError('Invalid project window response.')); return; }
        const end = data.indexOf(10);
        if (end < 0) return;
        try {
          const response = JSON.parse(data.subarray(0, end).toString('utf8'));
          if (response.ok === true) finish();
          else finish(new Error(typeof response.error === 'string' ? response.error : 'The project window rejected the request.'));
        } catch { finish(new WindowTransportError('Invalid project window response.')); }
      });
    });
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    for (const socket of this.sockets) socket.destroy();
    if (this.server.listening) await new Promise<void>(resolve => this.server.close(() => resolve()));
    await this.writes.catch(() => {});
    await Promise.all(['.json', '.json.tmp'].map(suffix => rm(path.join(this.directory, this.record.id + suffix), { force: true })));
  }
  dispose(): void { void this.close().catch(error => this.log(String(error))); }
}
