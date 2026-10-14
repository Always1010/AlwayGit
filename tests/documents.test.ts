import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readlink, symlink, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GitService } from '../src/git/service';
import { GitDocuments } from '../src/editor/documents';
import type { DiffPreview, DiffTarget } from '../src/protocol/types';

// Preview is a host operation with no editor UI dependency. Native editor calls
// are verified separately in tests/extension/runner.ts against real VS Code.
vi.mock('vscode', () => ({}));
const exec = promisify(execFile);
const roots: string[] = [];
const git = async (root: string, ...args: string[]) => (await exec('git', ['-C', root, ...args], { windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' } })).stdout.trim();
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-preview-')); roots.push(root);
  await git(root, 'init', '-b', 'main'); await git(root, 'config', 'user.name', 'Preview'); await git(root, 'config', 'user.email', 'preview@example.com'); await git(root, 'config', 'commit.gpgsign', 'false');
  const service = new GitService(); const repo = await service.discover(root);
  return { root, service, repo, documents: new GitDocuments(service) };
}
async function commit(root: string, message: string) { await git(root, 'add', '-A'); await git(root, 'commit', '-m', message); return git(root, 'rev-parse', 'HEAD'); }
function textPreview(preview: DiffPreview): Extract<DiffPreview, { kind: 'text' }> { expect(preview.kind).toBe('text'); if (preview.kind !== 'text') throw new Error(`Expected text preview, received ${preview.kind}`); return preview; }
function png(width: number, height: number, bytes = 32): Buffer { const value=Buffer.alloc(Math.max(24,bytes));Buffer.from([137,80,78,71,13,10,26,10]).copy(value);value.write('IHDR',12,'ascii');value.writeUInt32BE(width,16);value.writeUInt32BE(height,20);return value; }
function jpeg(width:number,height:number):Buffer { const value=Buffer.alloc(32);Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x11,0x08]).copy(value);value.writeUInt16BE(height,7);value.writeUInt16BE(width,9);return value; }
function webp(width:number,height:number):Buffer { const value=Buffer.alloc(30);value.write('RIFF',0,'ascii');value.writeUInt32LE(22,4);value.write('WEBPVP8X',8,'ascii');value.writeUIntLE(width-1,24,3);value.writeUIntLE(height-1,27,3);return value; }
afterEach(async () => { for (const root of roots.splice(0)) { if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('alwaygit-preview-')) throw new Error('Unsafe cleanup target'); await rm(root, { recursive: true, force: true, maxRetries: 5 }); } });

