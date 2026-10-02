import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../src/protocol/types';

beforeEach(()=>{
  vi.resetModules();vi.useFakeTimers();
  vi.stubGlobal('window',{addEventListener:vi.fn()});
  vi.stubGlobal('location',{search:'?demo=1'});
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn()});
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe('demo Stash state preservation',()=>{
  it('saves selected whole files, preserves other changes, and restores staged and untracked states',async()=>{
    const {rpc}=await import('../webview/rpc');
    const request=async<T>(method:Parameters<typeof rpc>[0],payload?:unknown)=>{const result=rpc<T>(method,'demo-alwaygit',payload);await vi.advanceTimersByTimeAsync(110);return result;};
    const before=await request<Snapshot>('snapshot'),paths=['webview/App.tsx','docs/workbench-notes.md'];
    await request('action',{type:'stash.create',paths:[...paths,paths[0]],message:'selected'});
    const stashed=await request<Snapshot>('snapshot'),saved=stashed.stashes[0];
    expect(stashed.changes).toEqual(before.changes.filter(change=>!paths.includes(change.path)));
    await request('action',{type:'stash.apply',selector:saved.selector,expectedOid:saved.oid});
    const restored=await request<Snapshot>('snapshot');
    expect([...restored.changes].sort((a,b)=>a.path.localeCompare(b.path))).toEqual([...before.changes].sort((a,b)=>a.path.localeCompare(b.path)));
    expect(restored.stashes.some(stash=>stash.oid===saved.oid)).toBe(true);
  });
  it('keeps untracked files when all-change Stash excludes them',async()=>{
    const {rpc}=await import('../webview/rpc');
    const action=rpc('action','demo-alwaygit',{type:'stash.create',includeUntracked:false});await vi.advanceTimersByTimeAsync(110);await action;
    const pending=rpc<Snapshot>('snapshot','demo-alwaygit');await vi.advanceTimersByTimeAsync(110);
    expect((await pending).changes).toEqual([{path:'docs/workbench-notes.md',indexStatus:'?',worktreeStatus:'?',conflict:false,untracked:true}]);
  });
  it('stops an overlapping restore as a whole and retains its saved entry',async()=>{
    const {rpc}=await import('../webview/rpc');
    const request=async<T>(method:Parameters<typeof rpc>[0],payload?:unknown)=>{const result=rpc<T>(method,'demo-alwaygit',payload);await vi.advanceTimersByTimeAsync(110);return result;};
    const before=await request<Snapshot>('snapshot');
    await request('action',{type:'stash.create',paths:['webview/App.tsx','webview/styles.css'],includeUntracked:true});
    const stash=(await request<Snapshot>('snapshot')).stashes[0];
    await request('action',{type:'stash.apply',selector:stash.selector,expectedOid:stash.oid});
    const unchanged=await request<Snapshot>('snapshot');
    const pending=rpc('action','demo-alwaygit',{type:'stash.apply',selector:stash.selector,expectedOid:stash.oid,pop:true});
    const rejection=expect(pending).rejects.toMatchObject({details:{reason:'restore-conflict',paths:['webview/App.tsx','webview/styles.css'],workingTreeUnchanged:true,stashRetained:true}});
    await vi.advanceTimersByTimeAsync(110);await rejection;
    expect(await request<Snapshot>('snapshot')).toEqual(unchanged);
    expect(unchanged.changes).toHaveLength(before.changes.length);
  });
});
