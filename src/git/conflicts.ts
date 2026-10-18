import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, lstat, open, readFile, rename, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { safeWorkingPath } from '../editor/paths';
import type { Repository, Snapshot } from '../protocol/types';
import type { ConflictDetails, ConflictVersion } from '../protocol/conflicts';
import { message } from '../i18n';
import { GitError } from './error';
import type { GitResult } from './runner';

type Run = (args: string[]) => Promise<GitResult>;
const LIMIT=32*1024*1024, TTL=5*60_000;
const changed=()=>new GitError(message('conflicts.changed'),'CONFLICT_CHANGED');
const digest=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
interface Context {root:string; details:ConflictDetails; fingerprint:string; expires:number}
export class ConflictStore {
  private contexts=new Map<string,Context>();
  private async capture(repo:Repository,name:string,run:Run,snapshot:()=>Promise<Snapshot>){
    const state=await snapshot(),change=state.changes.find(file=>file.path===name&&file.conflict);if(!change)throw changed();
    const raw=(await run(['ls-files','--unmerged','-z','--',name])).stdout.toString('utf8');
    const stages=new Map<number,ConflictVersion>();
    for(const record of raw.split('\0').filter(Boolean)){
      const tab=record.indexOf('\t');if(record.slice(tab+1)!==name)throw changed();
      const [mode,oid,stage]=record.slice(0,tab).split(' '),size=Number((await run(['cat-file','-s',oid])).stdout.toString());stages.set(+stage,{mode,oid,size});
    }
    if(!stages.size)throw changed();
    const full=await safeWorkingPath(repo.root,name,false);let work:Buffer|undefined,mode:number|undefined,ordinary=true;
    try{const stat=await lstat(full);ordinary=stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=LIMIT;mode=stat.mode;if(ordinary){
      await safeWorkingPath(repo.root,name,true);const handle=await open(full,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      try{const before=await handle.stat();if(!before.isFile()||before.size>LIMIT)throw changed();work=await handle.readFile();const after=await handle.stat();if(before.size!==work.length||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw changed();}finally{await handle.close();}
    }}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const attrs=(await run(['check-attr','-z','filter','working-tree-encoding','ident','--',name])).stdout.toString('utf8').split('\0');
    let filtered=false;for(let i=0;i+2<attrs.length;i+=3)if(!['unspecified','unset'].includes(attrs[i+2]))filtered=true;
    const gitDir=(await run(['rev-parse','--absolute-git-dir'])).stdout.toString('utf8').trim();
    const markers=await Promise.all(['MERGE_HEAD','REBASE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD'].map(async marker=>{try{return await readFile(path.join(gitDir,marker),'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return '';throw error;}}));
    const incoming=markers[state.operation.kind==='rebase'?1:state.operation.kind==='cherry-pick'?2:state.operation.kind==='revert'?3:0]?.trim().split('\n')[0]||undefined;
    const canChoose=ordinary&&!filtered&&!change.originalPath&&[...stages.values()].every(entry=>/^100(?:644|755)$/.test(entry.mode)&&entry.size<=LIMIT);
    let canMerge=canChoose&&!!stages.get(2)&&!!stages.get(3);
    if(canMerge)for(const entry of stages.values()){
      if(entry.size>2*1024*1024){canMerge=false;break;}
      const data=(await run(['cat-file','blob',entry.oid])).stdout;
      try{if(data.includes(0))canMerge=false;new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{canMerge=false;}
    }
    let canEdit=!!work&&!work.includes(0);try{if(work)new TextDecoder('utf-8',{fatal:true}).decode(work);}catch{canEdit=false;}
    const details:ConflictDetails={token:'',path:name,status:change.indexStatus+change.worktreeStatus,operation:state.operation.kind,head:state.head,incoming,base:stages.get(1),ours:stages.get(2),theirs:stages.get(3),canMerge,canChoose,canEdit};
    return {details,full,work,mode,fingerprint:digest(JSON.stringify([repo.root,state.branch,state.head,state.operation,markers,raw,attrs,mode,work?digest(work):null,ordinary]))};
  }
  async preview(repo:Repository,name:string,run:Run,snapshot:()=>Promise<Snapshot>):Promise<ConflictDetails>{
    for(const [key,value]of this.contexts)if(value.expires<Date.now())this.contexts.delete(key);
    while(this.contexts.size>=16)this.contexts.delete(this.contexts.keys().next().value!);
    const captured=await this.capture(repo,name,run,snapshot),token=randomUUID(),details={...captured.details,token};
    this.contexts.set(token,{root:repo.root,details,fingerprint:captured.fingerprint,expires:Date.now()+TTL});return details;
  }
  async choose(repo:Repository,token:string,side:'ours'|'theirs',run:Run,snapshot:()=>Promise<Snapshot>):Promise<void>{
    const saved=this.contexts.get(token);if(!saved||saved.root!==repo.root||saved.expires<Date.now()||!saved.details.canChoose)throw changed();
    const current=await this.capture(repo,saved.details.path,run,snapshot);if(current.fingerprint!==saved.fingerprint)throw changed();
    const version=side==='ours'?current.details.ours:current.details.theirs;
    const bytes=version?(await run(['cat-file','--filters',`--path=${saved.details.path}`,version.oid])).stdout:undefined;
    const temporary=path.join(path.dirname(current.full),'.alwaygit-conflict-'+randomUUID());
    try{
      if(bytes){const file=await open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}await chmod(temporary,((current.mode??0o644)&0o666)|(version!.mode==='100755'?0o111:0));}
      const latest=await this.capture(repo,saved.details.path,run,snapshot);if(latest.fingerprint!==saved.fingerprint)throw changed();
      await safeWorkingPath(repo.root,saved.details.path,false);
      if(!bytes){if(current.work)await unlink(current.full);}
      else if(current.work===undefined)await link(temporary,current.full);else await rename(temporary,current.full);
      this.contexts.delete(token);
    }finally{await rm(temporary,{force:true});}
  }
}
