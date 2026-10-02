import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GitService, parseStatus, validateFilePath } from '../src/git/service';
import { commitFile as commit, git, gitFixtures } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-test-');
const setup = fixtures.setup;
afterEach(fixtures.cleanup);

describe('Git service integration', () => {
  it('adds a remote only after validating its name and URL',async()=>{
    const {service,repo}=await setup();
    await expect(service.execute(repo,{type:'remote.add',name:'bad name',url:'https://example.com/acme/repo.git'})).rejects.toThrow('without spaces');
    await expect(service.execute(repo,{type:'remote.add',name:'origin',url:' '})).rejects.toThrow('repository URL');
    await service.execute(repo,{type:'remote.add',name:'origin',url:'https://example.com/acme/repo.git'});
    expect((await service.snapshot(repo)).remotes).toEqual(['origin']);
    await expect(service.execute(repo,{type:'remote.add',name:'origin',url:'https://example.com/other.git'})).rejects.toThrow('already exists');
  });
  it('handles unborn status and binary index/revision content, literal pathspecs, and missing files', async () => {
    const { root, service, repo } = await setup();
    expect((await service.snapshot(repo)).head).toBeUndefined(); expect((await service.history(repo)).commits).toEqual([]);
    const bytes = Buffer.from([0, 255, 128, 10, 0, 1]); await writeFile(path.join(root, 'binary [1].bin'), bytes); await writeFile(path.join(root, 'binary 1.bin'), 'other');
    await service.execute(repo, { type: 'stage', paths: ['binary [1].bin'] }); expect(await service.content(repo, { kind: 'index', path: 'binary [1].bin' })).toEqual(bytes);
    expect((await service.snapshot(repo)).changes.find(x => x.path === 'binary 1.bin')?.untracked).toBe(true);
    await service.execute(repo, { type: 'unstage', paths: ['binary [1].bin'] }); expect(await service.content(repo, { kind: 'index', path: 'binary [1].bin' })).toEqual(Buffer.alloc(0));
    await service.execute(repo, { type: 'stage', paths: ['binary [1].bin'] }); await service.execute(repo, { type: 'commit', message: 'binary commit' });
    expect(await service.content(repo, { kind: 'revision', revision: 'HEAD', path: 'binary [1].bin' })).toEqual(bytes);
    expect(await service.content(repo, { kind: 'revision', revision: 'HEAD', path: 'missing.txt' })).toEqual(Buffer.alloc(0));
    await expect(service.content(repo, { kind: 'revision', revision: 'nonexistent-ref', path: 'missing.txt' })).rejects.toThrow();
    await rm(path.join(root, 'binary [1].bin')); await service.execute(repo, { type: 'stage', paths: ['binary [1].bin'] }); expect(await service.content(repo, { kind: 'index', path: 'binary [1].bin' })).toEqual(Buffer.alloc(0));
  });
  it('preserves rename paths and discards selected tracked and untracked files', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'old name.txt', 'original');
    await rename(path.join(root, 'old name.txt'), path.join(root, 'new name.txt')); await git(root, 'add', '-A');
    const change = (await service.snapshot(repo)).changes[0]; expect(change).toMatchObject({ path: 'new name.txt', originalPath: 'old name.txt', indexStatus: 'R' });
    await service.execute(repo, { type: 'commit', message: 'rename' }); expect((await service.details(repo, 'HEAD')).files[0]).toMatchObject({ path: 'new name.txt', previousPath: 'old name.txt' });
    await writeFile(path.join(root, 'new name.txt'), 'edited'); await writeFile(path.join(root, 'remove.txt'), 'discard'); await writeFile(path.join(root, 'keep.txt'), 'keep');
    await service.execute(repo, { type: 'discard', paths: ['new name.txt', 'remove.txt'] }); expect(await readFile(path.join(root, 'new name.txt'), 'utf8')).toBe('original'); expect(await readFile(path.join(root, 'keep.txt'), 'utf8')).toBe('keep'); await expect(readFile(path.join(root, 'remove.txt'))).rejects.toThrow();
  });
  it('unstages both paths of a staged rename while preserving the working rename', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'old [1].txt', 'original'); await commit(root, 'keep.txt', 'base');
    await rename(path.join(root, 'old [1].txt'), path.join(root, 'new [1].txt')); await git(root, 'add', '-A'); await writeFile(path.join(root, 'keep.txt'), 'staged'); await service.execute(repo, { type: 'stage', paths: ['keep.txt'] });
    expect((await service.snapshot(repo)).changes.find(change => change.path === 'new [1].txt')).toMatchObject({ indexStatus: 'R', originalPath: 'old [1].txt' });
    await service.execute(repo, { type: 'unstage', paths: ['new [1].txt'] });
    const changes = (await service.snapshot(repo)).changes;
    expect(changes.find(change => change.path === 'old [1].txt')).toMatchObject({ indexStatus: ' ', worktreeStatus: 'D' }); expect(changes.find(change => change.path === 'new [1].txt')).toMatchObject({ untracked: true }); expect(changes.find(change => change.path === 'keep.txt')).toMatchObject({ indexStatus: 'M', worktreeStatus: ' ' });
    expect((await service.content(repo, { kind: 'revision', revision: 'HEAD', path: 'old [1].txt' })).toString()).toBe('original'); expect((await service.content(repo, { kind: 'index', path: 'old [1].txt' })).toString()).toBe('original'); expect(await readFile(path.join(root, 'new [1].txt'), 'utf8')).toBe('original'); await expect(readFile(path.join(root, 'old [1].txt'))).rejects.toThrow();
  });
  it('discards a detected worktree rename while keeping staged content', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'old [1].txt', 'HEAD content'); await commit(root, 'neighbor.txt', 'base');
    await writeFile(path.join(root, '.git', 'info', 'exclude'), 'new*.txt\n'); await writeFile(path.join(root, 'old [1].txt'), 'staged content'); await service.execute(repo, { type: 'stage', paths: ['old [1].txt'] }); await rename(path.join(root, 'old [1].txt'), path.join(root, 'new [1].txt')); await git(root, 'add', '-N', '-f', '--', 'new [1].txt'); await writeFile(path.join(root, 'new 1.txt'), 'untouched');
    const renameChange = (await service.snapshot(repo)).changes.find(change => change.path === 'new [1].txt'); expect(renameChange).toMatchObject({ worktreeStatus: 'R', originalPath: 'old [1].txt' });
    await service.execute(repo, { type: 'discard', paths: ['new [1].txt'] });
    expect(await readFile(path.join(root, 'old [1].txt'), 'utf8')).toBe('staged content'); await expect(readFile(path.join(root, 'new [1].txt'))).rejects.toThrow(); expect(await readFile(path.join(root, 'new 1.txt'), 'utf8')).toBe('untouched');
    expect((await service.content(repo, { kind: 'index', path: 'old [1].txt' })).toString()).toBe('staged content'); expect((await service.content(repo, { kind: 'revision', revision: 'HEAD', path: 'old [1].txt' })).toString()).toBe('HEAD content'); expect((await service.snapshot(repo)).changes.find(change => change.path === 'old [1].txt')).toMatchObject({ indexStatus: 'M', worktreeStatus: ' ' });
  });
  it('stages both paths when selecting a detected worktree rename destination', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'old.txt', 'original'); await rename(path.join(root, 'old.txt'), path.join(root, 'new.txt')); await git(root, 'add', '-N', '--', 'new.txt');
    expect((await service.snapshot(repo)).changes.find(change => change.path === 'new.txt')).toMatchObject({ worktreeStatus: 'R', originalPath: 'old.txt' }); await service.execute(repo, { type: 'stage', paths: ['new.txt'] });
    expect((await service.snapshot(repo)).changes).toEqual([expect.objectContaining({ path: 'new.txt', indexStatus: 'R', worktreeStatus: ' ', originalPath: 'old.txt' })]); expect(await service.content(repo, { kind: 'index', path: 'old.txt' })).toEqual(Buffer.alloc(0)); expect((await service.content(repo, { kind: 'index', path: 'new.txt' })).toString()).toBe('original');
  });
  it('keeps history pagination fixed to captured tips as branches advance and selects merge parents', async () => {
    const { root, service, repo } = await setup(); const first = await commit(root, 'root.txt', 'one', 'root');
    await service.execute(repo, { type: 'branch.create', name: 'topic', checkout: true }); const side = await commit(root, 'side.txt', 'side', 'side');
    await service.execute(repo, { type: 'branch.checkout', name: 'main' }); const main = await commit(root, 'main.txt', 'main', 'main'); await service.execute(repo, await service.prepareAction(repo, { type: 'merge', target: 'topic' }));
    const merge = await git(root, 'rev-parse', 'HEAD'); const page = await service.history(repo, { limit: 2 }); expect(page.hasMore).toBe(true); expect(page.commits[0].oid).toBe(merge);
    await commit(root, 'later.txt', 'later', 'later'); const second = await service.history(repo, { limit: 2, offset: page.nextOffset, tips: page.tips }); const combined = [...page.commits, ...second.commits].map(x => x.oid); expect(new Set(combined).size).toBe(4); expect(combined).toContain(first); expect(second.hasMore).toBe(false);
    const detail = await service.details(repo, merge, side); expect(detail.parent).toBe(side); expect(detail.files.map(x => x.path)).toEqual(['main.txt']); await expect(service.details(repo, merge, first)).rejects.toThrow('not a parent');
    const mainDetail = await service.details(repo, merge, main); expect(mainDetail.files.map(x => x.path)).toEqual(['side.txt']);
  });
  it('returns the current HEAD summary when filters omit it from history', async () => {
    const { root, service, repo } = await setup(); const parent=await commit(root,'root.txt','root','root'); const head=await commit(root,'head.txt','head','current head');
    const page=await service.history(repo,{tips:[],search:'does not match',head:'HEAD'});
    expect(page.commits).toEqual([]);
    expect(page.head).toMatchObject({oid:head,parents:[parent],subject:'current head',pushed:false});
  });
  it('compares arbitrary commits and normalizes ancestor direction',async()=>{
    const {root,service,repo}=await setup();await writeFile(path.join(root,'old.txt'),'common\nbefore');const base=await commit(root,'old.txt','common\nbefore','base');
    await rename(path.join(root,'old.txt'),path.join(root,'new.txt'));await writeFile(path.join(root,'new.txt'),'common\nafter');await git(root,'add','-A');await git(root,'commit','-m','rename and edit');const latest=await git(root,'rev-parse','HEAD');
    const comparison=await service.compare(repo,latest,base);
    expect(comparison.left.oid).toBe(base);expect(comparison.right.oid).toBe(latest);expect(comparison.files).toEqual([{status:expect.stringMatching(/^R/),previousPath:'old.txt',path:'new.txt'}]);
    const reversed=await service.compare(repo,latest,base,true);expect(reversed.left.oid).toBe(latest);expect(reversed.right.oid).toBe(base);
  });
  it('describes Stash sections separately and counts unique saved files',async()=>{
    const {root,service,repo}=await setup();await commit(root,'tracked.txt','base');
    await writeFile(path.join(root,'tracked.txt'),'staged');await service.execute(repo,{type:'stage',paths:['tracked.txt']});await writeFile(path.join(root,'tracked.txt'),'working');await writeFile(path.join(root,'notes.txt'),'notes');
    await service.execute(repo,{type:'stash.create',message:'pause notes',includeUntracked:true});const stash=(await service.snapshot(repo)).stashes[0],details=await service.stashDetails(repo,stash.oid);
    expect(details.totalFiles).toBe(2);expect(details.commit.oid).toBe(stash.oid);
    expect(details.sections.working.files.map(file=>file.path)).toEqual(['tracked.txt']);expect(details.sections.index.files.map(file=>file.path)).toEqual(['tracked.txt']);expect(details.sections.untracked?.files.map(file=>file.path)).toEqual(['notes.txt']);
    expect((await service.snapshot(repo)).changes).toEqual([]);
  });
  it('reports conflicts, index stages, operation controls and aborts merge', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'same.txt', 'base'); await service.execute(repo, { type: 'branch.create', name: 'topic', checkout: true }); await commit(root, 'same.txt', 'topic'); await service.execute(repo, { type: 'branch.checkout', name: 'main' }); await commit(root, 'same.txt', 'main');
    await expect(service.execute(repo, await service.prepareAction(repo, { type: 'merge', target: 'topic' }))).rejects.toThrow(); const snap = await service.snapshot(repo); expect(snap.operation).toMatchObject({ kind: 'merge', conflicts: 1, canContinue: false, canAbort: true, canSkip: false }); expect(snap.changes[0].conflict).toBe(true);
    expect((await service.content(repo, { kind: 'index', path: 'same.txt', stage: 1 })).toString()).toBe('base'); expect((await service.content(repo, { kind: 'index', path: 'same.txt', stage: 2 })).toString()).toBe('main'); expect((await service.content(repo, { kind: 'index', path: 'same.txt', stage: 3 })).toString()).toBe('topic');
    await expect(service.execute(repo, { type: 'operation.continue', kind: 'merge' })).rejects.toThrow('Resolve conflicts'); await service.execute(repo, { type: 'operation.abort', kind: 'merge' }); expect((await service.snapshot(repo)).operation.kind).toBeUndefined();
  });
  it.each(['merge', 'rebase', 'cherry-pick', 'revert'] as const)('requires review of unedited staged conflict markers before %s completion', async kind => {
    const { root, service, repo } = await setup(); await commit(root, 'same.txt', 'base\n');
    await git(root, 'switch', '-c', 'topic'); const topic = await commit(root, 'same.txt', 'topic\n');
    await git(root, 'switch', 'main'); const originalHead = await commit(root, 'same.txt', 'main\n');
    await expect(service.execute(repo, await service.prepareAction(repo, kind==='cherry-pick'||kind==='revert'?{type:kind,commits:[topic]}:{type:kind,target:'topic'}))).rejects.toThrow();
    await expect(service.reviewOperation(repo)).rejects.toMatchObject({code:'CONFLICTS'});
    await service.execute(repo, { type:'resolve-and-stage', paths:['same.txt'] });
    expect((await service.snapshot(repo)).operation).toMatchObject({kind,conflicts:0,canContinue:true});
    await expect(service.execute(repo, {type:'operation.continue',kind})).rejects.toMatchObject({code:'REVIEW_REQUIRED'});
    await expect(service.execute(repo, {type:'commit',message:'bypass'})).rejects.toMatchObject({code:'REVIEW_REQUIRED'});
    const review=await service.reviewOperation(repo);
    expect(review.files).toContainEqual({path:'same.txt',lines:[1,3,5]});
    expect((await service.snapshot(repo)).head).toBe(kind==='rebase'?topic:originalHead);
    await expect(service.execute(repo, {type:'operation.continue',kind,reviewToken:'fabricated'})).rejects.toMatchObject({code:'REVIEW_REQUIRED'});
    // Literal markers are allowed only after explicitly accepting the inspected version.
    await service.execute(repo,{type:'operation.continue',kind,reviewToken:review.token});
    expect((await service.content(repo,{kind:'revision',revision:'HEAD',path:'same.txt'})).toString()).toContain('<<<<<<<');
    expect((await service.snapshot(repo)).operation.kind).toBeUndefined();
  });
  it('scans the index rather than the edited working file and rejects changed review content', async()=>{
    const {root,service,repo}=await setup();await commit(root,'same.txt','base\n');await git(root,'switch','-c','topic');await commit(root,'same.txt','topic\n');await git(root,'switch','main');await commit(root,'same.txt','main\n');
    await expect(service.execute(repo,await service.prepareAction(repo,{type:'merge',target:'topic'}))).rejects.toThrow();await service.execute(repo,{type:'resolve-and-stage',paths:['same.txt']});
    await expect(service.execute(repo,{type:'resolve-and-stage',paths:['same.txt']})).rejects.toMatchObject({code:'OPERATION_CHANGED'});
    await writeFile(path.join(root,'same.txt'),'topic-ready\n');const review=await service.reviewOperation(repo);
    expect(review.files[0].lines).toEqual([1,3,5]);
    await git(root,'add','--','same.txt');
    await expect(service.execute(repo,{type:'operation.continue',kind:'merge',reviewToken:review.token})).rejects.toMatchObject({code:'REVIEW_CHANGED'});
    const clean=await service.reviewOperation(repo);expect(clean.files).toEqual([{path:'same.txt',lines:[]}]);
    await service.execute(repo,{type:'commit',message:'Reviewed merge',reviewToken:clean.token});
    expect(await git(root,'show','HEAD:same.txt')).toBe('topic-ready');
    await expect(service.execute(repo,{type:'commit',message:'stale',reviewToken:clean.token})).rejects.toMatchObject({code:'OPERATION_CHANGED'});
  });
  it('reports partial markers, diff3 custom widths and unscanned files without claiming correctness',async()=>{
    const {root,service,repo}=await setup();await commit(root,'same.txt','base');await git(root,'switch','-c','topic');await commit(root,'same.txt','topic');await git(root,'switch','main');await commit(root,'same.txt','main');
    await expect(service.execute(repo,await service.prepareAction(repo,{type:'merge',target:'topic'}))).rejects.toThrow();
    await writeFile(path.join(root,'same.txt'),'<<<<<<< ours\r\n||||||||| base\r\n=========\r\n>>>>>>>>> theirs\r\nlegitimate text');
    await writeFile(path.join(root,'binary.bin'),Buffer.from([0,255,10]));await writeFile(path.join(root,'large.txt'),'x'.repeat(2*1024*1024+1));await writeFile(path.join(root,'encoded.txt'),Buffer.from([255,10]));
    await git(root,'add','--','same.txt','binary.bin','large.txt','encoded.txt');const review=await service.reviewOperation(repo);
    expect(review.files).toEqual(expect.arrayContaining([{path:'same.txt',lines:[1,2,3,4]},{path:'binary.bin',lines:[],skipped:'binary'},{path:'large.txt',lines:[],skipped:'large'},{path:'encoded.txt',lines:[],skipped:'encoding'}]));
    const original=(await service.snapshot(repo)).operation.originalHead;await service.execute(repo,{type:'operation.abort',kind:'merge'});
    expect(await git(root,'rev-parse','HEAD')).toBe(original);expect(await git(root,'status','--porcelain')).toBe('');
  });
  it('creates and checks out branches, then deletes the confirmed branch set', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'base.txt', 'base');
    await service.execute(repo, { type: 'branch.create', name: 'topic', checkout: true });
    expect((await service.snapshot(repo)).branch).toBe('topic');
    await service.execute(repo, { type: 'branch.checkout', name: 'main' });
    await service.execute(repo, { type: 'branch.create', name: 'topic-two' });
    const branches = await service.snapshot(repo);
    expect(branches.branch).toBe('main');
    const expectedOids = Object.fromEntries(branches.refs
      .filter(ref => ref.kind === 'local' && ['topic', 'topic-two'].includes(ref.name))
      .map(ref => [ref.name, ref.oid]));
    await service.execute(repo, { type: 'branch.delete', names: ['topic', 'topic-two'], force: true, expectedOids });
    expect((await service.snapshot(repo)).refs.filter(ref => ['topic', 'topic-two'].includes(ref.name))).toHaveLength(0);
  });

  it('creates an annotated Tag at HEAD and deletes it', async () => {
    const { root, service, repo } = await setup();
    const head = await commit(root, 'base.txt', 'base');
    await service.execute(repo, { type: 'tag.create', name: 'v1', message: 'release' });
    expect((await service.snapshot(repo)).refs.find(ref => ref.kind === 'tag' && ref.name === 'v1')?.oid).toBe(head);
    expect(await git(root, 'cat-file', '-t', 'refs/tags/v1')).toBe('tag');
    await service.execute(repo, { type: 'tag.delete', name: 'v1' });
    expect((await service.snapshot(repo)).refs.some(ref => ref.kind === 'tag' && ref.name === 'v1')).toBe(false);
  });

  it('applies a saved Stash and drops it only when explicitly requested', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'base.txt', 'base');
    await writeFile(path.join(root, 'base.txt'), 'stash');
    await service.execute(repo, { type: 'stash.create', message: 'saved' });
    const saved = (await service.snapshot(repo)).stashes;
    expect(saved).toHaveLength(1);
    await service.execute(repo, { type: 'stash.apply', selector: saved[0].selector });
    expect(await readFile(path.join(root, 'base.txt'), 'utf8')).toBe('stash');
    expect((await service.snapshot(repo)).stashes).toEqual(saved);
    await service.execute(repo, { type: 'stash.drop', selector: saved[0].selector });
    expect((await service.snapshot(repo)).stashes).toEqual([]);
  });

  it('rejects a stale Cherry-pick target and reverts a successful pick', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'base.txt', 'base');
    await git(root, 'switch', '-c', 'topic');
    const picked = await commit(root, 'picked.txt', 'pick');
    await git(root, 'switch', 'main');
    const head = await commit(root, 'main.txt', 'main');
    await expect(service.execute(repo, {
      type: 'cherry-pick', commits: [picked], expectedHead: '0'.repeat(40), expectedBranch: 'main',
    })).rejects.toThrow('target branch changed');
    expect(await git(root, 'rev-parse', 'HEAD')).toBe(head);
    await service.execute(repo, { type: 'cherry-pick', commits: [picked], expectedHead: head, expectedBranch: 'main' });
    expect(await readFile(path.join(root, 'picked.txt'), 'utf8')).toBe('pick');
    await service.execute(repo, { type: 'revert', commits: ['HEAD'] });
    await expect(readFile(path.join(root, 'picked.txt'))).rejects.toThrow();
    expect(await readFile(path.join(root, 'main.txt'), 'utf8')).toBe('main');
  });

  it('resets to the selected Commit and amends its message', async () => {
    const { root, service, repo } = await setup();
    const base = await commit(root, 'base.txt', 'base');
    await commit(root, 'later.txt', 'later');
    await service.execute(repo, await service.prepareAction(repo, { type: 'reset', mode: 'hard', target: base }));
    expect(await git(root, 'rev-parse', 'HEAD')).toBe(base);
    await expect(readFile(path.join(root, 'later.txt'))).rejects.toThrow();
    await service.execute(repo, { type: 'commit', message: 'amended base', amend: true });
    expect((await service.details(repo, 'HEAD')).commit.subject).toBe('amended base');
    expect(await readFile(path.join(root, 'base.txt'), 'utf8')).toBe('base');
  });

  it.each(['merge', 'rebase', 'reset'] as const)('rejects %s after the confirmed current branch changes', async type => {
    const { root, service, repo } = await setup();
    const target = await commit(root, 'base.txt', 'base');
    const head = await commit(root, 'base.txt', 'later');
    const action = await service.prepareAction(repo, type === 'reset' ? { type, target, mode: 'hard' } : { type, target });
    await git(root, 'switch', '-c', 'other');
    await writeFile(path.join(root, 'base.txt'), 'other staged content');
    await git(root, 'add', '--', 'base.txt');
    const index = await git(root, 'ls-files', '--stage');
    await expect(service.execute(repo, action)).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
    expect(await git(root, 'symbolic-ref', '--short', 'HEAD')).toBe('other');
    expect(await git(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(await git(root, 'ls-files', '--stage')).toBe(index);
    expect(await readFile(path.join(root, 'base.txt'), 'utf8')).toBe('other staged content');
  });

  it('pins a prepared Reset target and rejects a newer current HEAD before execution', async () => {
    const { root, service, repo } = await setup();
    const target = await commit(root, 'base.txt', 'base');
    await git(root, 'branch', 'selected-target', target);
    const head = await commit(root, 'later.txt', 'later');
    const action = await service.prepareAction(repo, { type: 'reset', target: 'selected-target', mode: 'soft' });
    expect(action).toMatchObject({ target, expectedHead: head, expectedBranch: 'main' });
    await git(root, 'branch', '-f', 'selected-target', head);
    await service.execute(repo, action);
    expect(await git(root, 'rev-parse', 'HEAD')).toBe(target);
    const stale = await service.prepareAction(repo, { type: 'reset', target: head, mode: 'hard' });
    await git(root, 'reset', '--mixed', head);
    await expect(service.execute(repo, stale)).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
    await expect(service.execute(repo, { type: 'reset', target, mode: 'hard' })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
  });

  it('rebases a topic onto main while preserving both branches of content', async () => {
    const { root, service, repo } = await setup();
    await commit(root, 'base.txt', 'base');
    await git(root, 'switch', '-c', 'topic');
    await commit(root, 'topic.txt', 'topic');
    await git(root, 'switch', 'main');
    const main = await commit(root, 'main.txt', 'main');
    await git(root, 'switch', 'topic');
    await service.execute(repo, await service.prepareAction(repo, { type: 'rebase', target: 'main' }));
    expect((await service.snapshot(repo)).operation.kind).toBeUndefined();
    expect(await git(root, 'rev-parse', 'HEAD^')).toBe(main);
    expect(await readFile(path.join(root, 'topic.txt'), 'utf8')).toBe('topic');
    expect(await readFile(path.join(root, 'main.txt'), 'utf8')).toBe('main');
  });

  it('shares commonDir across linked worktrees and only removes registered linked worktrees', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'a.txt', 'a'); const linked = path.join(root, 'linked');
    await service.execute(repo, { type: 'worktree.add', path: linked, newBranch: 'linked-branch' }); const child = await service.discover(linked); expect(child.commonDir).toBe(repo.commonDir); expect(child.id).not.toBe(repo.id); expect((await service.snapshot(repo)).worktrees).toHaveLength(2);
    await expect(service.execute(repo, { type: 'worktree.remove', path: root, force: true })).rejects.toThrow('Only registered'); await expect(service.execute(repo, { type: 'worktree.remove', path: os.tmpdir(), force: true })).rejects.toThrow('Only registered');
    await service.execute(repo, { type: 'worktree.remove', path: linked }); expect((await service.snapshot(repo)).worktrees).toHaveLength(1);
  });
  it('fetches, pushes and pulls from a local bare remote with upstream tracking', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'a.txt', 'a'); const bare = path.join(root, 'remote.git'); await mkdir(bare); await git(bare, 'init', '--bare'); await git(root, 'remote', 'add', 'origin', bare); await service.execute(repo, { type: 'push', branch: 'main' });
    await commit(root, 'b.txt', 'b'); expect(await service.snapshot(repo)).toMatchObject({ ahead: 1, unpushed: 1 }); expect(await service.repositoryStatus(repo)).toMatchObject({ repositoryId: repo.id, branch: 'main', upstream: 'origin/main', ahead: 1, unpushed: 1 });
    const beforePush = await service.history(repo, { tips: ['HEAD'] });
    expect(beforePush.commits.slice(0, 2).map(item => item.pushed)).toEqual([false, true]);
    await service.execute(repo, { type: 'push' }); expect((await service.snapshot(repo)).ahead).toBe(0);
    expect((await service.history(repo, { tips: ['HEAD'] })).commits.every(item => item.pushed)).toBe(true);
    await service.execute(repo, { type: 'fetch', remote: 'origin' }); await service.execute(repo, { type: 'pull', strategy: 'ff-only' });
    const snapshot = await service.snapshot(repo); expect(snapshot.upstream).toBe('origin/main'); expect(snapshot.refs.some(x => x.name === 'origin/main')).toBe(true); expect(snapshot.pushTarget).toEqual({ localBranch: 'main', remote: 'origin', remoteBranch: 'main', configured: true });
    await service.execute(repo, { type: 'branch.create', name: 'tracked', start: 'refs/remotes/origin/main', checkout: true }); expect((await service.snapshot(repo)).upstream).toBe('origin/main');
    await commit(root, 'tracked.txt', 'tracked'); await service.execute(repo, { type: 'push', remote: 'origin', branch: 'tracked', remoteBranch: 'release/tracked', setUpstream: true });
    expect(await git(bare, 'rev-parse', 'refs/heads/release/tracked')).toBe(await git(root, 'rev-parse', 'HEAD'));
    expect((await service.snapshot(repo)).pushTarget).toEqual({ localBranch: 'tracked', remote: 'origin', remoteBranch: 'release/tracked', configured: true });
    const remoteSnapshot=await service.snapshot(repo),remoteRef=remoteSnapshot.refs.find(ref=>ref.name==='origin/release/tracked')!;await service.execute(repo,{type:'remote.delete',remote:'origin',branches:['release/tracked'],expectedOids:{'release/tracked':remoteRef.oid},expectedDestination:remoteSnapshot.remoteDestinations!.origin});await expect(git(bare,'rev-parse','refs/heads/release/tracked')).rejects.toThrow();
  });
  it('rejects path traversal/options and surfaces external locks, hooks, and bounded output failures', async () => {
    const { root, service, repo } = await setup(); await commit(root, 'a.txt', 'a');
    for (const file of ['../outside', 'C:\\outside', '/outside', '.git/config', 'dir/../../out', '.']) expect(() => validateFilePath(file)).toThrow();
    await expect(service.execute(repo, { type: 'branch.create', name: 'bad name' })).rejects.toThrow('Branch names cannot contain spaces'); await expect(service.execute(repo, { type: 'branch.create', name: '--bad' })).rejects.toThrow('cannot start with a hyphen'); await expect(service.prepareAction(repo, { type: 'merge', target: '--help' })).rejects.toThrow();
    await writeFile(path.join(root, '.git', 'index.lock'), ''); await writeFile(path.join(root, 'a.txt'), 'edited'); await expect(service.execute(repo, { type: 'stage', paths: ['a.txt'] })).rejects.toThrow('Another Git process'); await rm(path.join(root, '.git', 'index.lock'));
    await service.execute(repo, { type: 'stage', paths: ['a.txt'] }); await writeFile(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho rejected-by-test-hook >&2\nexit 1\n'); await expect(service.execute(repo, { type: 'commit', message: 'blocked' })).rejects.toThrow('rejected-by-test-hook');
    await writeFile(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nsleep 10\n'); let calls = 0; let disposed = 0;
    const bounded = new GitService({ timeoutMs: 1500, environment: async () => { calls++; return { env: {}, dispose: () => { disposed++; } }; } });
    const started = Date.now(); const timeout = await bounded.execute(repo, { type: 'commit', message: 'timeout' }).catch(error => error);
    expect(Date.now() - started).toBeLessThan(9000); // Includes repository verification and the 5-second termination grace.
    if (timeout?.terminationUnconfirmed) {
      expect(timeout).toMatchObject({ code: 'GIT_TERMINATION_UNCONFIRMED', triggerCode: 'TIMEOUT' });
      let closed = false; void timeout.completion.then(() => { closed = true; }); await Promise.resolve();
      if (!closed) expect(disposed).toBe(calls - 1);
      await expect(bounded.execute(repo, { type: 'stage', paths: ['a.txt'] })).rejects.toMatchObject({ code: 'GIT_TERMINATION_UNCONFIRMED' });
      await timeout.completion;
    }
    else expect(timeout).toMatchObject({ code: 'TIMEOUT' });
    expect(disposed).toBe(calls);
    const limited = new GitService({ maxOutputBytes: 1 }); const output = await limited.snapshot(repo).catch(error => error);
    if (output?.terminationUnconfirmed) expect(output).toMatchObject({ code: 'GIT_TERMINATION_UNCONFIRMED', triggerCode: 'OUTPUT_LIMIT' });
    else expect(output).toMatchObject({ code: 'OUTPUT_LIMIT' });
  });
  it('parses porcelain records with embedded whitespace and two-path renames', () => {
    const parsed = parseStatus(Buffer.from(['# branch.oid (initial)', '# branch.head main', '2 R. N... 100644 100644 100644 abc abc R100 new\tname', 'old\nname', 'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict file', ''].join('\0')));
    expect(parsed.changes[0]).toMatchObject({ path: 'new\tname', originalPath: 'old\nname' }); expect(parsed.changes[1]).toMatchObject({ path: 'conflict file', conflict: true });
    expect(() => parseStatus(Buffer.concat([Buffer.from('? invalid-'), Buffer.from([255]), Buffer.from('\0')]))).toThrow('invalid UTF-8');
  });
});
