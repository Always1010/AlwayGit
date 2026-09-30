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
});
