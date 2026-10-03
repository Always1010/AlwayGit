import { afterEach, expect, it, vi } from 'vitest';
import { SessionPersistence } from '../webview/session-persistence';
import { mergeSessionBaseline, SessionWriter } from '../src/application/session-persistence';
import type { SessionState } from '../src/protocol/session';
import { legacyInterfaceSettings, mergeInterfaceSettings, overlayInterfaceSettings } from '../src/protocol/interface-settings';

afterEach(() => vi.useRealTimers());
it('restores latest user preferences over an old panel without changing geometry, browsing state or drafts', () => {
  const old: SessionState = { language: 'zh-CN', appearance: { theme: 'paper', palette: 'vivid', codeFont: 15 },
    layout: { preset: 'workbench', sidebar: 230, details: 310, diff: 720, author: 100, date: 120, font: 16, row: 28 },
    repoId: 'a', drafts: { a: 'keep' }, views: { a: { search: 'query', tab: 'changes' } }, singleKeyShortcuts: false };
  expect(legacyInterfaceSettings(old)).toMatchObject({ language: 'zh-CN', font: 16, row: 28, appearance: { theme: 'paper' } });
  expect(legacyInterfaceSettings(old)).not.toHaveProperty('drafts');
  const restored = overlayInterfaceSettings(old, { language: 'en', appearance: { theme: 'forest', palette: 'distinct', codeFont: 12 }, font: 13 });
  expect(restored).toMatchObject({ language: 'en', layout: { sidebar: 230, diff: 720, font: 13, row: 24 }, singleKeyShortcuts: true,
    appearance: { theme: 'forest' }, repoId: 'a', drafts: old.drafts, views: old.views });
  expect(overlayInterfaceSettings({}, { font: 16, row: 28 }).layout).toMatchObject({ font: 16, row: 28 });
  expect(mergeInterfaceSettings({ appearance: old.appearance, font: 16 }, { appearance: { theme: 'dark' } })).toMatchObject({ appearance: { theme: 'dark', codeFont: 15 }, font: 16 });
});
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

it('flushes a closing editor immediately and preserves newer drafts while a host write is pending', async () => {
  vi.useFakeTimers();
  const first = deferred(), host = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
  const persistence = new SessionPersistence(vi.fn(), host);
  persistence.save({ draft: 'first' }); persistence.flushNow();
  expect(host).toHaveBeenCalledWith({ draft: 'first' });
  persistence.save({ draft: 'latest' }); persistence.flushNow();
  expect(host).toHaveBeenCalledTimes(1);
  first.resolve(); await vi.advanceTimersByTimeAsync(1);
  expect(host.mock.calls.map(([value]) => value.draft)).toEqual(['first', 'latest']);
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

it('merges queued panel changes without restoring another panel’s old drafts or views', async () => {
  const baseline: SessionState = { repoId: 'a', drafts: { a: 'old A', b: 'old B' }, views: { a: { search: 'old', tab: 'history' } } };
  let current = baseline;
  const writer = new SessionWriter(value => { current = value; return Promise.resolve(); });
  const a: SessionState = { ...baseline, drafts: { a: 'new A', b: 'old B' }, views: { a: { search: 'new', tab: 'history' } } };
  const b: SessionState = { ...baseline, repoId: 'b', drafts: { a: 'old A', b: 'new B' } };
  await Promise.all([writer.save(() => mergeSessionBaseline(current, a, baseline)), writer.save(() => mergeSessionBaseline(current, b, baseline))]);
  expect(current).toMatchObject({ repoId: 'b', drafts: { a: 'new A', b: 'new B' }, views: { a: { search: 'new' } } });
  current = mergeSessionBaseline(current, a, a);
  expect(current.drafts).toEqual({ a: 'new A', b: 'new B' });
  const blank = mergeSessionBaseline(current, { ...baseline, repoId: undefined, language: 'zh-CN' }, baseline, true);
  expect(blank).toMatchObject({ repoId: 'a', language: 'zh-CN', drafts: { a: 'new A', b: 'new B' }, views: { a: { search: 'new' } } });
  expect(mergeSessionBaseline(current, { ...a, drafts: { a: '', b: 'old B' } }, a).drafts).toEqual({ a: '', b: 'new B' });
});
