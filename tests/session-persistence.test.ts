import { afterEach, expect, it, vi } from 'vitest';
import { SessionPersistence } from '../webview/session-persistence';
import { SessionWriter } from '../src/application/session-persistence';

afterEach(() => vi.useRealTimers());
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

it('saves local state immediately and sends only the latest pending state after the prior acknowledgement', async () => {
  vi.useFakeTimers();
  const local = vi.fn(), first = deferred(), host = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
  const persistence = new SessionPersistence(local, host);
  persistence.save({ draft: 'a' });
  expect(local).toHaveBeenLastCalledWith({ draft: 'a' });
  await vi.advanceTimersByTimeAsync(200);
  persistence.save({ draft: 'b' }); persistence.save({ draft: 'c' });
  await vi.advanceTimersByTimeAsync(200);
  expect(host).toHaveBeenCalledTimes(1);
  first.resolve(); await vi.advanceTimersByTimeAsync(1);
  expect(host.mock.calls.map(([state]) => state.draft)).toEqual(['a', 'c']);
});

it('retries a rejected host save without losing the local copy and reports a bounded failure', async () => {
  vi.useFakeTimers();
  const local = vi.fn(), host = vi.fn().mockRejectedValue(new Error('storage full')), error = vi.fn();
  const persistence = new SessionPersistence(local, host);
  persistence.save({ draft: 'keep me' }, error);
  await vi.advanceTimersByTimeAsync(5000);
  expect(host).toHaveBeenCalledTimes(3); expect(error).toHaveBeenCalledTimes(1);
  expect(local).toHaveBeenCalledWith({ draft: 'keep me' });
  host.mockResolvedValue(undefined); persistence.save({ draft: 'new text' }, error);
  await vi.advanceTimersByTimeAsync(200);
  expect(host).toHaveBeenLastCalledWith({ draft: 'new text' });
});

it('serializes host writes and continues after a rejected write', async () => {
  const first = deferred(), write = vi.fn().mockImplementationOnce(() => first.promise).mockRejectedValueOnce(new Error('disk')).mockResolvedValue(undefined);
  const writer = new SessionWriter(write);
  const a = writer.save({ language: 'en' }), b = writer.save({ language: 'zh-CN' }), rejected = expect(b).rejects.toThrow('disk');
  const c = writer.save({ drafts: { a: 'latest' } });
  await Promise.resolve(); await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(1);
  first.resolve(); await a; await rejected; await c;
  expect(write.mock.calls.map(([value]) => value)).toEqual([{ language: 'en' }, { language: 'zh-CN' }, { drafts: { a: 'latest' } }]);
});
