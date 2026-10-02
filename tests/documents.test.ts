import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GitService } from '../src/git/service';
import { GitDocuments } from '../src/editor/documents';

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
afterEach(async () => { for (const root of roots.splice(0)) { if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('alwaygit-preview-')) throw new Error('Unsafe cleanup target'); await rm(root, { recursive: true, force: true, maxRetries: 5 }); } });

describe('Bounded Git Diff previews', () => {
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

  it('bounds large files by bytes and lines and reports binary content without exposing text', async () => {
    const { root, repo, documents } = await setup();
    await writeFile(path.join(root, 'base.txt'), 'base'); await commit(root, 'initial');
    await writeFile(path.join(root, 'large.txt'), 'x'.repeat(300000));
    const large = await documents.preview(repo, { kind: 'change', path: 'large.txt', area: 'unstaged' });
    expect(large.truncated).toBe(true); expect(Buffer.byteLength(large.right)).toBe(256 * 1024);
    await writeFile(path.join(root, 'lines.txt'), 'line\n'.repeat(5000));
    const lines = await documents.preview(repo, { kind: 'change', path: 'lines.txt', area: 'unstaged' });
    expect(lines.truncated).toBe(true); expect(lines.right.split('\n')).toHaveLength(4000);
    await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 255, 1]));
    expect(await documents.preview(repo, { kind: 'change', path: 'binary.bin', area: 'unstaged' })).toMatchObject({ binary: true, left: '', right: '' });
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
