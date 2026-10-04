import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitService } from '../src/git/service';
import { GitReadTerminationError } from '../src/git/error';
import { runGitProcess, type GitResult } from '../src/git/runner';
vi.mock('../src/git/runner',()=>({runGitProcess:vi.fn()}));

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};}
async function settle(){for(let i=0;i<12;i++)await Promise.resolve();}
const repo={id:'read-scope',root:process.cwd(),commonDir:process.cwd(),name:'read-scope'};
beforeEach(()=>vi.clearAllMocks());

describe('Git read request lifetime',()=>{
  it('rejects a direct Stash deletion before any read or filesystem mutation in a query scope',async()=>{
    const service=new GitService();
    await expect(service.withReadSignal(new AbortController().signal,()=>service.execute(repo,{type:'stash.drop',selector:'stash@{0}',expectedOid:'a'.repeat(40)}))).rejects.toMatchObject({code:'WRITE_IN_READ_SCOPE'});
    expect(runGitProcess).not.toHaveBeenCalled();
  });
  it('aborts siblings and aggregates their handle completion after a parallel read fails early',async()=>{
    const service=new GitService();vi.spyOn(service,'discover').mockResolvedValue(repo);
    const first=deferred<GitResult>(),second=deferred<GitResult>(),firstClosed=deferred<void>(),secondClosed=deferred<void>();
    const signals:AbortSignal[]=[];
    vi.mocked(runGitProcess).mockImplementation(options=>{
      signals.push(options.signal!);
      if(options.args.includes('ls-files')){const name=options.args.at(-1)!;return Promise.resolve({stdout:Buffer.from(`100644 ${name==='a.txt'?'a':'b'} 0\t${name}\0`),stderr:Buffer.alloc(0),code:0});}
      return options.args.at(-1)==='a'?first.promise:second.promise;
    });
    const caller=service.withReadSignal(new AbortController().signal,()=>Promise.all([service.content(repo,{kind:'index',path:'a.txt'}),service.content(repo,{kind:'index',path:'b.txt'})]));
    const failed=caller.then(()=>{throw new Error('Expected cancellation');},error=>error as Error&{completion:Promise<void>});await settle();expect(runGitProcess).toHaveBeenCalledTimes(4);
    first.reject(new GitReadTerminationError('aborted','ABORTED',1,firstClosed.promise));const error=await failed;
    expect(signals.every(signal=>signal.aborted)).toBe(true);
    let completed=false;void error.completion.then(()=>{completed=true;});firstClosed.resolve();await settle();expect(completed).toBe(false);
    second.reject(new GitReadTerminationError('aborted','ABORTED',2,secondClosed.promise));await settle();expect(completed).toBe(false);
    secondClosed.resolve();await error.completion;expect(completed).toBe(true);
  });
});
