import { afterEach, describe, expect, it } from 'vitest';
import { chmod, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CommitSelection } from '../src/protocol/types';
import { commitFile, git, gitFixtures } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-selected-commit-');
afterEach(() => fixtures.cleanup());

describe('selected file commits', () => {
  it.each(['staged', 'unstaged', 'both'] as const)('commits the %s version and preserves unrelated staged hunks and disk content', async area => {
    const {root,repo,service} = await fixtures.setup();
    await commitFile(root,'chosen.txt','base\n');
    await commitFile(root,'other.txt','other base\n');
    await writeFile(path.join(root,'chosen.txt'),'staged\n');
    await writeFile(path.join(root,'other.txt'),'other staged\n');
    await git(root,'add','.');
    await writeFile(path.join(root,'chosen.txt'),'latest working\n');
    await writeFile(path.join(root,'other.txt'),'other working\n');
    const snapshot = await service.snapshot(repo);
    const files: CommitSelection[] = area === 'both' ? [{path:'chosen.txt',area:'staged'},{path:'chosen.txt',area:'unstaged'}] : [{path:'chosen.txt',area}];
    await service.execute(repo,{type:'commit',message:'selected',files,expectedHead:snapshot.head,expectedBranch:snapshot.branch});
    expect(await git(root,'show','HEAD:chosen.txt')).toBe(area === 'staged' ? 'staged' : 'latest working');
    expect(await git(root,'show','HEAD:other.txt')).toBe('other base');
    expect(await git(root,'show',':other.txt')).toBe('other staged');
    expect(await readFile(path.join(root,'other.txt'),'utf8')).toBe('other working\n');
    expect(await readFile(path.join(root,'chosen.txt'),'utf8')).toBe('latest working\n');
    expect(await git(root,'diff','--cached','--name-only')).toBe('other.txt');
    expect(await readdir(repo.commonDir)).not.toContain('index.lock');
  });

  it('includes rename sources and deletions while keeping unselected changes', async () => {
    const {root,repo,service} = await fixtures.setup();
    for (const name of ['old.txt','deleted.txt','other.txt']) await commitFile(root,name,`${name}\n`);
    await rename(path.join(root,'old.txt'),path.join(root,'new.txt'));
    await rm(path.join(root,'deleted.txt'));
    await writeFile(path.join(root,'other.txt'),'other staged\n');
    await git(root,'add','-A');
    await writeFile(path.join(root,'new.txt'),'new working\n');
    const snapshot = await service.snapshot(repo);
    await service.execute(repo,{type:'commit',message:'rename and delete',files:[{path:'new.txt',area:'staged'},{path:'deleted.txt',area:'staged'}],expectedHead:snapshot.head,expectedBranch:snapshot.branch});
    expect(await git(root,'ls-tree','--name-only','HEAD')).toBe('new.txt\nother.txt');
    expect(await git(root,'show','HEAD:new.txt')).toBe('old.txt');
    expect(await git(root,'diff','--cached','--name-only')).toBe('other.txt');
    expect(await readFile(path.join(root,'new.txt'),'utf8')).toBe('new working\n');
  });

  it('supports unborn repositories and literal file names', async () => {
    const {root,repo,service} = await fixtures.setup();
    for (const name of ['[chosen].txt','other.txt']) await writeFile(path.join(root,name),name);
    await git(root,'add','other.txt');
    await service.execute(repo,{type:'commit',message:'initial selected',files:[{path:'[chosen].txt',area:'unstaged'}],expectedHead:'',expectedBranch:'main'});
    expect(await git(root,'ls-tree','--name-only','HEAD')).toBe('[chosen].txt');
    expect(await git(root,'diff','--cached','--name-only')).toBe('other.txt');
  });

  it('commits latest renamed content and unstaged deletion together', async () => {
    const {root,repo,service} = await fixtures.setup();
    await commitFile(root,'old.txt','base'); await commitFile(root,'deleted.txt','base');
    await git(root,'mv','old.txt','new.txt');
    await writeFile(path.join(root,'new.txt'),'latest'); await rm(path.join(root,'deleted.txt'));
    const snapshot = await service.snapshot(repo);
    await service.execute(repo,{type:'commit',message:'latest rename',files:[{path:'new.txt',area:'unstaged'},{path:'deleted.txt',area:'unstaged'}],expectedHead:snapshot.head,expectedBranch:snapshot.branch});
    expect(await git(root,'ls-tree','--name-only','HEAD')).toBe('new.txt');
    expect(await git(root,'show','HEAD:new.txt')).toBe('latest');
    expect(await git(root,'status','--porcelain')).toBe('');
  });

  it('allows a message-only amend without committing unchecked staged content', async () => {
    const {root,repo,service} = await fixtures.setup();
    await commitFile(root,'chosen.txt','base');
    await writeFile(path.join(root,'chosen.txt'),'staged'); await git(root,'add','.');
    const snapshot = await service.snapshot(repo), oldTree = await git(root,'rev-parse','HEAD^{tree}');
    await service.execute(repo,{type:'commit',message:'new message',amend:true,files:[],expectedHead:snapshot.head,expectedBranch:snapshot.branch});
    expect(await git(root,'rev-parse','HEAD^{tree}')).toBe(oldTree);
    expect(await git(root,'log','-1','--format=%s')).toBe('new message');
    expect(await git(root,'show',':chosen.txt')).toBe('staged');
  });

  it('keeps the original index byte for byte when a hook rejects a working version', async () => {
    const {root,repo,service} = await fixtures.setup();
    await commitFile(root,'chosen.txt','base');
    await writeFile(path.join(root,'chosen.txt'),'staged'); await git(root,'add','.');
    await writeFile(path.join(root,'chosen.txt'),'working');
    const hook = path.join(repo.commonDir,'hooks','pre-commit');
    await writeFile(hook,'#!/bin/sh\necho rejected >&2\nexit 1\n'); await chmod(hook,0o755);
    const snapshot = await service.snapshot(repo), index = await readFile(path.join(repo.commonDir,'index'));
    await expect(service.execute(repo,{type:'commit',message:'rejected',files:[{path:'chosen.txt',area:'unstaged'}],expectedHead:snapshot.head,expectedBranch:snapshot.branch})).rejects.toThrow('rejected');
    expect(await git(root,'rev-parse','HEAD')).toBe(snapshot.head);
    expect(await readFile(path.join(repo.commonDir,'index'))).toEqual(index);
    expect(await readFile(path.join(root,'chosen.txt'),'utf8')).toBe('working');
    expect((await readdir(repo.commonDir)).filter(name => name.includes('alwaygit-') || name === 'index.lock')).toEqual([]);
  });

  it('rejects a stale HEAD and an externally locked index without modifying content', async () => {
    const {root,repo,service} = await fixtures.setup();
    await commitFile(root,'chosen.txt','base');
    await writeFile(path.join(root,'chosen.txt'),'working');
    const snapshot = await service.snapshot(repo), action = {type:'commit' as const,message:'selected',files:[{path:'chosen.txt',area:'unstaged' as const}],expectedHead:snapshot.head,expectedBranch:snapshot.branch};
    await expect(service.execute(repo,{...action,expectedHead:'a'.repeat(40)})).rejects.toMatchObject({code:'OPERATION_CHANGED'});
    await writeFile(path.join(repo.commonDir,'index.lock'),'external');
    await expect(service.execute(repo,action)).rejects.toMatchObject({code:'INDEX_LOCKED'});
    expect(await readFile(path.join(repo.commonDir,'index.lock'),'utf8')).toBe('external');
    expect(await git(root,'rev-parse','HEAD')).toBe(snapshot.head);
  });

  it('uses the linked worktree index and preserves split-index staged entries', async () => {
    const {root,service} = await fixtures.setup();
    await commitFile(root,'chosen.txt','base'); await commitFile(root,'other.txt','other');
    const worktree = path.join(root,'linked'); await git(root,'worktree','add','-b','linked',worktree);
    const repo = await service.discover(worktree);
    await writeFile(path.join(worktree,'other.txt'),'staged other'); await git(worktree,'add','other.txt');
    await git(worktree,'update-index','--split-index');
    await writeFile(path.join(worktree,'chosen.txt'),'working');
    const snapshot = await service.snapshot(repo);
    await service.execute(repo,{type:'commit',message:'worktree selected',files:[{path:'chosen.txt',area:'unstaged'}],expectedHead:snapshot.head,expectedBranch:snapshot.branch});
    expect(await git(worktree,'show','HEAD:chosen.txt')).toBe('working');
    expect(await git(worktree,'show',':other.txt')).toBe('staged other');
    expect(await git(root,'show','HEAD:chosen.txt')).toBe('base');
    expect(await git(root,'status','--porcelain')).toBe('?? linked/');
  });
});
