import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as runner from '../src/git/runner';
import { BlobCache } from '../src/git/blob-cache';
import { commitFile, git, gitFixtures } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-content-cache-');
afterEach(async () => {
  vi.restoreAllMocks();
  await fixtures.cleanup();
});

describe('Immutable Git content cache', () => {
  it('reuses complete blobs for bounded reads without retaining prefixes or exposing cache bytes', async () => {
    const { root, repo, service } = await fixtures.setup();
    const content = 'a'.repeat(1024 * 1024);
    const revision = await commitFile(root, 'file.txt', content);
    const source = { kind: 'revision' as const, revision, path: 'file.txt' };
    const process = vi.spyOn(runner, 'runGitProcess');
    const reads = () =>
      process.mock.calls.filter(
        ([options]) => options.args.includes('cat-file') && options.args.includes('blob'),
      ).length;
    expect((await service.content(repo, source, 1024)).length).toBe(1024);
    const full = await service.content(repo, source);
    expect(full.toString()).toBe(content);
    full.fill(0);
    const prefix = await service.content(repo, source, 2048);
    expect(prefix.toString()).toBe(content.slice(0, 2048));
    prefix.fill(0);
    expect((await service.content(repo, source)).toString()).toBe(content);
    expect(reads()).toBe(2);
  });

  it('rechecks moving revisions, Index entries and blob replacements before reusing content', async () => {
    const { root, repo, service } = await fixtures.setup();
    const revision = await commitFile(root, 'file.txt', 'original');
    const oldBlob = await git(root, 'rev-parse', 'HEAD:file.txt');
    const original = { kind: 'revision' as const, revision, path: 'file.txt' };
    expect((await service.content(repo, original)).toString()).toBe('original');
    await writeFile(path.join(root, 'file.txt'), 'new content');
    await git(root, 'add', 'file.txt');
    expect((await service.content(repo, { kind: 'index', path: 'file.txt' })).toString()).toBe(
      'new content',
    );
    await git(root, 'commit', '-m', 'new');
    const newBlob = await git(root, 'rev-parse', 'HEAD:file.txt');
    expect((await service.content(repo, { ...original, revision: 'HEAD' })).toString()).toBe(
      'new content',
    );
    await git(root, 'replace', oldBlob, newBlob);
    expect((await service.content(repo, original)).toString()).toBe('new content');
    await git(root, 'replace', '-d', oldBlob);
    expect((await service.content(repo, original)).toString()).toBe('original');
  });

  it('evicts by total bytes and entry count and declines oversized blobs', () => {
    const cache = new BlobCache(6, 2);
    cache.remember('a', Buffer.from('aaa'));
    cache.remember('b', Buffer.from('bbb'));
    expect(cache.get('a')?.toString()).toBe('aaa');
    cache.remember('c', Buffer.from('ccc'));
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')?.toString()).toBe('aaa');
    cache.remember('large', Buffer.alloc(7));
    expect(cache.get('large')).toBeUndefined();
    expect(cache.get('c')?.toString()).toBe('ccc');
    cache.remember('d', Buffer.alloc(0));
    expect(cache.get('a')).toBeUndefined();
  });
});
