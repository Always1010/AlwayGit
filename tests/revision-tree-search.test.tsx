import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RevisionTreeListing, RevisionTreeSearchPage } from '../src/protocol/tree';

type Effect = () => void | (() => void);
type HookSlot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };

const fixture = vi.hoisted(() => {
  const slots: HookSlot[] = [];
  let cursor = 0;
  let pending: (() => void)[] = [];
  const sameDependencies = (left?: unknown[], right?: unknown[]) => !!left && !!right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = {
    reset() { for (const slot of slots) slot.cleanup?.(); slots.length = 0; cursor = 0; pending = []; },
    begin() { cursor = 0; },
    flush() { const effects = pending; pending = []; for (const effect of effects) effect(); },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? (initial as () => unknown)() : initial };
      return [slots[index].value, (next: unknown) => { slots[index].value = typeof next === 'function' ? (next as (current: unknown) => unknown)(slots[index].value) : next; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: { current: initial } };
      return slots[index].value;
    },
    useMemo(factory: () => unknown, dependencies: unknown[]) {
      const index = cursor++, slot = slots[index];
      if (!slot || !sameDependencies(slot.deps, dependencies)) slots[index] = { value: factory(), deps: dependencies };
      return slots[index].value;
    },
    useEffect(effect: Effect, dependencies: unknown[]) {
      const index = cursor++, previous = slots[index];
      if (sameDependencies(previous?.deps, dependencies)) return;
      pending.push(() => {
        previous?.cleanup?.();
        const cleanup = effect();
        slots[index] = { deps: dependencies, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
      });
    },
  };
  return {
    hooks,
    state: { repoId: 'repo-a', report: vi.fn(), selectFile: vi.fn(), selectedFile: undefined as string | undefined },
    rpc: vi.fn(),
  };
});

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: fixture.hooks.useEffect,
  useMemo: fixture.hooks.useMemo,
  useRef: fixture.hooks.useRef,
  useState: fixture.hooks.useState,
}));
vi.mock('react/jsx-runtime', () => ({
  Fragment: 'fragment',
  jsx: (type: unknown, props: unknown, key?: unknown) => ({ type, props, key }),
  jsxs: (type: unknown, props: unknown, key?: unknown) => ({ type, props, key }),
}));
vi.mock('../webview/rpc', () => ({ rpc: fixture.rpc }));
vi.mock('../webview/subscriptions', () => ({ useWorkbenchFields: () => fixture.state }));
vi.mock('../webview/i18n', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('../webview/ui', () => ({ Button: 'button', Empty: 'empty', Icon: 'icon' }));
vi.mock('../webview/VirtualFileRows', () => ({ VirtualFileRows: 'virtual-file-rows' }));

import { RevisionTree } from '../webview/RevisionTree';

type Node = { type?: unknown; props?: Record<string, unknown> };

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

function find(node: unknown, predicate: (value: Node) => boolean): Node {
  if (Array.isArray(node)) {
    for (const child of node) { const match = findOptional(child, predicate); if (match) return match; }
  } else if (node && typeof node === 'object') {
    const value = node as Node;
    if (predicate(value)) return value;
    const match = findOptional(value.props?.children, predicate);
    if (match) return match;
  }
  throw new Error('Expected element was not rendered');
}

function findOptional(node: unknown, predicate: (value: Node) => boolean): Node | undefined {
  try { return find(node, predicate); } catch { return undefined; }
}

function render() {
  fixture.hooks.begin();
  const tree = RevisionTree({ revision: 'a'.repeat(40), context: () => {} });
  fixture.hooks.flush();
  return tree;
}

async function settle() { await Promise.resolve(); await Promise.resolve(); }

describe('revision tree search pagination', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.stubGlobal('window', { setTimeout, clearTimeout }); fixture.hooks.reset(); fixture.rpc.mockReset(); fixture.state.report.mockReset(); fixture.state.repoId = 'repo-a';
  });
  afterEach(() => { fixture.hooks.reset(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it.each(['resolve', 'reject'] as const)('ignores a stale load-more %s after clearing the query', async outcome => {
    const first = deferred<RevisionTreeSearchPage>(), more = deferred<RevisionTreeSearchPage>();
    const revision = 'a'.repeat(40), entry = { name: 'first.txt', path: 'first.txt', oid: 'b'.repeat(40), mode: '100644', type: 'blob' as const, size: 1 };
    fixture.rpc.mockImplementation((method: string, _repoId: string, payload: { cursor?: number }) => {
      if (method === 'revisionTree') return Promise.resolve({ revision, path: '', entries: [] } satisfies RevisionTreeListing);
      return payload.cursor === undefined ? first.promise : more.promise;
    });

    let tree = render(); await settle(); tree = render();
    const input = find(tree, node => node.type === 'input');
    (input.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'first' } });
    render(); await vi.advanceTimersByTimeAsync(250);
    first.resolve({ revision, query: 'first', entries: [entry], nextCursor: 1, truncated: false }); await settle();
    tree = render();
    const loadMore = find(tree, node => node.type === 'button' && node.props?.children === 'tree.loadMore');
    (loadMore.props!.onClick as () => void)();
    const clear = find(tree, node => node.type === 'button' && node.props?.['aria-label'] === 'tree.clearSearch');
    (clear.props!.onClick as () => void)();
    tree = render();
    expect(find(tree, node => node.type === 'input').props?.value).toBe('');

    if (outcome === 'resolve') more.resolve({ revision, query: 'first', entries: [{ ...entry, name: 'stale.txt', path: 'stale.txt' }], nextCursor: 2, truncated: false });
    else more.reject(new Error('stale failure'));
    await settle(); tree = render();

    expect(findOptional(tree, node => node.type === 'button' && node.props?.children === 'tree.loadMore')).toBeUndefined();
    expect(fixture.state.report).not.toHaveBeenCalled();
    expect(findOptional(tree, node => node.props?.className === 'revision-tree-error')).toBeUndefined();
  });
});
