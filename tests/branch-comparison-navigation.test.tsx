import { afterEach, expect, it, vi } from 'vitest';
import type { BranchComparison as Comparison, Commit, CommitDetails } from '../src/protocol/types';

type HookSlot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
const fixture = vi.hoisted(() => {
  const slots: HookSlot[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  return {
    rpc: vi.fn(),
    begin() {
      cursor = 0;
    },
    flush() {
      const pending = effects;
      effects = [];
      for (const effect of pending) effect();
    },
    reset() {
      for (const slot of slots) slot.cleanup?.();
      slots.length = 0;
      effects = [];
    },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: initial };
      return [
        slots[index].value,
        (next: unknown) => {
          slots[index].value =
            typeof next === 'function'
              ? (next as (current: unknown) => unknown)(slots[index].value)
              : next;
        },
      ];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: { current: initial } };
      return slots[index].value;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = cursor++,
        previous = slots[index];
      if (previous?.deps?.every((value, index) => Object.is(value, deps[index]))) return;
      effects.push(() => {
        previous?.cleanup?.();
        const cleanup = effect();
        slots[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
      });
    },
  };
});
vi.mock('react', () => ({
  useState: fixture.useState,
  useRef: fixture.useRef,
  useEffect: fixture.useEffect,
}));
vi.mock('react/jsx-runtime', () => ({
  jsx: (type: unknown, props: unknown) => ({ type, props }),
  jsxs: (type: unknown, props: unknown) => ({ type, props }),
}));
vi.mock('../webview/rpc', () => ({ rpc: fixture.rpc }));
vi.mock('../webview/subscriptions', () => ({ useWorkbenchFields: () => ({}) }));
vi.mock('../webview/i18n', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('../webview/ui', () => ({
  Button: 'button',
  Empty: 'empty',
  Icon: 'icon',
  Modal: 'modal',
}));
vi.mock('../webview/VirtualFileRows', () => ({ VirtualFileRows: 'file-rows' }));
vi.mock('../webview/DiffPreview', () => ({ DiffPreview: 'diff-preview' }));

import { BranchComparison } from '../webview/BranchComparison';

type Node = { type: unknown; props: Record<string, any> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  const children =
    node.type === 'file-rows' ? node.props.items.map(node.props.children) : node.props.children;
  return [node, ...nodes(children)];
}
function render() {
  fixture.begin();
  const tree = nodes(
    BranchComparison({
      repoId: 'repo',
      initialBase: 'refs/heads/main',
      initialTarget: 'HEAD',
      onClose() {},
    }),
  );
  fixture.flush();
  return tree;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}
const commit = (letter: string): Commit => ({
  oid: letter.repeat(40),
  parents: [],
  author: 'Author',
  email: 'author@example.com',
  timestamp: 1,
  subject: letter,
});
const details = (letter: string): CommitDetails => ({
  commit: commit(letter),
  body: `Message ${letter}`,
  files: [{ path: `${letter}.txt`, status: 'M' }],
});
const comparison: Comparison = {
  baseRef: 'refs/heads/main',
  targetRef: 'HEAD',
  baseOid: 'd'.repeat(40),
  targetOid: 'e'.repeat(40),
  mode: 'review',
  mergeBases: ['d'.repeat(40)],
  diffBase: 'd'.repeat(40),
  files: [{ path: 'comparison.txt', status: 'M' }],
  base: { commits: [], total: 0, nextOffset: 0, hasMore: false },
  target: { commits: ['a', 'b', 'c'].map(commit), total: 3, nextOffset: 3, hasMore: false },
};
const clickCommit = (tree: Node[], letter: string) =>
  tree
    .find((node) => node.type === 'button' && node.props.title?.startsWith(letter.repeat(40)))!
    .props.onClick();
const preview = (tree: Node[]) => tree.find((node) => node.type === 'diff-preview')!.props;
const busy = (tree: Node[]) =>
  tree.find((node) => node.props.className === 'comparison-content')!.props['aria-busy'];
const back = (tree: Node[]) => tree.find((node) => node.props['aria-label'] === 'comparison.back');

afterEach(() => {
  fixture.reset();
  fixture.rpc.mockReset();
});

it.each(['resolve', 'reject'] as const)(
  'keeps Back authoritative when an abandoned inspection later %ss',
  async (outcome) => {
    const pending = deferred<CommitDetails>(),
      next = deferred<CommitDetails>();
    fixture.rpc.mockImplementation((method: string, _repoId: string, payload: { oid?: string }) => {
      if (method === 'branchComparison') return Promise.resolve(comparison);
      if (payload.oid === commit('a').oid) return Promise.resolve(details('a'));
      return payload.oid === commit('b').oid ? pending.promise : next.promise;
    });
    render();
    await Promise.resolve();
    clickCommit(render(), 'a');
    await Promise.resolve();
    let tree = render();
    tree.find((node) => node.type === 'input')!.props.onChange({ target: { value: 'a' } });
    clickCommit(render(), 'b');
    tree = render();
    expect(busy(tree)).toBe(true);
    const signal = fixture.rpc.mock.calls.at(-1)![3].signal as AbortSignal;
    back(tree)!.props.onClick();
    tree = render();
    expect(signal.aborted).toBe(true);
    expect(busy(tree)).toBe(false);
    expect(back(tree)).toBeUndefined();
    expect(tree.find((node) => node.type === 'input')!.props.value).toBe('');
    expect(preview(tree).isolated.target).toBeUndefined();

    tree
      .find((node) => node.type === 'button' && node.props.title === 'comparison.txt')!
      .props.onClick();
    expect(preview(render()).isolated.target).toMatchObject({ kind: 'comparison' });
    if (outcome === 'resolve') pending.resolve(details('b'));
    else pending.reject(new Error('stale inspection failure'));
    await Promise.resolve();
    tree = render();
    expect(back(tree)).toBeUndefined();
    expect(tree.some((node) => node.props.role === 'alert')).toBe(false);
    expect(busy(tree)).toBe(false);
    expect(preview(tree).isolated.target).toMatchObject({
      kind: 'comparison',
      path: 'comparison.txt',
    });

    clickCommit(tree, 'c');
    expect(busy(render())).toBe(true);
    next.resolve(details('c'));
    await Promise.resolve();
    tree = render();
    expect(busy(tree)).toBe(false);
    expect(preview(tree).isolated.target).toMatchObject({
      kind: 'commit',
      oid: commit('c').oid,
      path: 'c.txt',
    });
  },
);
