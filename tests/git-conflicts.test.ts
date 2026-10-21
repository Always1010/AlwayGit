import { afterEach, expect, it, vi } from 'vitest';
import {readFile,writeFile,rm,symlink,readdir,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {gitFixtures,commitFile,git} from './support/git-fixture';
import {GitDocuments} from '../src/editor/documents';
const editor=vi.hoisted(()=>({execute:vi.fn(),show:vi.fn(),native:true,fail:false}));
vi.mock('vscode',()=>({Uri:{file:(fsPath:string)=>({fsPath})},ViewColumn:{Active:1},window:{showTextDocument:editor.show},commands:{getCommands:async()=>['git.openMergeEditor'],executeCommand:editor.execute},extensions:{getExtension:()=>editor.native?{isActive:true,exports:{getAPI:()=>{if(editor.fail)throw new Error('API unavailable');return {getRepository:()=>({})};}}}:undefined}}));
const fixtures=gitFixtures('alwaygit-conflicts-');
afterEach(async()=>{vi.useRealTimers();editor.native=true;editor.fail=false;vi.clearAllMocks();await fixtures.cleanup();});
async function conflict(deleted=false,name='file.txt'){
 const fixture=await fixtures.setup(),{root}=fixture;await mkdir(path.dirname(path.join(root,name)),{recursive:true});await git(root,'config','core.autocrlf','false');await commitFile(root,name,'base\n');await git(root,'checkout','-b','incoming');
 if(deleted){await git(root,'rm',name);await git(root,'commit','-m','delete');}else await commitFile(root,name,'incoming\n');
 await git(root,'checkout','main');await commitFile(root,name,'ours\n');await expect(git(root,'merge','incoming','--no-edit')).rejects.toThrow();return fixture;
}
it('restores a conflict side beneath missing parents without changing the Index',async()=>{
 const name='deleted/nested/file.txt',{root,service,repo}=await conflict(false,name);
 await rm(path.join(root,'deleted'),{recursive:true});
 const index=await readFile(path.join(repo.gitDir!,'index')),details=await service.conflictDetails(repo,name);
 expect(details.canChoose).toBe(true);
 await service.execute(repo,{type:'conflict.choose',token:details.token,side:'theirs'});
 expect(await readFile(path.join(root,name),'utf8')).toBe('incoming\n');
 expect(await readFile(path.join(repo.gitDir!,'index'))).toEqual(index);
 expect((await service.snapshot(repo)).operation.conflicts).toBe(1);
 expect(await readdir(path.join(root,'deleted/nested'))).toEqual(['file.txt']);
});
it('refuses a missing conflict parent redirected outside the repository after preview',async()=>{
 const name='deleted/nested/file.txt',{root,service,repo}=await conflict(false,name),outside=await fixtures.setup();
 await rm(path.join(root,'deleted'),{recursive:true});
 const details=await service.conflictDetails(repo,name),index=await readFile(path.join(repo.gitDir!,'index'));
 const entries=await readdir(outside.root);
 await symlink(outside.root,path.join(root,'deleted'),process.platform==='win32'?'junction':'dir');
 await expect(service.execute(repo,{type:'conflict.choose',token:details.token,side:'ours'})).rejects.toThrow(/outside/i);
 expect(await readdir(outside.root)).toEqual(entries);
 expect(await readFile(path.join(repo.gitDir!,'index'))).toEqual(index);
});
it('chooses a pinned side without changing Index, then stages and reviews before continuing',async()=>{
 const {root,service,repo}=await conflict();const details=await service.conflictDetails(repo,'file.txt');
 expect(details).toMatchObject({status:'UU',canMerge:true,canChoose:true});expect(details.ours?.oid).not.toBe(details.theirs?.oid);
 const index=await readFile(path.join(root,'.git','index'));
 await service.execute(repo,{type:'conflict.choose',token:details.token,side:'theirs'});
 expect(await readFile(path.join(root,'file.txt'),'utf8')).toBe('incoming\n');expect(await readFile(path.join(root,'.git','index'))).toEqual(index);
 expect((await service.snapshot(repo)).operation.conflicts).toBe(1);
 await service.execute(repo,{type:'resolve-and-stage',paths:['file.txt']});const review=await service.reviewOperation(repo);expect(review.files.every(file=>!file.lines.length)).toBe(true);
 await service.execute(repo,{type:'operation.continue',kind:'merge',reviewToken:review.token});expect((await service.snapshot(repo)).operation.kind).toBeUndefined();
});
it('handles an absent side in comparison and explicitly accepts deletion',async()=>{
 const {root,service,repo}=await conflict(true),documents=new GitDocuments(service),details=await service.conflictDetails(repo,'file.txt');
 expect(details.theirs).toBeUndefined();expect(details.canMerge).toBe(false);
 const preview=await documents.preview(repo,{kind:'change',area:'conflict',path:'file.txt'});expect(preview.kind).toBe('text');if(preview.kind==='text')expect(preview.right).toBe('');
 await service.execute(repo,{type:'conflict.choose',token:details.token,side:'theirs'});await expect(readFile(path.join(root,'file.txt'))).rejects.toMatchObject({code:'ENOENT'});
 await service.execute(repo,{type:'resolve-and-stage',paths:['file.txt']});expect((await service.snapshot(repo)).operation.conflicts).toBe(0);
});
it('refuses stale and expired side choices and protects externally edited content',async()=>{
 const {root,service,repo}=await conflict(),details=await service.conflictDetails(repo,'file.txt');await writeFile(path.join(root,'file.txt'),'manual resolution\n');
 await expect(service.execute(repo,{type:'conflict.choose',token:details.token,side:'ours'})).rejects.toMatchObject({code:'CONFLICT_CHANGED'});
 expect(await readFile(path.join(root,'file.txt'),'utf8')).toBe('manual resolution\n');
 const fresh=await service.conflictDetails(repo,'file.txt');vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.now()+6*60_000);
 await expect(service.execute(repo,{type:'conflict.choose',token:fresh.token,side:'theirs'})).rejects.toMatchObject({code:'CONFLICT_CHANGED'});
});
it('uses the native editor when supported and falls back to working-file editing',async()=>{
 const {service,repo}=await conflict(),documents=new GitDocuments(service);
 expect(await documents.openMergeEditor(repo,'file.txt')).toEqual({mode:'merge'});expect(editor.execute).toHaveBeenCalledWith('git.openMergeEditor',expect.objectContaining({fsPath:path.join(repo.root,'file.txt')}));
 editor.native=false;expect(await documents.openMergeEditor(repo,'file.txt')).toEqual({mode:'text'});expect(editor.show).toHaveBeenCalled();
 editor.native=true;editor.fail=true;expect(await documents.openMergeEditor(repo,'file.txt')).toEqual({mode:'text'});
});
