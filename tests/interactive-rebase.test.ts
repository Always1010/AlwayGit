import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GitService } from '../src/git/service';
import type { RebasePlan, RebaseStep } from '../src/protocol/interactive-rebase';
import { interactiveRebaseSchema } from '../src/protocol/interactive-rebase';
import { git, commitFile as commit, gitFixtures } from './support/git-fixture';
const fixtures=gitFixtures('alwaygit-rebase-');afterEach(fixtures.cleanup);
const action=(plan:RebasePlan,steps:RebaseStep[]=plan.commits.map(x=>({oid:x.oid,action:'pick'})),acknowledgePublished=false)=>({type:'rebase.interactive' as const,token:plan.token,steps,acknowledgePublished});
describe('managed interactive Rebase',()=>{
 it('reorders, rewords, squashes, fixes up and drops against a pinned base despite user configuration',async()=>{
  const {root,repo,service}=await fixtures.setup();await commit(root,'base','base');
  const a=await commit(root,'a','a'),b=await commit(root,'b','b'),c=await commit(root,'c','c'),d=await commit(root,'d','d'),e=await commit(root,'e','e'),f=await commit(root,'f','f');
  for(const key of ['rebase.autosquash','rebase.autoStash','rebase.updateRefs','rebase.rebaseMerges','rebase.abbreviateCommands','rebase.rescheduleFailedExec'])await git(root,'config',key,'true');
  await git(root,'config','core.commentChar',';');await git(root,'config','rebase.instructionFormat','%an %s');await git(root,'branch','other',f);
  const plan=await service.prepareInteractiveRebase(repo,a),message="combined 'quoted' $HOME $(echo no) `no`\n\nbody";
  await service.execute(repo,action(plan,[{oid:b,action:'reword',message:'B renamed'},{oid:a,action:'pick'},{oid:c,action:'squash',message},{oid:d,action:'fixup'},{oid:e,action:'drop'},{oid:f,action:'pick'}]));
  expect(await git(root,'log','--reverse','--format=%s',`${plan.base}..HEAD`)).toBe('B renamed\n'+message.split('\n')[0]+'\nf');
  expect(await git(root,'show','-s','--format=%B','HEAD~1')).toBe(message);
  expect(await git(root,'ls-tree','--name-only','HEAD')).toBe('a\nb\nbase\nc\nd\nf');
  expect(await git(root,'rev-parse','other')).toBe(f);
  const refs=await service.reflog(repo);expect(refs.recoveries.some(x=>x.oid===plan.head)).toBe(true);
  expect(await readFile(path.join(repo.gitDir!,'alwaygit-interactive-rebase','manifest.json'),'utf8').catch(()=>undefined)).toBeUndefined();
 });
 it('rejects malformed, expired/context-changed, published, dirty and non-linear plans without rewriting',async()=>{
  const {root,repo,service}=await fixtures.setup();const base=await commit(root,'base','base'),a=await commit(root,'a','a'),b=await commit(root,'b','b');
  let plan=await service.prepareInteractiveRebase(repo,a);
  const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+16*60_000);try{await expect(service.execute(repo,action(plan))).rejects.toThrow('expired');}finally{clock.mockRestore();}
  await expect(service.execute(repo,action(plan,[{oid:a,action:'pick'},{oid:a,action:'pick'}]))).rejects.toThrow();
  await expect(service.execute(repo,action(plan,[{oid:a,action:'squash',message:'bad'},{oid:b,action:'pick'}]))).rejects.toThrow();
  await git(root,'update-ref','refs/remotes/origin/main',b);
  await expect(service.execute(repo,action(plan))).rejects.toThrow('remote');
  await writeFile(path.join(root,'dirty'),'dirty');await expect(service.execute(repo,action(plan,undefined,true))).rejects.toThrow('stash');await git(root,'clean','-fd');
  await commit(root,'c','c');await expect(service.execute(repo,action(plan,undefined,true))).rejects.toThrow('changed');
  plan=await service.prepareInteractiveRebase(repo,a);expect(plan.published).toEqual([a,b]);await service.execute(repo,action(plan,undefined,true));
  await expect(service.prepareInteractiveRebase(repo,base)).rejects.toThrow();
  expect(interactiveRebaseSchema.safeParse({...action(plan),steps:[{oid:a,action:'exec',message:'bad'}]}).success).toBe(false);
  await git(root,'checkout','-b','side',base);await commit(root,'side','side');await git(root,'checkout','main');await git(root,'merge','--no-ff','side','-m','merge');await expect(service.prepareInteractiveRebase(repo,a)).rejects.toThrow();
 });
 it('restores helper context after reload, requires staged review, and continues or aborts conflicts',async()=>{
  const {root,repo,service}=await fixtures.setup();await commit(root,'x','base');const a=await commit(root,'x','a'),b=await commit(root,'x','b');
  const plan=await service.prepareInteractiveRebase(repo,a);const steps:RebaseStep[]=[{oid:b,action:'reword',message:'reordered b'},{oid:a,action:'pick'}];
  await expect(service.execute(repo,action(plan,steps))).rejects.toThrow();
  const restored=new GitService();let snapshot=await restored.snapshot(repo);expect(snapshot.operation.kind).toBe('rebase');expect(snapshot.operation.managedRebase?.pause).toBe('conflict');
  await writeFile(path.join(root,'x'),'b');await restored.execute(repo,{type:'resolve-and-stage',paths:['x']});
  await expect(restored.execute(repo,{type:'operation.continue',kind:'rebase'})).rejects.toThrow();
  const review=await restored.reviewOperation(repo);
  await expect(restored.execute(repo,{type:'operation.continue',kind:'rebase',reviewToken:review.token})).rejects.toThrow();
  snapshot=await restored.snapshot(repo);expect(snapshot.operation.managedRebase?.pause).toBe('conflict');
  await writeFile(path.join(repo.gitDir!,'alwaygit-interactive-rebase','manifest.json'),'{}');expect((await restored.snapshot(repo)).operation.managedRebase?.pause).toBe('unavailable');await expect(restored.execute(repo,{type:'operation.continue',kind:'rebase'})).rejects.toThrow();
  await restored.execute(repo,{type:'operation.abort',kind:'rebase'});expect(await git(root,'rev-parse','HEAD')).toBe(plan.head);expect(await readFile(path.join(root,'x'),'utf8')).toBe('b');
  const retry=await restored.prepareInteractiveRebase(repo,a);await expect(restored.execute(repo,action(retry,steps))).rejects.toThrow();await writeFile(path.join(root,'x'),'b');await restored.execute(repo,{type:'resolve-and-stage',paths:['x']});
  const r1=await restored.reviewOperation(repo);await expect(restored.execute(repo,{type:'operation.continue',kind:'rebase',reviewToken:r1.token})).rejects.toThrow();
  await writeFile(path.join(root,'x'),'a');await restored.execute(repo,{type:'resolve-and-stage',paths:['x']});const r2=await restored.reviewOperation(repo);await restored.execute(repo,{type:'operation.continue',kind:'rebase',reviewToken:r2.token});
  expect(await git(root,'log','--reverse','--format=%s',`${plan.base}..HEAD`)).toBe('reordered b\nx');expect(await git(root,'show','-s','--format=%B','HEAD~1')).toBe('reordered b');expect(await git(root,'show','-s','--format=%B','HEAD')).toBe('x');
 });
 it.each(['keep','skip'])('preserves originally empty commits and explicitly %s an emptied reword commit',async(choice)=>{
  const {root,repo,service}=await fixtures.setup();await commit(root,'base','base');const a=await commit(root,'x','same');await git(root,'commit','--allow-empty','-m','original empty');const originalEmpty=await git(root,'rev-parse','HEAD');await git(root,'rm','x');await git(root,'commit','-m','remove');const removal=await git(root,'rev-parse','HEAD');const repeated=await commit(root,'x','same');
  const plan=await service.prepareInteractiveRebase(repo,a),steps:RebaseStep[]=[{oid:a,action:'pick'},{oid:originalEmpty,action:'pick'},{oid:removal,action:'drop'},{oid:repeated,action:'reword',message:'kept replacement\n\n# deliberate message content'}];
  await expect(service.execute(repo,action(plan,steps))).rejects.toThrow();expect((await service.snapshot(repo)).operation.managedRebase?.pause).toBe('empty');
  const restored=new GitService();if(choice==='keep'){const review=await restored.reviewOperation(repo);await restored.execute(repo,{type:'operation.continue',kind:'rebase',reviewToken:review.token,keepEmpty:true});expect(await git(root,'show','-s','--format=%B')).toBe('kept replacement\n\n# deliberate message content');}else await restored.execute(repo,{type:'operation.skip',kind:'rebase',skipToken:(await restored.snapshot(repo)).operation.skipToken!});
  expect(await git(root,'rev-list','--count',`${plan.base}..HEAD`)).toBe(choice==='keep'?'3':'2');expect(await git(root,'log','--format=%s',`${plan.base}..HEAD`)).toContain('original empty');
 });

 it.each(['squash','fixup'] as const)('combines an emptied %s into the preceding retained commit',async(kind)=>{
  const {root,repo,service}=await fixtures.setup();await commit(root,'base','base');const a=await commit(root,'x','same');await git(root,'rm','x');await git(root,'commit','-m','remove');const removal=await git(root,'rev-parse','HEAD'),repeated=await commit(root,'x','same');
  const plan=await service.prepareInteractiveRebase(repo,a);await service.execute(repo,action(plan,[{oid:a,action:'pick'},{oid:removal,action:'drop'},{oid:repeated,action:kind,message:'combined empty'}]));
  expect(await git(root,'rev-list','--count',`${plan.base}..HEAD`)).toBe('1');expect(await git(root,'show','-s','--format=%B')).toBe(kind==='squash'?'combined empty':'x');
 });
 it('retains failed commit-hook state and retries controlled message editing after reload',async()=>{
  const {root,repo,service}=await fixtures.setup();await commit(root,'base','base');const a=await commit(root,'a','a');const hook=path.join(repo.gitDir!,'hooks','pre-commit');await writeFile(hook,'#!/bin/sh\nexit 1\n');await chmod(hook,0o700);
  const plan=await service.prepareInteractiveRebase(repo,a);await expect(service.execute(repo,action(plan,[{oid:a,action:'reword',message:'hook retry'}]))).rejects.toThrow();
  const restored=new GitService(),state=(await restored.snapshot(repo)).operation;expect(state.kind).toBe('rebase');expect(state.managedRebase?.pause).toBe('review');expect(state.canSkip).toBe(false);await expect(restored.execute(repo,{type:'operation.skip',kind:'rebase',skipToken:(await restored.snapshot(repo)).operation.skipToken!})).rejects.toThrow();await writeFile(hook,'#!/bin/sh\nexit 0\n');const review=await restored.reviewOperation(repo);await restored.execute(repo,{type:'operation.continue',kind:'rebase',reviewToken:review.token});expect(await git(root,'show','-s','--format=%B')).toBe('hook retry');
 });
 it('runs editor helpers from worktree paths with spaces, quotes and shell characters',async()=>{
  const {root,service}=await fixtures.setup();await commit(root,'base','base');const tree=path.join(root,"work tree '$() `x`");await git(root,'worktree','add','-b','feature',tree);const repo=await service.discover(tree),a=await commit(tree,'a','a');
  const plan=await service.prepareInteractiveRebase(repo,a);await service.execute(repo,action(plan,[{oid:a,action:'reword',message:"path is safe '$()`"}]));expect(await git(tree,'show','-s','--format=%B')).toBe("path is safe '$()`");expect(await git(root,'branch','--show-current')).toBe('main');
 });
});
