import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type * as vscode from 'vscode';
import type { Commit, ContentSource, GitServiceContract, Repository } from '../src/protocol/types';
import type { LfsHistoricalObject } from '../src/protocol/lfs';
import { GitDocuments } from '../src/editor/documents';

const editor = vi.hoisted(() => ({ execute: vi.fn(), show: vi.fn() }));
vi.mock('vscode', () => ({
  Uri: {
    file: (fsPath: string) => ({ scheme: 'file', fsPath, toString: () => `file:${fsPath}` }),
    from: (parts: { scheme: string; path: string; query: string }) => ({ ...parts, toString: () => `${parts.scheme}:${parts.path}?${parts.query}` }),
  }, ViewColumn: { Active: 1 }, commands: { executeCommand: editor.execute }, window: { showTextDocument: editor.show },
}));
const revision = 'a'.repeat(40), previous = 'b'.repeat(40);
const repo: Repository = { id: 'lfs-preview', root: '/fixture', commonDir: '/fixture/.git', name: 'Fixture' };
const commit = (oid: string): Commit => ({ oid, parents: oid === revision ? [previous] : [], author: 'Fixture', email: 'fixture@example.com', subject: 'LFS fixture', timestamp: 0 });
const roots: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('alwaygit-lfs-preview-')) throw new Error('Unsafe cleanup target');
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});
function pointer(bytes: Buffer, size = bytes.length) {
  const oid = createHash('sha256').update(bytes).digest('hex');
  return { oid, size, bytes: Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`) };
}
function fixture(bytes: Buffer, localObject: LfsHistoricalObject['localObject'] = 'available', declaredSize = bytes.length) {
  const object = pointer(bytes, declaredSize);
  const content = vi.fn(async (_repo: Repository, source: ContentSource, maxBytes: number = Infinity) => source.kind === 'empty' ? Buffer.alloc(0) : object.bytes.subarray(0, maxBytes));
  const cached = vi.fn(async (_repo: Repository, request: { revision: string; path: string }, maxBytes: number = 0): Promise<LfsHistoricalObject> => ({ ...request, oid: object.oid, size: object.size, localObject,
    ...(localObject === 'available' && object.size <= maxBytes ? { content: bytes } : {}) }));
  const execute = vi.fn(async () => undefined);
  const service = { content, lfsHistoricalObject: cached, execute,
    details: async (_repo: Repository, oid: string) => ({ commit: commit(oid), parent: previous, body: '', files: [{ path: 'asset', status: 'M' }] }),
    compare: async () => ({ left: commit(previous), right: commit(revision), files: [{ path: 'asset', status: 'M' }] }),
  } satisfies Partial<GitServiceContract>;
  return { object, content, cached, execute, service, documents: new GitDocuments(service as unknown as GitServiceContract) };
}

it('resolves cached historical text once, including complete content beyond the initial prefix, without executing a download', async () => {
  const bytes = Buffer.from('verified historical content\n'.repeat(14000)), test = fixture(bytes);
  const preview = await test.documents.revisionPreview(repo, { revision, path: 'asset' });
  expect(preview).toMatchObject({ kind: 'text', left: '', right: bytes.toString('utf8'), lfs: [{ side: 'right', oid: test.object.oid, size: bytes.length, localObject: 'available', resolved: true }] });
  expect(test.cached).toHaveBeenCalledExactlyOnceWith(repo, { revision, path: 'asset' }, 32 * 1024 * 1024);
  expect(test.content.mock.calls.filter(([, source]) => source.kind === 'revision')).toHaveLength(1);
  expect(test.execute).not.toHaveBeenCalled();
});

it('classifies cached PNG bytes as an image and preserves the existing image limit', async () => {
  const png = Buffer.alloc(32); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.write('IHDR', 12); png.writeUInt32BE(2, 16); png.writeUInt32BE(3, 20);
  const small = fixture(png), preview = await small.documents.revisionPreview(repo, { revision, path: 'asset' });
  expect(preview).toMatchObject({ kind: 'image', right: { mimeType: 'image/png', width: 2, height: 3, byteLength: 32 }, lfs: [{ resolved: true }] });
  const large = fixture(Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]));
  expect(await large.documents.revisionPreview(repo, { revision, path: 'asset' })).toMatchObject({ kind: 'binary', reason: 'image-too-large', lfs: [{ resolved: true }] });
  expect(large.cached).toHaveBeenCalledTimes(1); expect(large.execute).not.toHaveBeenCalled();
});

it.each(['missing', 'unknown'] as const)('shows a complete-comparison placeholder for %s local objects without exposing pointer text', async state => {
  const test = fixture(Buffer.from('real object'), state);
  const preview = await test.documents.preview(repo, { kind: 'comparison', left: previous, right: revision, path: 'asset' });
  expect(preview).toMatchObject({ kind: 'binary', reason: state === 'missing' ? 'lfs-missing' : 'lfs-unavailable', lfs: [{ side: 'left', resolved: false }, { side: 'right', resolved: false }] });
  expect(preview).not.toHaveProperty('left'); expect(preview).not.toHaveProperty('right');
  expect(test.execute).not.toHaveBeenCalled();
});

it('checks oversized pointer metadata without requesting its bytes and tolerates a host without cache support', async () => {
  const test = fixture(Buffer.from('oversized'), 'available', 32 * 1024 * 1024 + 1);
  expect(await test.documents.revisionPreview(repo, { revision, path: 'asset' })).toMatchObject({ kind: 'binary', reason: 'lfs-too-large', lfs: [{ size: 32 * 1024 * 1024 + 1, resolved: false }] });
  expect(test.cached).toHaveBeenCalledExactlyOnceWith(repo, { revision, path: 'asset' }, 0);
  const oldHost = new GitDocuments({ content: fixture(Buffer.from('small')).content } as unknown as GitServiceContract);
  expect(await oldHost.revisionPreview(repo, { revision, path: 'asset' })).toMatchObject({ kind: 'binary', reason: 'lfs-unavailable', lfs: [{ downloadable: false }] });
});

it('re-reads the identical historical target after an explicit cache fill instead of retaining a missing-object result', async () => {
  const bytes = Buffer.from('downloaded historical text\n'), test = fixture(bytes, 'missing'), target = { revision, path: 'asset' };
  expect(await test.documents.revisionPreview(repo, target)).toMatchObject({ kind: 'binary', reason: 'lfs-missing' });
  test.cached.mockImplementation(async (_repo, request) => ({ ...request, oid: test.object.oid, size: bytes.length, localObject: 'available', content: bytes }));
  expect(await test.documents.revisionPreview(repo, target)).toMatchObject({ kind: 'text', right: bytes.toString('utf8'), lfs: [{ revision, path: 'asset', resolved: true }] });
  expect(test.cached.mock.calls.map(([, request]) => request)).toEqual([target, target]);
  expect(test.execute).not.toHaveBeenCalled();
});

it('keeps ordinary blobs and pointer-shaped symbolic-link targets as ordinary immutable text', async () => {
  const test = fixture(Buffer.from('object'));
  test.content.mockImplementation(async (_repo, source) => source.kind === 'empty' ? Buffer.alloc(0) : Buffer.from('ordinary text'));
  expect(await test.documents.revisionPreview(repo, { revision, path: 'asset' })).toMatchObject({ kind: 'text', right: 'ordinary text' });
  expect(test.cached).not.toHaveBeenCalled();
  test.content.mockImplementation(async (_repo, source) => source.kind === 'empty' ? Buffer.alloc(0) : test.object.bytes);
  test.cached.mockRejectedValue(Object.assign(new Error('Not a regular file'), { code: 'INVALID_PATH' }));
  const link = await test.documents.revisionPreview(repo, { revision, path: 'link' });
  expect(link).toMatchObject({ kind: 'text', right: test.object.bytes.toString('utf8') }); expect(link.lfs).toBeUndefined();
});

it('resolves both commit/parent sources and uses resolved immutable text in native Diff while retaining the real working-file URI', async () => {
  const test = fixture(Buffer.from('resolved cache text\n'));
  const historical = await test.documents.preview(repo, { kind: 'commit', oid: revision, path: 'asset' });
  expect(historical).toMatchObject({ kind: 'text', left: 'resolved cache text\n', right: 'resolved cache text\n', lfs: [{ side: 'left', revision: previous }, { side: 'right', revision }] });
  const root = path.resolve(await mkdtemp(path.join(os.tmpdir(), 'alwaygit-lfs-preview-'))); roots.push(root);
  await writeFile(path.join(root, 'asset'), 'unsaved-on-disk comparison\n');
  const localRepo = { ...repo, root, commonDir: path.join(root, '.git') };
  await test.documents.diff(localRepo, { kind: 'revision', revision, path: 'asset' });
  const [command, left, right] = editor.execute.mock.calls.at(-1)!;
  expect(command).toBe('vscode.diff');
  expect(right).toMatchObject({ scheme: 'file', fsPath: path.join(root, 'asset') });
  const calls = test.content.mock.calls.length;
  expect(await test.documents.provideTextDocumentContent(left as vscode.Uri)).toBe('resolved cache text\n');
  expect(test.content.mock.calls).toHaveLength(calls);
  await test.documents.openRevision(localRepo, { revision, path: 'asset' });
  expect(await test.documents.provideTextDocumentContent(editor.show.mock.calls.at(-1)![0] as vscode.Uri)).toBe('resolved cache text\n');
  expect(test.execute).not.toHaveBeenCalled();
});