describe('Complete Git Diff previews', () => {
  it('compares symbolic-link target text without reading an external target', async () => {
    const { root, repo } = await setup();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-preview-')); roots.push(outside);
    await writeFile(path.join(outside, 'private.txt'), 'must not be read');
    const leaf = path.join(root, 'link');
    await symlink(outside, leaf, process.platform === 'win32' ? 'junction' : 'dir');
    const service = { snapshot: async () => ({ changes: [{ path: 'link', indexStatus: ' ', worktreeStatus: 'M', untracked: false }] }), content: async () => Buffer.from('old-target') };
    const preview = textPreview(await new GitDocuments(service as never).preview(repo, { kind: 'change', path: 'link', area: 'unstaged' }));
    expect(preview.left).toBe('old-target');
    expect(preview.right).toBe(await readlink(leaf));
    expect(preview.rightLabel).toContain('Symbolic Link');
    await expect(new GitDocuments(service as never).openFile(repo, 'link/private.txt')).rejects.toThrow('outside');
  });

  it('reads HEAD, Index and Working Tree independently when one file has both kinds of changes', async () => {
    const { root, service, repo, documents } = await setup();
    await writeFile(path.join(root, 'a.txt'), 'committed'); await commit(root, 'initial');
    await writeFile(path.join(root, 'a.txt'), 'staged'); await service.execute(repo, { type: 'stage', paths: ['a.txt'] });
    await writeFile(path.join(root, 'a.txt'), 'unstaged');
    expect(await documents.preview(repo, { kind: 'change', path: 'a.txt', area: 'staged' })).toMatchObject({ leftLabel: 'HEAD', rightLabel: 'Index', left: 'committed', right: 'staged' });
    expect(await documents.preview(repo, { kind: 'change', path: 'a.txt', area: 'unstaged' })).toMatchObject({ leftLabel: 'Index', rightLabel: 'Working Tree', left: 'staged', right: 'unstaged' });
  });

  it('uses Git rename metadata and represents added/deleted historical sides as empty', async () => {
    const { root, repo, documents } = await setup();
    await writeFile(path.join(root, 'old [1].txt'), 'before'); const initial = await commit(root, 'initial');
    expect(await documents.preview(repo, { kind: 'commit', oid: initial, path: 'old [1].txt' })).toMatchObject({ left: '', right: 'before' });
    await rename(path.join(root, 'old [1].txt'), path.join(root, 'new [1].txt')); const renamed = await commit(root, 'rename');
    expect(await documents.preview(repo, { kind: 'commit', oid: renamed, path: 'new [1].txt', previousPath: '../outside.txt' })).toMatchObject({ left: 'before', right: 'before' });
    await rm(path.join(root, 'new [1].txt')); const deleted = await commit(root, 'delete');
    expect(await documents.preview(repo, { kind: 'commit', oid: deleted, path: 'new [1].txt' })).toMatchObject({ left: 'before', right: '' });
    await expect(documents.preview(repo, { kind: 'commit', oid: deleted, path: '../outside.txt' })).rejects.toThrow('not part');
  });

  it('previews a renamed file between any two commits',async()=>{
    const {root,repo,documents}=await setup();await writeFile(path.join(root,'before.txt'),'common\nleft');const left=await commit(root,'left');await rename(path.join(root,'before.txt'),path.join(root,'after.txt'));await writeFile(path.join(root,'after.txt'),'common\nright');const right=await commit(root,'right');
    expect(await documents.preview(repo,{kind:'comparison',left,right,path:'after.txt'})).toMatchObject({leftLabel:left.slice(0,8),rightLabel:right.slice(0,8),left:'common\nleft',right:'common\nright'});
  });

  it('compares a saved untracked file with the existing working copy',async()=>{
    const {root,repo,service,documents}=await setup();
    await writeFile(path.join(root,'base.txt'),'base');await commit(root,'initial');
    await writeFile(path.join(root,'notes.txt'),'saved notes');await service.execute(repo,{type:'stash.create',message:'pause notes',includeUntracked:true});
    const stash=(await service.snapshot(repo)).stashes[0];await service.execute(repo,{type:'stash.apply',selector:stash.selector,expectedOid:stash.oid});await writeFile(path.join(root,'notes.txt'),'continued notes');
    expect(await documents.preview(repo,{kind:'stash-working',stashOid:stash.oid,path:'notes.txt'})).toMatchObject({leftLabel:'Stash',rightLabel:'Working Tree',left:'saved notes',right:'continued notes'});
    await expect(documents.preview(repo,{kind:'stash-working',stashOid:stash.oid,path:'outside.txt'})).rejects.toThrow('not part');
  });

  it('compares saved tracked working content independently from its saved Index content',async()=>{
    const {root,repo,service,documents}=await setup();
    await writeFile(path.join(root,'both.txt'),'base');await writeFile(path.join(root,'index-only.txt'),'base');await commit(root,'initial');
    await writeFile(path.join(root,'both.txt'),'saved Index');await writeFile(path.join(root,'index-only.txt'),'saved staged file');await git(root,'add','-A');
    await writeFile(path.join(root,'both.txt'),'saved Working Tree');
    await service.execute(repo,{type:'stash.create',message:'tracked state'});const stash=(await service.snapshot(repo)).stashes[0];
    await writeFile(path.join(root,'both.txt'),'current working file');await writeFile(path.join(root,'index-only.txt'),'current staged-file working copy');
    expect(await documents.preview(repo,{kind:'stash-working',stashOid:stash.oid,path:'both.txt'})).toMatchObject({left:'saved Working Tree',right:'current working file'});
    expect(await documents.preview(repo,{kind:'stash-working',stashOid:stash.oid,path:'index-only.txt'})).toMatchObject({left:'saved staged file',right:'current staged-file working copy'});
  });

  it('represents saved and current deletions as empty sides in Stash comparisons',async()=>{
    const {root,repo,service,documents}=await setup();
    await writeFile(path.join(root,'deleted.txt'),'base');await writeFile(path.join(root,'missing.txt'),'base');await commit(root,'initial');
    await rm(path.join(root,'deleted.txt'));await writeFile(path.join(root,'missing.txt'),'saved content');
    await service.execute(repo,{type:'stash.create'});const stash=(await service.snapshot(repo)).stashes[0];
    await writeFile(path.join(root,'deleted.txt'),'current content');await rm(path.join(root,'missing.txt'));
    expect(await documents.preview(repo,{kind:'stash-working',stashOid:stash.oid,path:'deleted.txt'})).toMatchObject({left:'',right:'current content'});
    expect(await documents.preview(repo,{kind:'stash-working',stashOid:stash.oid,path:'missing.txt'})).toMatchObject({left:'saved content',right:''});
  });

  it('reads complete text beyond the former byte and line limits and rejects binary content', async () => {
    const { root, repo, documents } = await setup();
    await writeFile(path.join(root, 'base.txt'), 'base'); await commit(root, 'initial');
    await writeFile(path.join(root, 'large.txt'), 'x'.repeat(300000));
    const large = textPreview(await documents.preview(repo, { kind: 'change', path: 'large.txt', area: 'unstaged' }));
    expect(large.truncated).toBeUndefined(); expect(Buffer.byteLength(large.right)).toBe(300000);
    await writeFile(path.join(root, 'lines.txt'), 'line\n'.repeat(5000));
    const lines = textPreview(await documents.preview(repo, { kind: 'change', path: 'lines.txt', area: 'unstaged' }));
    expect(lines.truncated).toBeUndefined(); expect(lines.right.split('\n')).toHaveLength(5001);
    await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 255, 1]));
    expect(await documents.preview(repo, { kind: 'change', path: 'binary.bin', area: 'unstaged' })).toMatchObject({ kind: 'binary', reason: 'unsupported' });
  });

  it('preserves historical and staged modifications after line 100000 and byte 256 KiB', async () => {
    const { root, repo, service, documents } = await setup();
    const before = 'unchanged context\n'.repeat(100000) + 'before\n';
    const after = 'unchanged context\n'.repeat(100000) + 'after\n';
    await writeFile(path.join(root, 'tail.txt'), before); await commit(root, 'initial');
    await writeFile(path.join(root, 'tail.txt'), after);
    const working = textPreview(await documents.preview(repo, { kind: 'change', path: 'tail.txt', area: 'unstaged' }));
    expect(working.left).toBe(before); expect(working.right).toBe(after);
    await service.execute(repo, { type: 'stage', paths: ['tail.txt'] });
    const staged = textPreview(await documents.preview(repo, { kind: 'change', path: 'tail.txt', area: 'staged' }));
    expect(staged.left).toBe(before); expect(staged.right).toBe(after);
    const oid = await commit(root, 'tail change');
    const historical = textPreview(await documents.preview(repo, { kind: 'commit', oid, path: 'tail.txt' }));
    expect(historical.left).toBe(before); expect(historical.right).toBe(after);
    const indexed = textPreview(await documents.indexedPreview(repo, { kind: 'commit', oid, path: 'tail.txt' }));
    expect(indexed.left).toBe(''); expect(indexed.right).toBe('');
    expect(indexed.index).toMatchObject({ rowCount: 100002, changes: [{ start: 100000, end: 100000 }], summary: { added: 0, modified: 1, removed: 0 } });
    const page = documents.diffPage(repo, indexed.index!.token, 99999, 3);
    expect(page.rows).toEqual([
      { changed: false, before: 'unchanged context', after: 'unchanged context', beforeLine: 100000, afterLine: 100000 },
      { changed: true, before: 'before', after: 'after', beforeLine: 100001, afterLine: 100001 },
      { changed: false, before: '', after: '', beforeLine: 100002, afterLine: 100002 },
    ]);
    await expect(documents.indexedPreview(repo, { kind: 'commit', oid, path: 'tail.txt' }, false)).resolves.toMatchObject({ index: { token: '', summary: { modified: 1 } } });
    expect(() => documents.diffPage({ ...repo, id: 'other' }, indexed.index!.token, 0, 1)).toThrow('expired');
    documents.releaseDiff(repo, indexed.index!.token);
    expect(() => documents.diffPage(repo, indexed.index!.token, 0, 1)).toThrow('expired');
  });

  it('pages an immutable working snapshot with additions, removals and a final newline change', async () => {
    const { root, repo, documents } = await setup();
    const before = 'first\nremove\ncontext\nlast\n', after = 'insert\nfirst\ncontext\nlast';
    await writeFile(path.join(root, 'mixed.txt'), before); await commit(root, 'initial');
    await writeFile(path.join(root, 'mixed.txt'), after);
    const owner = {}, preview = textPreview(await documents.indexedPreview(repo, { kind: 'change', path: 'mixed.txt', area: 'unstaged' }, true, owner));
    const first = documents.diffPage(repo, preview.index!.token, 0, 2), rest = documents.diffPage(repo, preview.index!.token, 2, 512);
    await writeFile(path.join(root, 'mixed.txt'), 'new working content');
    expect(documents.diffPage(repo, preview.index!.token, 0, 2)).toEqual(first);
    const rows = [...first.rows, ...rest.rows];
    expect(rows.filter(row => row.before !== undefined).map(row => row.before).join('\n')).toBe(before);
    expect(rows.filter(row => row.after !== undefined).map(row => row.after).join('\n')).toBe(after);
    expect(preview.index!.summary).toEqual({ added: 1, modified: 1, removed: 1 });
    documents.releaseDiffOwner(owner);
    expect(() => documents.diffPage(repo, preview.index!.token, 0, 1)).toThrow('expired');
  });

  it.each([false, true])('keeps unchanged displayed content and its page token across polls (untracked: %s)', async untracked => {
    const { root, repo, service, documents } = await setup(), owner = {}, otherOwner = {};
    const filename = path.join(root, 'selected.txt'), target: DiffTarget = { kind: 'change', path: 'selected.txt', area: 'unstaged' };
    if (!untracked) { await writeFile(filename, 'original'); await commit(root, 'initial'); }
    await writeFile(filename, 'changed one');
    const hunks = vi.spyOn(service, 'textDiffHunks');
    const initial = textPreview(await documents.indexedPreview(repo, target, true, owner));
    const page = documents.diffPage(repo, initial.index!.token, 0, 128);
    await writeFile(filename, 'changed one'); // Metadata changed, displayed bytes did not.
    await writeFile(path.join(root, 'unrelated.txt'), 'other file');
    await expect(documents.changedWorkingPreview(repo, owner, await service.snapshot(repo))).resolves.toBeUndefined();
    expect(textPreview(await documents.indexedPreview(repo, target, true, owner)).index!.token).toBe(initial.index!.token);
    expect(hunks).toHaveBeenCalledTimes(1);
    expect(documents.diffPage(repo, initial.index!.token, 0, 128)).toEqual(page);
    const isolated = textPreview(await documents.indexedPreview(repo, target, true, otherOwner));
    expect(isolated.index!.token).not.toBe(initial.index!.token);
    const oldStatus = (await service.snapshot(repo)).changes.find(change => change.path === target.path);
    await writeFile(filename, 'changed two'); // Same size and Git status, different bytes.
    const current = await service.snapshot(repo);
    expect(current.changes.find(change => change.path === target.path)).toEqual(oldStatus);
    await expect(documents.changedWorkingPreview(repo, owner, current)).resolves.toEqual(target);
    await expect(documents.changedWorkingPreview(repo, owner, current, 'unrelated.txt')).resolves.toBeUndefined();
    await documents.indexedPreview(repo, target, false, owner); // Summary navigation cannot replace the displayed baseline.
    await expect(documents.changedWorkingPreview(repo, owner, current)).resolves.toEqual(target);
    const updated = textPreview(await documents.indexedPreview(repo, target, true, owner));
    expect(updated.index!.token).not.toBe(initial.index!.token);
    await expect(documents.changedWorkingPreview(repo, owner, current)).resolves.toBeUndefined();
    expect(documents.diffPage(repo, initial.index!.token, 0, 128)).toEqual(page);
    documents.releaseDiffOwner(owner);
    await expect(documents.changedWorkingPreview(repo, owner, current)).resolves.toBeUndefined();
    expect(() => documents.diffPage(repo, updated.index!.token, 0, 1)).toThrow('expired');
    expect(documents.diffPage(repo, isolated.index!.token, 0, 128)).toEqual({ ...page, token: isolated.index!.token });
  });

  it('rechecks the actual staged comparison independently of Working Tree edits', async () => {
    const { root, repo, service, documents } = await setup(), owner = {};
    const filename = path.join(root, 'a.txt'), target: DiffTarget = { kind: 'change', path: 'a.txt', area: 'staged' };
    await writeFile(filename, 'committed'); await commit(root, 'initial');
    await writeFile(filename, 'staged one'); await git(root, 'add', 'a.txt');
    await documents.indexedPreview(repo, target, true, owner);
    await writeFile(filename, 'staged two');
    await expect(documents.changedWorkingPreview(repo, owner, await service.snapshot(repo))).resolves.toBeUndefined();
    await git(root, 'add', 'a.txt');
    await expect(documents.changedWorkingPreview(repo, owner, await service.snapshot(repo))).resolves.toEqual(target);
    await documents.indexedPreview(repo, target, true, owner);
    await expect(documents.changedWorkingPreview(repo, owner, await service.snapshot(repo))).resolves.toBeUndefined();
    await git(root, 'restore', '--staged', 'a.txt');
    await expect(documents.changedWorkingPreview(repo, owner, await service.snapshot(repo))).resolves.toEqual(target);
  });

  it('reports resource exhaustion instead of returning matching prefixes as a complete comparison', async () => {
    const { root, repo, documents } = await setup();
    await writeFile(path.join(root, 'too-large.txt'), 'x'.repeat(32 * 1024 * 1024 + 1));
    await expect(documents.preview(repo, { kind: 'change', path: 'too-large.txt', area: 'unstaged' })).rejects.toThrow('resource limit');
  });

  it('previews bounded PNG changes and blocks images from native VS Code editors', async () => {
    const { root, repo, documents } = await setup();
    await writeFile(path.join(root, 'image.png'), png(2, 3)); await commit(root, 'image');
    await writeFile(path.join(root, 'image.png'), png(4, 5, 64));
    const preview = await documents.preview(repo, { kind: 'change', path: 'image.png', area: 'unstaged' });
    expect(preview).toMatchObject({ kind: 'image', left: { mimeType: 'image/png', width: 2, height: 3, byteLength: 32 }, right: { mimeType: 'image/png', width: 4, height: 5, byteLength: 64 } });
    if (preview.kind !== 'image') throw new Error('Expected image preview');
    expect(Buffer.from(preview.right!.data, 'base64')).toEqual(png(4, 5, 64));
    await expect(documents.openFile(repo, 'image.png')).rejects.toThrow('only be viewed');
    await expect(documents.diff(repo, { kind: 'change', path: 'image.png', area: 'unstaged' })).rejects.toThrow('only be viewed');
    await writeFile(path.join(root, 'large.png'), png(1, 1, 4 * 1024 * 1024 + 1));
    expect(await documents.preview(repo, { kind: 'change', path: 'large.png', area: 'unstaged' })).toMatchObject({ kind: 'binary', reason: 'image-too-large' });
    await writeFile(path.join(root, 'wide.png'), png(10_000, 5_000));
    expect(await documents.preview(repo, { kind: 'change', path: 'wide.png', area: 'unstaged' })).toMatchObject({ kind: 'binary', reason: 'image-dimensions-too-large' });
  });

  it('recognizes JPEG and WebP by content instead of filename extension', async () => {
    const { root, repo, documents } = await setup();
    await writeFile(path.join(root, 'base.txt'), 'base'); await commit(root, 'initial');
    await writeFile(path.join(root, 'photo.data'), jpeg(320, 240));
    await writeFile(path.join(root, 'asset.bin'), webp(640, 360));
    expect(await documents.preview(repo, { kind: 'change', path: 'photo.data', area: 'unstaged' })).toMatchObject({ kind: 'image', left: undefined, right: { mimeType: 'image/jpeg', width: 320, height: 240 } });
    expect(await documents.preview(repo, { kind: 'change', path: 'asset.bin', area: 'unstaged' })).toMatchObject({ kind: 'image', left: undefined, right: { mimeType: 'image/webp', width: 640, height: 360 } });
  });

  it('compares a detected working rename against its original Index path', async () => {
    const { root, repo, documents } = await setup();
    await writeFile(path.join(root, 'old.txt'), 'contents'); await commit(root, 'initial');
    await rename(path.join(root, 'old.txt'), path.join(root, 'new.txt')); await git(root, 'add', '-N', '--', 'new.txt');
    expect(await documents.preview(repo, { kind: 'change', path: 'new.txt', area: 'unstaged' })).toMatchObject({ left: 'contents', right: 'contents' });
  });

  it('keeps staged content visible when that file is then renamed only in the Working Tree', async () => {
    const { root, repo, service, documents } = await setup();
    await writeFile(path.join(root, 'old.txt'), 'HEAD content'); await commit(root, 'initial');
    await writeFile(path.join(root, 'old.txt'), 'staged content'); await service.execute(repo, { type: 'stage', paths: ['old.txt'] });
    await rename(path.join(root, 'old.txt'), path.join(root, 'new.txt')); await git(root, 'add', '-N', '--', 'new.txt');
    expect(await documents.preview(repo, { kind: 'change', path: 'old.txt', area: 'staged' })).toMatchObject({ left: 'HEAD content', right: 'staged content' });
    expect(await documents.preview(repo, { kind: 'change', path: 'new.txt', area: 'unstaged' })).toMatchObject({ left: 'staged content', right: 'staged content' });
  });
});
