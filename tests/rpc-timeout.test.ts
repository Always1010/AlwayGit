import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostMessage, RpcRequest } from '../src/protocol/types';

let receive: (event: { data: HostMessage }) => void;
const postMessage = vi.fn<(request: RpcRequest) => void>();
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); postMessage.mockClear();
  vi.stubGlobal('window', {
    acquireVsCodeApi: () => ({ postMessage }),
    addEventListener: (_type: string, listener: typeof receive) => { receive = listener; },
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('host request timeouts', () => {
  it('lets the cancellable directory scan finish after the normal Git timeout', async () => {
    const { rpc } = await import('../webview/rpc');
    const pending = rpc('addRepository');
    await vi.advanceTimersByTimeAsync(240_000);
    const result = { added: 10, existing: 2, skipped: 0, cancelled: false };
    receive({ data: { type: 'response', id: postMessage.mock.calls[0][0].id, result } });
    await expect(pending).resolves.toEqual(result);
  });
  it('keeps a timeout for ordinary Git requests', async () => {
    const { rpc } = await import('../webview/rpc');
    const rejected = expect(rpc('snapshot', 'repo')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(180_001);
    await rejected;
  });
  it('replaces obsolete reads and keeps write requests pending',async()=>{
    const {rpc}=await import('../webview/rpc');
    const write=rpc('action','repo',{type:'fetch'}),writeId=postMessage.mock.calls.at(-1)![0].id;
    const old=rpc('details','repo',{oid:'old'}),oldId=postMessage.mock.calls.at(-1)![0].id;
    const rejected=expect(old).rejects.toMatchObject({code:'ABORTED'}),latest=rpc('stashDetails','repo',{oid:'new'}),latestId=postMessage.mock.calls.at(-1)![0].id;
    await rejected;expect(postMessage.mock.calls.map(([request])=>request)).toContainEqual(expect.objectContaining({method:'cancelQuery',payload:{requestId:oldId}}));
    receive({data:{type:'response',id:oldId,result:'obsolete'}});
    receive({data:{type:'response',id:latestId,result:'latest'}});receive({data:{type:'response',id:writeId,result:'written'}});
    await expect(latest).resolves.toBe('latest');await expect(write).resolves.toBe('written');
  });
  it('cancels an explicitly aborted preview and a read timeout at the host',async()=>{
    const {rpc}=await import('../webview/rpc'),controller=new AbortController();
    const pending=rpc('diffPreview','repo',{kind:'commit',oid:'old',path:'file'},{signal:controller.signal}),id=postMessage.mock.calls.at(-1)![0].id;
    const rejected=expect(pending).rejects.toMatchObject({code:'ABORTED'});controller.abort();await rejected;
    expect(postMessage.mock.calls.at(-1)![0]).toMatchObject({method:'cancelQuery',payload:{requestId:id}});
    const timed=rpc('history','repo'),historyId=postMessage.mock.calls.at(-1)![0].id,timeout=expect(timed).rejects.toMatchObject({code:'TIMEOUT'});
    await vi.advanceTimersByTimeAsync(180_001);await timeout;
    expect(postMessage.mock.calls.at(-1)![0]).toMatchObject({method:'cancelQuery',payload:{requestId:historyId}});
  });
  it('cancels reads from the previous repository when the new snapshot starts',async()=>{
    const {rpc}=await import('../webview/rpc'),old=rpc('history','old'),rejected=expect(old).rejects.toMatchObject({code:'ABORTED'});
    const snapshot=rpc('snapshot','new'),id=postMessage.mock.calls.at(-1)![0].id;await rejected;
    receive({data:{type:'response',id,result:'new'}});await expect(snapshot).resolves.toBe('new');
  });
  it('keeps Demo read requests compatible with optional cancellation',async()=>{
    vi.stubGlobal('window',{addEventListener:()=>{}});vi.stubGlobal('location',{search:'?demo=1'});vi.stubGlobal('localStorage',{getItem:()=>null});
    const {rpc}=await import('../webview/rpc');const history=rpc<{commits:unknown[]}>('history','demo-alwaygit');await vi.advanceTimersByTimeAsync(111);expect((await history).commits.length).toBeGreaterThan(0);
    const controller=new AbortController(),preview=rpc('diffPreview','demo-alwaygit',{path:'sample.ts'},{signal:controller.signal}),rejected=expect(preview).rejects.toMatchObject({code:'ABORTED'});controller.abort();await vi.advanceTimersByTimeAsync(111);await rejected;expect(postMessage).not.toHaveBeenCalled();
  });
});
