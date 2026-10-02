import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, utimes, writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { transformSync } from 'esbuild';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RepositoryOperationBusyError, RepositoryOperationLock } from '../src/application/operation-lock';

const roots: string[] = [], locks: RepositoryOperationLock[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  await Promise.all(children.splice(0).map(async child => { if (child.exitCode !== null || child.signalCode !== null) return; const exited = once(child, 'exit'); child.kill(); await exited; }));
  await Promise.all(locks.splice(0).map(lock => lock.close()));
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('alwaygit-lock-test-')) throw new Error('Unsafe test cleanup target');
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), 'alwaygit-lock-test-')); roots.push(root); return root; }

describe('cross-window repository operation lock', () => {
  it('serializes the same repository and releases it for the next window', async () => {
    const root = await fixture(), first = new RepositoryOperationLock(path.join(root, 'locks'), 'first'), second = new RepositoryOperationLock(path.join(root, 'locks'), 'second');
    locks.push(first, second);
    const lease = await first.acquire(path.join(root, 'repo'), 'commit');
    await expect(second.acquire(path.join(root, 'repo'), 'pull')).rejects.toBeInstanceOf(RepositoryOperationBusyError);
    await lease.release();
    await (await second.acquire(path.join(root, 'repo'), 'pull')).release();
  });
  it('does not block operations for different repositories', async () => {
    const root = await fixture(), first = new RepositoryOperationLock(path.join(root, 'locks'), 'first'), second = new RepositoryOperationLock(path.join(root, 'locks'), 'second');
    locks.push(first, second);
    const a = await first.acquire(path.join(root, 'a'), 'commit'), b = await second.acquire(path.join(root, 'b'), 'commit');
    await Promise.all([a.release(), b.release()]);
  });
  it('recovers an abandoned stale lease', async () => {
    const root = await fixture(), directory = path.join(root, 'locks'), lock = new RepositoryOperationLock(directory, 'next'); locks.push(lock);
    await mkdir(directory, { recursive: true });
    const crypto = await import('node:crypto'), repo = path.join(root, 'repo'), normalized = process.platform === 'win32' ? path.resolve(repo).toLowerCase() : path.resolve(repo);
    const filename = path.join(directory, crypto.createHash('sha256').update(normalized).digest('hex') + '.lock');
    await writeFile(filename, JSON.stringify({ owner: 'crashed', token: 'old' }));
    const old = new Date(Date.now() - 120_000); await utimes(filename, old, old);
    await (await lock.acquire(repo, 'commit')).release();
  });
  it('does not replace a live owner even when its registry timestamp is old', async () => {
    const root = await fixture(), directory = path.join(root, 'locks'), repo = path.join(root, 'repo');
    const first = new RepositoryOperationLock(directory, 'first'), second = new RepositoryOperationLock(directory, 'second'); locks.push(first, second);
    const lease = await first.acquire(repo, 'commit');
    const filename = path.join(directory, (await readdir(directory))[0]);
    const old = new Date(Date.now() - 120_000); await utimes(filename, old, old);
    await expect(second.acquire(repo, 'pull')).rejects.toBeInstanceOf(RepositoryOperationBusyError);
    expect(await second.isBusy(repo)).toBe(true);
    await lease.release();
    expect(await second.isBusy(repo)).toBe(false);
  });
  it('allows exactly one contender to recover a crashed process lease', async () => {
    const root = await fixture(), directory = path.join(root, 'locks'), repo = path.join(root, 'repo');
    const source = await readFile(new URL('../src/application/operation-lock.ts', import.meta.url), 'utf8');
    const compiled = transformSync(source, { loader: 'ts', format: 'esm', target: 'node20' }).code;
    const child = spawn(process.execPath, ['--input-type=module', '-e', compiled + '\nconst lock = new RepositoryOperationLock(process.argv[1], "child"); await lock.acquire(process.argv[2], "commit"); console.log("ready"); setInterval(() => {}, 1000);', directory, repo], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      child.stdout!.once('data', () => resolve()); child.once('error', reject);
      child.once('exit', code => reject(new Error(`Lease fixture exited before readiness: ${code}`)));
    });
    const contender = new RepositoryOperationLock(directory, 'parent'); locks.push(contender);
    await expect(contender.acquire(repo, 'pull')).rejects.toBeInstanceOf(RepositoryOperationBusyError);
    const exited = once(child, 'exit'); child.kill(); await exited;
    const contenders = Array.from({ length: 8 }, (_, index) => new RepositoryOperationLock(directory, `contender-${index}`)); locks.push(...contenders);
    const results = await Promise.allSettled(contenders.map(lock => lock.acquire(repo, 'pull')));
    const winners = results.filter(result => result.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected').every(result => result.reason instanceof RepositoryOperationBusyError)).toBe(true);
    await (winners[0] as PromiseFulfilledResult<Awaited<ReturnType<RepositoryOperationLock['acquire']>>>).value.release();
    await (await contender.acquire(repo, 'commit')).release();
  });
});
