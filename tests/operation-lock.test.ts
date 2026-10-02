import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, utimes, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RepositoryOperationBusyError, RepositoryOperationLock } from '../src/application/operation-lock';

const roots: string[] = [], locks: RepositoryOperationLock[] = [];
afterEach(async () => {
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
});
