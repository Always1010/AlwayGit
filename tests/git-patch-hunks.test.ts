import { afterEach, expect, it, vi } from 'vitest';
import { readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { commitFile, git, gitFixtures } from './support/git-fixture';
import type { PatchHunks } from '../src/protocol/diff';
import { actionSchema } from '../src/protocol/validation';
import { GitService } from '../src/git/service';
import { GitDocuments } from '../src/editor/documents';
vi.mock('vscode', () => ({}));
const fixtures = gitFixtures('alwaygit-patch-hunks-');
afterEach(() => { vi.useRealTimers(); return fixtures.cleanup(); });
const base = Array.from({ length: 35 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
function edit(value: string, line: number, text: string): string { const lines = value.split('\n'); lines[line - 1] = text; return lines.join('\n'); }
function action(metadata: PatchHunks, index = 0, type: 'stage-hunk' | 'unstage-hunk' | 'discard-hunk' = 'stage-hunk') {
  expect(metadata.unavailable).toBeUndefined(); expect(metadata.token).toBeTruthy(); expect(metadata.hunks[index]).toBeDefined();
  return { type, token: metadata.token!, hunkId: metadata.hunks[index].id };
}
it('stages one of two real Git hunks and commits only selected staged content', async () => {
  const { root, service, repo } = await fixtures.setup();
  await commitFile(root, 'file.txt', base); await commitFile(root, 'other.txt', 'other base\n');
  await git(root, 'config', 'diff.interHunkContext', '100');
  await writeFile(path.join(root, 'other.txt'), 'unrelated staged\n'); await git(root, 'add', 'other.txt');
  const working = edit(edit(base, 2, 'first change'), 30, 'last change'); await writeFile(path.join(root, 'file.txt'), working);
  const docs = new GitDocuments(service), preview = await docs.indexedPreview(repo, { kind: 'change', area: 'unstaged', path: 'file.txt' });
  expect(preview.kind).toBe('text'); if (preview.kind !== 'text') throw new Error('text expected');
  expect(preview.patchHunks?.hunks).toHaveLength(2); expect(preview.index?.token).toBeTruthy();
  await service.execute(repo, action(preview.patchHunks!));
  expect(await git(root, 'show', ':file.txt')).toBe(edit(base, 2, 'first change').trim());
  expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe(working);
  expect(await git(root, 'show', ':other.txt')).toBe('unrelated staged');
  const snapshot = await service.snapshot(repo);
  await service.execute(repo, { type: 'commit', message: 'selected staged hunk', files: [{ path: 'file.txt', area: 'staged' }], expectedHead: snapshot.head, expectedBranch: snapshot.branch });
  expect(await git(root, 'show', 'HEAD:file.txt')).toBe(edit(base, 2, 'first change').trim());
  expect(await git(root, 'show', 'HEAD:other.txt')).toBe('other base');
  expect(await git(root, 'show', ':other.txt')).toBe('unrelated staged');
  expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe(working);
});
it('unstages one hunk from a partially staged file while preserving other index and working changes', async () => {
  const { root, service, repo } = await fixtures.setup(); await commitFile(root, 'file.txt', base);
  const staged = edit(edit(base, 2, 'staged first'), 30, 'staged last'); await writeFile(path.join(root, 'file.txt'), staged); await git(root, 'add', 'file.txt');
  const working = edit(staged, 17, 'unstaged middle'); await writeFile(path.join(root, 'file.txt'), working);
  const preview = await service.patchHunks(repo, { path: 'file.txt', area: 'staged' }); expect(preview.metadata.hunks).toHaveLength(2);
  await service.execute(repo, action(preview.metadata, 0, 'unstage-hunk'));
  expect(await git(root, 'show', ':file.txt')).toBe(edit(base, 30, 'staged last').trim());
  expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe(working);
  const unstaged = await service.patchHunks(repo, { path: 'file.txt', area: 'unstaged' });
  expect(unstaged.metadata.hunks).toHaveLength(2);
  await service.execute(repo, action(unstaged.metadata, 1));
  expect(await git(root, 'show', ':file.txt')).toBe(edit(edit(base, 17, 'unstaged middle'), 30, 'staged last').trim());
  expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe(working);
});
it('isolates nearby visual blocks and preserves offsets when staging and unstaging an insertion', async () => {
  const { root, service, repo } = await fixtures.setup(); await commitFile(root, 'file.txt', base);
  const inserted = base.replace('line 10\n', 'line 10\ninserted line\n');
  const working = inserted.replace('line 14\n', 'nearby change\n').replace('line 30\n', 'distant change\n');
  await writeFile(path.join(root, 'file.txt'), working);
  let preview = await service.patchHunks(repo, { path: 'file.txt', area: 'unstaged' });
  expect(preview.metadata.hunks).toHaveLength(3);
  expect(preview.metadata.hunks[0]).toMatchObject({ beforeStart: 10, beforeCount: 0, afterStart: 11, afterCount: 1 });
  await service.execute(repo, action(preview.metadata, 1));
  expect(await git(root, 'show', ':file.txt')).toBe(base.replace('line 14\n', 'nearby change\n').trim());
  preview = await service.patchHunks(repo, { path: 'file.txt', area: 'unstaged' });
  await service.execute(repo, action(preview.metadata));
  expect(await git(root, 'show', ':file.txt')).toBe(inserted.replace('line 14\n', 'nearby change\n').trim());
  const staged = await service.patchHunks(repo, { path: 'file.txt', area: 'staged' });
  expect(staged.metadata.hunks).toHaveLength(2);
  await service.execute(repo, action(staged.metadata, 0, 'unstage-hunk'));
  expect(await git(root, 'show', ':file.txt')).toBe(base.replace('line 14\n', 'nearby change\n').trim());
  expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe(working);
});
it.each(['working', 'index', 'head'] as const)('rejects a stale preview after %s changes without changing the index', async kind => {
  const { root, service, repo } = await fixtures.setup(); await commitFile(root, 'file.txt', base);
  await writeFile(path.join(root, 'file.txt'), edit(base, 2, 'new first'));
  const preview = await service.patchHunks(repo, { path: 'file.txt', area: 'unstaged' });
  if (kind === 'working') await writeFile(path.join(root, 'file.txt'), edit(base, 2, 'newer first'));
  if (kind === 'index') { await writeFile(path.join(root, 'other.txt'), 'unrelated'); await git(root, 'add', 'other.txt'); }
  if (kind === 'head') await git(root, 'commit', '--allow-empty', '-m', 'new HEAD');
  const index = await readFile(path.join(root, '.git', 'index')), bytes = await readFile(path.join(root, 'file.txt'));
  await expect(service.execute(repo, action(preview.metadata))).rejects.toMatchObject({ code: 'PATCH_CHANGED' });
  expect(await readFile(path.join(root, '.git', 'index'))).toEqual(index); expect(await readFile(path.join(root, 'file.txt'))).toEqual(bytes);
  expect((await readdir(path.join(root, '.git'))).filter(name => name.includes('alwaygit-') || name === 'index.lock')).toEqual([]);
});
it('rejects working changes during the isolated Git trial before publishing the real Index', async () => {
  const { root, repo } = await fixtures.setup(); await commitFile(root, 'file.txt', base);
  await writeFile(path.join(root, 'file.txt'), edit(base, 2, 'previewed'));
  let mutate = false;
  const service = new GitService({ environment: async (_repo, args) => {
    if (mutate && args[0] === 'apply' && args.includes('--check')) { mutate = false; await writeFile(path.join(root, 'file.txt'), edit(base, 2, 'external edit')); }
    return {};
  } });
  const preview = await service.patchHunks(repo, { path: 'file.txt', area: 'unstaged' }), index = await readFile(path.join(root, '.git', 'index'));
  mutate = true;
  await expect(service.execute(repo, action(preview.metadata))).rejects.toMatchObject({ code: 'PATCH_CHANGED' });
  expect(await readFile(path.join(root, '.git', 'index'))).toEqual(index);
  expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe(edit(base, 2, 'external edit'));
});
it('keeps immutable history and comparison Diff read-only', async () => {
  const { root, repo, service } = await fixtures.setup(); const first = await commitFile(root, 'file.txt', base);
  const second = await commitFile(root, 'file.txt', edit(base, 2, 'committed'));
  const docs = new GitDocuments(service);
  const history = await docs.indexedPreview(repo, { kind: 'commit', oid: second, path: 'file.txt' });
  const comparison = await docs.indexedPreview(repo, { kind: 'comparison', left: first, right: second, path: 'file.txt' });
  expect(history.kind).toBe('text'); expect(comparison.kind).toBe('text');
  expect(history).not.toHaveProperty('patchHunks'); expect(comparison).not.toHaveProperty('patchHunks');
});
it('rejects forged, cross-repository and expired context IDs and obeys an external index lock', async () => {
  const first = await fixtures.setup(), second = await fixtures.setup();
  await commitFile(first.root, 'file.txt', base); await writeFile(path.join(first.root, 'file.txt'), edit(base, 2, 'change'));
  const preview = await first.service.patchHunks(first.repo, { path: 'file.txt', area: 'unstaged' }), request = action(preview.metadata);
  await expect(first.service.execute(first.repo, { ...request, hunkId: randomUUID() })).rejects.toMatchObject({ code: 'PATCH_CHANGED' });
  await expect(first.service.execute(second.repo, request)).rejects.toMatchObject({ code: 'PATCH_CHANGED' });
  await writeFile(path.join(first.root, '.git', 'index.lock'), 'external lock');
  await expect(first.service.execute(first.repo, request)).rejects.toMatchObject({ code: 'INDEX_LOCKED' });
  expect(await readFile(path.join(first.root, '.git', 'index.lock'), 'utf8')).toBe('external lock'); await rm(path.join(first.root, '.git', 'index.lock'));
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 6 * 60_000);
  await expect(first.service.execute(first.repo, request)).rejects.toMatchObject({ code: 'PATCH_CHANGED' });
});
it.each(['crlf', 'no-final-newline', 'literal-unicode'] as const)('preserves exact disk bytes for %s while staging and reversing a hunk', async kind => {
  const { root, service, repo } = await fixtures.setup();
  const name = kind === 'literal-unicode' ? '中文 [*] "quoted"\tfile.txt' : 'file.txt';
  const initial = kind === 'crlf' ? base.replaceAll('\n', '\r\n') : kind === 'no-final-newline' ? base.trimEnd() : base;
  if (kind === 'crlf') await git(root, 'config', 'core.autocrlf', 'true');
  await commitFile(root, name, initial);
  const changed = initial.replace('line 2', 'changed 2'); await writeFile(path.join(root, name), changed); const bytes = await readFile(path.join(root, name));
  let preview = await service.patchHunks(repo, { path: name, area: 'unstaged' }); await service.execute(repo, action(preview.metadata));
  expect(await readFile(path.join(root, name))).toEqual(bytes);
  preview = await service.patchHunks(repo, { path: name, area: 'staged' }); await service.execute(repo, action(preview.metadata, 0, 'unstage-hunk'));
  expect(await readFile(path.join(root, name))).toEqual(bytes); expect(await git(root, 'diff', '--cached', '--', name)).toBe('');
});
it.each(['new', 'deleted', 'unborn'] as const)('supports ordinary %s UTF-8 files in both directions', async kind => {
  const { root, service, repo } = await fixtures.setup(); if (kind !== 'unborn') await commitFile(root, 'base.txt', 'base');
  if (kind === 'deleted') { await commitFile(root, 'file.txt', 'content without newline'); await rm(path.join(root, 'file.txt')); }
  else await writeFile(path.join(root, 'file.txt'), 'content without newline');
  const before = await service.patchHunks(repo, { path: 'file.txt', area: 'unstaged' }); await service.execute(repo, action(before.metadata));
  const staged = await service.patchHunks(repo, { path: 'file.txt', area: 'staged' }); await service.execute(repo, action(staged.metadata, 0, 'unstage-hunk'));
  expect(await git(root, 'diff', '--cached')).toBe('');
  if (kind !== 'deleted') expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('content without newline');
  else await expect(readFile(path.join(root, 'file.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('disables binary, symlink, rename, custom-filter and oversized file hunk actions', async () => {
  const { root, service, repo } = await fixtures.setup(); await commitFile(root, 'file.txt', base);
  const target = { path: 'file.txt', area: 'unstaged' as const };
  await writeFile(path.join(root, 'file.txt'), Buffer.from([0, 1, 2])); expect((await service.patchHunks(repo, target)).metadata.unavailable).toBe('unsupported');
  await rm(path.join(root, 'file.txt')); await symlink('base.txt', path.join(root, 'file.txt')); expect((await service.patchHunks(repo, target)).metadata.unavailable).toBe('unsupported');
  await rm(path.join(root, 'file.txt')); await writeFile(path.join(root, 'file.txt'), 'changed');
  await writeFile(path.join(root, '.gitattributes'), 'file.txt filter=custom\n'); expect((await service.patchHunks(repo, target)).metadata.unavailable).toBe('unsupported');
  await rm(path.join(root, '.gitattributes'));
  await writeFile(path.join(root, 'intent.txt'), 'intent to add'); await git(root, 'add', '--intent-to-add', 'intent.txt');
  expect((await service.patchHunks(repo, { path: 'intent.txt', area: 'unstaged' })).metadata.unavailable).toBe('unsupported');
  await writeFile(path.join(root, 'file.txt'), 'a'.repeat(2 * 1024 * 1024 + 1)); expect((await service.patchHunks(repo, target)).metadata.unavailable).toBe('unsupported');
  await git(root, 'restore', '--', 'file.txt'); await git(root, 'mv', 'file.txt', 'renamed.txt');
  expect((await service.patchHunks(repo, { path: 'renamed.txt', area: 'staged' })).metadata.unavailable).toBe('unsupported');
});
it('validates only host-issued opaque context and hunk IDs, rejecting arbitrary patch content', () => {
  expect(actionSchema.safeParse({ type: 'stage-hunk', token: randomUUID(), hunkId: randomUUID() }).success).toBe(true);
  expect(actionSchema.safeParse({ type: 'stage-hunk', token: randomUUID(), hunkId: randomUUID(), patch: 'untrusted' }).success).toBe(false);
  expect(actionSchema.safeParse({ type: 'unstage-hunk', token: 'invalid', hunkId: randomUUID() }).success).toBe(false);
  expect(actionSchema.safeParse({ type: 'discard-hunk', token: randomUUID(), hunkId: randomUUID() }).success).toBe(true);
  expect(actionSchema.safeParse({ type: 'discard-hunk', token: randomUUID(), hunkId: randomUUID(), path: 'forged.txt' }).success).toBe(false);
  for (const type of ['stage-lines', 'unstage-lines']) expect(actionSchema.safeParse({ type, token: randomUUID(), lineIds: [randomUUID()] }).success).toBe(false);
});
it('discards only one nearby block from a partially staged file and preserves the exact Index', async () => {
  const { root, service, repo } = await fixtures.setup(); await commitFile(root, 'file.txt', base);
  const staged = edit(base, 2, 'already staged');
  await writeFile(path.join(root, 'file.txt'), staged); await git(root, 'add', 'file.txt');
  const working = edit(edit(staged, 10, 'keep nearby'), 14, 'discard selected');
  await writeFile(path.join(root, 'file.txt'), working);
  const index = await readFile(path.join(root, '.git', 'index'));
  const preview = await service.patchHunks(repo, { path: 'file.txt', area: 'unstaged' });
  expect(preview.metadata.hunks).toHaveLength(2);
  await service.execute(repo, action(preview.metadata, 1, 'discard-hunk'));
  expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe(edit(staged, 10, 'keep nearby'));
  expect(await readFile(path.join(root, '.git', 'index'))).toEqual(index);
  expect((await readdir(root)).filter(name => name.startsWith('.alwaygit-hunk-'))).toEqual([]);
  expect((await readdir(path.join(root, '.git'))).filter(name => name.includes('alwaygit-') || name === 'index.lock')).toEqual([]);
});
it.each(['crlf', 'mixed', 'no-final-newline'] as const)('discards a block without rewriting unrelated %s bytes', async kind => {
  const { root, service, repo } = await fixtures.setup();
  if (kind !== 'no-final-newline') await git(root, 'config', 'core.autocrlf', 'true');
  const initial = kind === 'no-final-newline' ? base.trimEnd() : base.replaceAll('\n', '\r\n');
  await commitFile(root, 'file.txt', initial);
  let working = edit(edit(initial, 2, 'discard this'), 30, 'keep this');
  if (kind === 'mixed') working = working.replace('keep this\r\n', 'keep this\n');
  await writeFile(path.join(root, 'file.txt'), working);
  const index = await readFile(path.join(root, '.git', 'index'));
  const preview = await service.patchHunks(repo, { path: 'file.txt', area: 'unstaged' });
  await service.execute(repo, action(preview.metadata, 0, 'discard-hunk'));
  expect(await readFile(path.join(root, 'file.txt'))).toEqual(Buffer.from(working.replace('discard this', 'line 2')));
  expect(await readFile(path.join(root, '.git', 'index'))).toEqual(index);
});
it.each(['inserted', 'deleted'] as const)('discards an %s block with shifted later changes', async kind => {
  const { root, service, repo } = await fixtures.setup(); await commitFile(root, 'file.txt', base);
  const changed = kind === 'inserted' ? base.replace('line 10\n', 'line 10\nextra line\n') : base.replace('line 10\n', '');
  await writeFile(path.join(root, 'file.txt'), changed.replace('line 14\n', 'keep later\n'));
  const preview = await service.patchHunks(repo, { path: 'file.txt', area: 'unstaged' });
  expect(preview.metadata.hunks).toHaveLength(2);
  await service.execute(repo, action(preview.metadata, 0, 'discard-hunk'));
  expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe(base.replace('line 14\n', 'keep later\n'));
  expect(await git(root, 'diff', '--cached')).toBe('');
});
it.each(['new', 'deleted', 'unborn'] as const)('discards an ordinary %s file block without changing the Index', async kind => {
  const { root, service, repo } = await fixtures.setup();
  if (kind !== 'unborn') await commitFile(root, 'file.txt', 'index content without newline');
  if (kind === 'deleted') await rm(path.join(root, 'file.txt'));
  else await writeFile(path.join(root, 'new.txt'), 'new content without newline');
  const filename = kind === 'deleted' ? 'file.txt' : 'new.txt';
  const preview = await service.patchHunks(repo, { path: filename, area: 'unstaged' });
  await service.execute(repo, action(preview.metadata, 0, 'discard-hunk'));
  if (kind === 'deleted') expect(await readFile(path.join(root, filename), 'utf8')).toBe('index content without newline');
  else await expect(readFile(path.join(root, filename))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await git(root, 'diff', '--cached')).toBe('');
});
it('rejects stale or staged discard contexts and preserves an external edit during the trial', async () => {
  const { root, repo } = await fixtures.setup(); await commitFile(root, 'file.txt', base);
  let mutate = false;
  const service = new GitService({ environment: async (_repo, args) => {
    if (mutate && args[0] === 'apply' && args.includes('--check')) { mutate = false; await writeFile(path.join(root, 'file.txt'), edit(base, 2, 'external edit')); }
    return {};
  } });
  await writeFile(path.join(root, 'file.txt'), edit(base, 2, 'previewed'));
  let preview = await service.patchHunks(repo, { path: 'file.txt', area: 'unstaged' });
  const index = await readFile(path.join(root, '.git', 'index'));
  mutate = true;
  await expect(service.execute(repo, action(preview.metadata, 0, 'discard-hunk'))).rejects.toMatchObject({ code: 'PATCH_CHANGED' });
  expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe(edit(base, 2, 'external edit'));
  expect(await readFile(path.join(root, '.git', 'index'))).toEqual(index);
  expect((await readdir(root)).filter(name => name.startsWith('.alwaygit-hunk-'))).toEqual([]);
  await git(root, 'add', 'file.txt');
  preview = await service.patchHunks(repo, { path: 'file.txt', area: 'staged' });
  await expect(service.execute(repo, action(preview.metadata, 0, 'discard-hunk'))).rejects.toMatchObject({ code: 'PATCH_CHANGED' });
});
