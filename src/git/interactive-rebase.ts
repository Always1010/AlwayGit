import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Repository, Snapshot } from '../protocol/types';
import { interactiveRebaseSchema, type InteractiveRebaseAction, type ManagedRebaseState, type RebasePlan } from '../protocol/interactive-rebase';
import type { StashExecution } from './stash';
import { GitError, GitTerminationError } from './error';
import { z } from 'zod';
import { message } from '../i18n';
type Run = (args: string[], execution?: StashExecution) => Promise<{ stdout: Buffer; stderr: Buffer; code: number }>;
const text = async (run: Run, args: string[]) => (await run(args)).stdout.toString('utf8').trim();
const read = async (name: string) => { try { return await readFile(name, 'utf8'); } catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined; throw error; } };
const normalized=(value:string)=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
const fail = (key: 'invalid'|'changed'|'scope'|'published'|'dirty'|'path') => new GitError(message(({invalid:'interactiveRebase.invalid',changed:'interactiveRebase.changed',scope:'interactiveRebase.scope',published:'interactiveRebase.published',dirty:'interactiveRebase.dirty',path:'interactiveRebase.path'} as const)[key]), 'REBASE_PLAN_INVALID');
const config = { 'rebase.rescheduleFailedExec':'false', 'rebase.autosquash':'false', 'rebase.autoStash':'false', 'rebase.updateRefs':'false', 'rebase.rebaseMerges':'false', 'rebase.abbreviateCommands':'false', 'rebase.instructionFormat':'%s', 'rebase.missingCommitsCheck':'error', 'core.abbrev':'40', 'commit.cleanup':'verbatim', 'core.commentChar':'#', 'core.commentString':'#' };
// Git launches editors through its POSIX shell, including Git for Windows.
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
const oidSchema=z.string().regex(/^[a-f0-9]{40,64}$/);
const manifestSchema=z.object({version:z.literal(1),root:z.string(),gitDir:z.string(),backupRef:z.string().regex(/^refs\/alwaygit\/rebase-backups\/[0-9]+-[a-f0-9-]+$/),plan:z.object({token:z.string().uuid(),branch:z.string().min(1),head:oidSchema,base:oidSchema,expires:z.number(),commits:z.array(z.object({oid:oidSchema,subject:z.string(),message:z.string()})).min(1).max(500),published:z.array(oidSchema)}),action:interactiveRebaseSchema,messages:z.record(oidSchema,z.string())});
type Manifest=z.infer<typeof manifestSchema>;
const directory = (gitDir: string) => path.join(gitDir, 'alwaygit-interactive-rebase');
const helper = String.raw`const fs=require('node:fs'),path=require('node:path');
const [manifestFile,mode,file]=process.argv.slice(2),m=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
if(mode==='checkpoint'){fs.writeFileSync(path.join(path.dirname(manifestFile),'checkpoint.json'),JSON.stringify({oid:file,head:fs.readFileSync(path.join(m.gitDir,'HEAD'),'utf8').trim()}));process.exit(0);}
if(fs.readFileSync(path.join(m.gitDir,'rebase-merge','head-name'),'utf8').trim()!=='refs/heads/'+m.plan.branch||fs.readFileSync(path.join(m.gitDir,'rebase-merge','orig-head'),'utf8').trim()!==m.plan.head)throw Error('Rebase branch changed');
if(mode==='sequence') {
 fs.writeFileSync(path.join(m.gitDir,'rebase-merge','alwaygit-managed'),m.backupRef+'\n');
 const lines=fs.readFileSync(file,'utf8').split(/\r?\n/).filter(x=>x.trim()&&!x.startsWith('#'));
 const oids=lines.map(line=>{const [cmd,oid]=line.trim().split(/\s+/);if(cmd!=='pick')throw Error('Unexpected rebase command'); const hits=m.plan.commits.filter(x=>x.oid.startsWith(oid));if(hits.length!==1)throw Error('Unexpected rebase commit');return hits[0].oid;});
 if(JSON.stringify(oids)!==JSON.stringify(m.plan.commits.map(x=>x.oid)))throw Error('Rebase candidates changed');
 const q=x=>"'"+x.replace(/'/g,"'\\''")+"'",cmd='ELECTRON_RUN_AS_NODE=1 '+[process.execPath.replace(/\\/g,'/'),__filename.replace(/\\/g,'/'),manifestFile.replace(/\\/g,'/')].map(q).join(' ');
 fs.writeFileSync(file,m.action.steps.flatMap(x=>[...(x.action==='drop'?[]:['exec '+cmd+' checkpoint '+x.oid]),x.action+' '+x.oid]).join('\n')+'\n');
} else {
 const done=fs.readFileSync(path.join(m.gitDir,'rebase-merge','done'),'utf8').trim().split(/\r?\n/);
 const oid=done.at(-1).trim().split(/\s+/)[1]; const key=Object.keys(m.messages).find(x=>x.startsWith(oid));
 if(!key)throw Error('Unexpected rebase message');
 fs.writeFileSync(file,m.messages[key]+(m.messages[key].endsWith('\n')?'':'\n'));
}
`;
export class InteractiveRebase {
  private plans = new Map<string,{root:string; plan:RebasePlan}>();
  async prepare(repo: Repository, snapshot: Snapshot, run: Run, start?: string): Promise<RebasePlan> {
    if(!snapshot.branch||!snapshot.head||snapshot.operation.kind)throw fail('scope');
    if(snapshot.changes.length)throw fail('dirty');
    let base: string;
    if(start) { if(!/^[a-f0-9]{40,64}$/.test(start))throw fail('scope'); const parents=(await text(run,['rev-list','--parents','-n','1',start])).split(' ');if(parents.length!==2)throw fail('scope');base=parents[1]; }
    else {
      const unpublished=(await text(run,['rev-list','--first-parent','--max-count=20',snapshot.head,'--not','--remotes'])).split('\n').filter(Boolean);
      if(!unpublished.length)throw fail('scope');
      const oldest=unpublished.at(-1)!;const parents=(await text(run,['rev-list','--parents','-n','1',oldest])).split(' ');if(parents.length>2)throw fail('scope');base=parents[1]??oldest;
    }
    const rows=(await text(run,['rev-list','--reverse','--topo-order','--parents','--max-count=501',`${base}..${snapshot.head}`])).split('\n').filter(Boolean);
    if(!rows.length||rows.length>500||rows.some((row,index)=>{const values=row.split(' ');return values.length!==2||values[1]!== (index?rows[index-1].split(' ')[0]:base);})||start&&rows[0].split(' ')[0]!==start)throw fail('scope');
    const commits=[];
    for(const row of rows) {const oid=row.split(' ')[0],body=(await run(['show','-s','--format=%B',oid])).stdout.toString('utf8').replace(/\n$/,'');commits.push({oid,message:body,subject:body.split('\n')[0]});}
    const local=new Set((await text(run,['rev-list','--topo-order','--max-count=501',snapshot.head,'--not','--remotes'])).split('\n'));
    const plan:RebasePlan={token:randomUUID(),branch:snapshot.branch,head:snapshot.head,base,expires:Date.now()+15*60_000,commits,published:commits.filter(x=>!local.has(x.oid)).map(x=>x.oid)};
    for(const [key,value] of this.plans)if(value.plan.expires<Date.now())this.plans.delete(key);
    while(this.plans.size>=32)this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(plan.token,{root:repo.root,plan});return plan;
  }
  async start(repo:Repository,snapshot:Snapshot,run:Run,input:InteractiveRebaseAction):Promise<void> {
    const action=interactiveRebaseSchema.parse(input),cached=this.plans.get(action.token),plan=cached?.plan;
    if(!plan||cached?.root!==repo.root||plan.expires<Date.now()||snapshot.head!==plan.head||snapshot.branch!==plan.branch||snapshot.operation.kind)throw fail('changed');
    if(snapshot.changes.length)throw fail('dirty');
    const known=new Set(plan.commits.map(x=>x.oid));let retained=false,groupMessage='';const messages:Record<string,string>={};
    if(action.steps.length!==known.size)throw fail('invalid');
    for(const step of action.steps) {
      if(!known.delete(step.oid))throw fail('invalid');
      if(step.action==='drop')continue;
      if(step.action==='squash'||step.action==='fixup') {if(!retained)throw fail('invalid');}else {retained=true;groupMessage=plan.commits.find(x=>x.oid===step.oid)!.message;}
      if(step.action==='reword'||step.action==='squash'){if(!step.message?.trim())throw fail('invalid');groupMessage=step.message;messages[step.oid]=groupMessage;}
      messages[step.oid]=groupMessage;
    }
    const local=new Set((await text(run,['rev-list','--topo-order','--max-count=501',plan.head,'--not','--remotes'])).split('\n'));
    if(plan.commits.some(x=>!local.has(x.oid))&&!action.acknowledgePublished)throw fail('published');
    const gitDir=await text(run,['rev-parse','--path-format=absolute','--git-dir']),dir=directory(gitDir);
    if(/[\r\n\0]/.test(gitDir+process.execPath))throw fail('path');
    await this.cleanup(gitDir);
    const backupRef=`refs/alwaygit/rebase-backups/${Date.now()}-${randomUUID()}`;
    const manifest:Manifest={version:1,root:repo.root,gitDir,backupRef,plan,action,messages};
    await mkdir(dir,{recursive:false,mode:0o700});
    await writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest),{mode:0o600});
    await writeFile(path.join(dir,'editor.cjs'),helper,{mode:0o600});
    let deferred=false;
    try {
      if(await text(run,['rev-parse','HEAD'])!==plan.head||await text(run,['symbolic-ref','--short','HEAD'])!==plan.branch||await text(run,['status','--porcelain','--untracked-files=all']))throw fail('changed');
      await run(['update-ref',backupRef,plan.head,'0'.repeat(plan.head.length)]);
      this.plans.delete(action.token);
      await run(['rebase','--interactive','--merge','--force-rebase','--no-autosquash','--no-autostash','--no-update-refs','--no-rebase-merges','--no-fork-point','--keep-empty','--reapply-cherry-picks','--onto',plan.base,plan.base,plan.branch],this.execution(manifest));
    } catch(error) {if(error instanceof GitTerminationError){deferred=true;void error.completion.then(()=>this.cleanup(gitDir)).catch(()=>{});}throw error;} finally {if(!deferred)await this.cleanup(gitDir);}
  }
  private execution(manifest:Manifest):StashExecution {
    const dir=directory(manifest.gitDir),command='ELECTRON_RUN_AS_NODE=1 '+[process.execPath.replace(/\\/g,'/'),path.join(dir,'editor.cjs').replace(/\\/g,'/'),path.join(dir,'manifest.json').replace(/\\/g,'/')].map(quote).join(' ');
    return {config,env:{GIT_SEQUENCE_EDITOR:command+' sequence',GIT_EDITOR:command+' message'}};
  }
  private async manifest(run:Run):Promise<Manifest|undefined> {
    const gitDir=await text(run,['rev-parse','--path-format=absolute','--git-dir']);
    const raw=await read(path.join(directory(gitDir),'manifest.json'));if(!raw)return;
    let m:Manifest;try{m=manifestSchema.parse(JSON.parse(raw));}catch{throw fail('changed');}
    if(normalized(m.gitDir)!==normalized(gitDir)||normalized(m.root)!==normalized(await text(run,['rev-parse','--show-toplevel']))||await read(path.join(gitDir,'rebase-merge','orig-head'))!==m.plan.head+'\n'||await read(path.join(gitDir,'rebase-merge','head-name'))!==`refs/heads/${m.plan.branch}\n`)throw fail('changed');
    if(await read(path.join(directory(gitDir),'editor.cjs'))!==helper)throw fail('changed');
    return m;
  }
  async state(run:Run,gitDir:string,conflicts:number):Promise<ManagedRebaseState|undefined> {
    const raw=await read(path.join(directory(gitDir),'manifest.json'));if(!raw)return await read(path.join(gitDir,'rebase-merge','alwaygit-managed'))?{backupRef:'',step:0,total:0,pause:'unavailable'}:undefined;
    let m:Manifest|undefined;try{m=await this.manifest(run);}catch{return {backupRef:'',step:0,total:0,pause:'unavailable'};}if(!m)return;
    const step=(await read(path.join(gitDir,'rebase-merge','done')))?.trim().split('\n').filter(line=>line&&!line.startsWith('exec ')).length??0,total=m.action.steps.length,stoppedOid=(await read(path.join(gitDir,'rebase-merge','stopped-sha')))?.trim();
    if((await read(path.join(gitDir,'rebase-merge','done')))?.trim().split('\n').at(-1)?.startsWith('exec '))return {backupRef:m.backupRef,step,total,pause:'unavailable'};
    const checkpoint=await this.checkpoint(gitDir);
    if(stoppedOid&&(!checkpoint||checkpoint.oid!==stoppedOid))return {backupRef:m.backupRef,step,total,stoppedOid,pause:'unavailable'};
    const applied=!!checkpoint&&checkpoint.head!==await text(run,['rev-parse','HEAD']);
    const empty=!!stoppedOid&&!conflicts&&!applied&&(await run(['diff','--cached','--quiet'],{allowFailure:true})).code===0&&(await run(['diff','--quiet'],{allowFailure:true})).code===0;
    return {backupRef:m.backupRef,step,total,stoppedOid,applied,pause:conflicts?'conflict':empty?'empty':'review'};
  }
  async resume(run:Run,command:'continue'|'abort'|'skip',keepEmpty=false):Promise<boolean> {
    const gitDir=await text(run,['rev-parse','--path-format=absolute','--git-dir']);
    if(command==='abort'){try{await run(['rebase','--abort']);}catch(error){if(error instanceof GitTerminationError){void error.completion.then(()=>this.cleanup(gitDir)).catch(()=>{});throw error;}await this.cleanup(gitDir);throw error;}await this.cleanup(gitDir);return true;}
    const m=await this.manifest(run);if(!m)throw fail('changed');
    let deferred=false;
    try {
      if(keepEmpty) {const state=await this.state(run,m.gitDir,0);if(state?.pause!=='empty'||!state.stoppedOid)throw fail('changed');await run(['commit','--allow-empty','--edit','-C',state.stoppedOid],this.execution(m));}
      if(command==='continue'&&!keepEmpty) {
        const amend=(await read(path.join(gitDir,'rebase-merge','amend')))?.trim();
        const done=(await read(path.join(gitDir,'rebase-merge','done')))?.trim().split('\n').at(-1)?.split(/\s+/);
        const checkpoint=await this.checkpoint(gitDir),head=await text(run,['rev-parse','HEAD']);
        if(done?.[0]==='reword'&&checkpoint?.oid===done[1]&&checkpoint.head!==head) {
          if(amend&&amend!==head)throw fail('changed');
          await run(['commit','--amend','--allow-empty','--edit','-C','HEAD'],this.execution(m));
        }
      }
      await run(['rebase',`--${command}`],this.execution(m));
    }catch(error){if(error instanceof GitTerminationError){deferred=true;void error.completion.then(()=>this.cleanup(gitDir)).catch(()=>{});}throw error;}finally{if(!deferred)await this.cleanup(gitDir);}return true;
  }
  private async checkpoint(gitDir:string):Promise<{oid:string;head:string}|undefined>{try{const raw=await read(path.join(directory(gitDir),'checkpoint.json'));return raw?z.object({oid:oidSchema,head:oidSchema}).parse(JSON.parse(raw)):undefined;}catch{return undefined;}}
  private async cleanup(gitDir:string):Promise<void> {if(await read(path.join(gitDir,'rebase-merge','orig-head'))===undefined)await rm(directory(gitDir),{recursive:true,force:true});}
}
