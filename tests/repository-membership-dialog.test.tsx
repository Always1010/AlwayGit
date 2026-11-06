import { beforeEach, describe, expect, it, vi } from 'vitest';

// Drive the real dialog handlers without a desktop/browser or a second selection implementation.
const fixture = vi.hoisted(() => {
  const slots: unknown[] = [];
  let cursor = 0;
  return {
    reset() {
      slots.length = 0;
      cursor = 0;
    },
    begin() {
      cursor = 0;
    },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (value: unknown) => {
          slots[index] = typeof value === 'function' ? value(slots[index]) : value;
        },
      ];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    rpc: vi.fn(),
    close: vi.fn(),
    state: {
      repositoryCollections: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      initialize: vi.fn(async () => {}),
    },
  };
});
vi.mock('react', () => ({
  useState: fixture.useState,
  useRef: fixture.useRef,
  useMemo: (factory: () => unknown) => factory(),
  useEffect: () => {},
}));
vi.mock('react/jsx-runtime', () => ({
  Fragment: 'fragment',
  jsx: (type: unknown, props: unknown, key?: unknown) => ({ type, props, key }),
  jsxs: (type: unknown, props: unknown, key?: unknown) => ({ type, props, key }),
}));
vi.mock('../webview/store', () => ({
  useWorkbench: Object.assign(() => fixture.state, { setState: vi.fn() }),
}));
vi.mock('../webview/rpc', () => ({ rpc: fixture.rpc, subscribe: () => () => {} }));
vi.mock('../webview/i18n', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('../webview/text', () => ({ uiText: (key: string) => key }));
vi.mock('../webview/ui', () => ({ Button: 'button', Icon: 'icon', Modal: 'modal' }));

import { RepositoryGroupsDialog } from '../webview/RepositoryGroupsDialog';
import { groupRepositories } from '../src/protocol/repositories';

type Node = { type?: unknown; props: Record<string, any> };
function find(node: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = find(child, predicate);
      if (result) return result;
    }
  } else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as Node;
    if (predicate(element)) return element;
    return find(element.props.children, predicate) ?? find(element.props.footer, predicate);
  }
}
const groups = groupRepositories([
  { id: 'one', root: '/one', commonDir: '/one/.git', name: 'One', collectionIds: ['a', 'b'] },
  { id: 'two', root: '/two', commonDir: '/two/.git', name: 'Two', collectionIds: ['b'] },
]);
function render() {
  fixture.begin();
  return RepositoryGroupsDialog({ groups, onClose: fixture.close });
}
const checkbox = (tree: unknown, index: number): Node => {
  let current = 0;
  return find(
    tree,
    (node) => node.type === 'input' && node.props.type === 'checkbox' && current++ === index,
  )!;
};
const apply = (tree: unknown) =>
  find(tree, (node) => node.type === 'button' && node.props.children === 'common.apply')!;
beforeEach(() => {
  fixture.reset();
  vi.clearAllMocks();
  fixture.rpc.mockResolvedValue(1);
});
describe('repository membership dialog', () => {
  it('shows mixed memberships and submits only touched groups without overwriting other differences', async () => {
    let tree = render();
    expect(checkbox(tree, 0).props['aria-checked']).toBe('mixed');
    expect(checkbox(tree, 1).props.checked).toBe(true);
    expect(apply(tree).props.disabled).toBe(true);
    checkbox(tree, 2).props.onChange({ target: { checked: true } });
    tree = render();
    await apply(tree).props.onClick();
    // The click handler intentionally starts the async operation without returning its promise.
    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.rpc).toHaveBeenCalledWith('updateRepositoryMemberships', undefined, {
      keys: ['/one/.git', '/two/.git'],
      changes: [{ collectionId: 'c', included: true }],
    });
    expect(fixture.close).toHaveBeenCalledOnce();
  });
  it('does not save on cancel and retains a failed draft for retry', async () => {
    let tree = render();
    checkbox(tree, 1).props.onChange({ target: { checked: false } });
    tree = render();
    tree.props.onClose();
    expect(fixture.rpc).not.toHaveBeenCalled();
    fixture.close.mockClear();
    fixture.rpc.mockRejectedValueOnce(new Error('save failed'));
    await apply(tree).props.onClick();
    await Promise.resolve();
    await Promise.resolve();
    tree = render();
    expect(find(tree, (node) => node.props.role === 'alert')).toBeDefined();
    expect(checkbox(tree, 1).props.checked).toBe(false);
    expect(apply(tree).props.disabled).toBe(false);
    expect(fixture.close).not.toHaveBeenCalled();
  });
});
