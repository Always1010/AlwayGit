import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      appearance: { currentBranchColor: '#000000', currentRepositoryColor: '#000000' },
      collapsedSidebarGroups: [],
      repoId: 'one',
      catalogState: 'ready',
      repositories: [
        { id: 'one', root: '/one', commonDir: '/one/.git', name: 'One', collectionIds: ['a', 'b'] },
        { id: 'two', root: '/two', commonDir: '/two/.git', name: 'Two' },
      ],
      repositoryCollections: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      repositoryStatuses: {},
      selectedRepositoryKeys: [] as string[],
      repositorySelectionAnchor: undefined as string | undefined,
      selectedRefs: [],
      selectedWorktreePaths: [],
      initialize: vi.fn(async () => {}),
      reorderRepository: vi.fn(async () => {}),
      setRepositorySelection: vi.fn(),
      report: vi.fn(),
    },
  };
});
vi.mock('react', () => ({
  createElement: (type: unknown, props: Record<string, unknown>, ...children: unknown[]) => ({
    type,
    props: { ...props, children },
  }),
  memo: (component: unknown) => component,
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
  useWorkbench: Object.assign(() => fixture.state, {
    setState: vi.fn(),
    getState: () => fixture.state,
  }),
}));
vi.mock('../webview/rpc', () => ({ rpc: fixture.rpc, subscribe: () => () => {} }));
vi.mock('../webview/i18n', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('../webview/text', () => ({ uiText: (key: string) => key }));
vi.mock('../webview/ui', () => ({ Button: 'button', Icon: 'icon', Modal: 'modal' }));

vi.mock('../webview/subscriptions', () => ({
  useWorkbenchFields: () => fixture.state,
  useSnapshotFields: () => undefined,
}));
vi.mock('../webview/operationSelection', () => ({
  useOperationSelection: () => ({ current: null }),
}));
vi.mock('../webview/TagRemoteStatus', () => ({
  TagStatus: 'tag',
  TagRemoteControls: 'tags',
  useTagEntries: () => [],
}));
import { Sidebar } from '../webview/Sidebar';
import { repositoryRowKey } from '../webview/repositoryOrder';
import { repositoryDrop } from '../webview/repositoryDrag';

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
    return find(element.props.children, predicate);
  }
}
function render() {
  fixture.begin();
  return Sidebar({
    context: vi.fn(),
    actions: () => [],
    checkoutBranch: vi.fn(),
    openWorktree: vi.fn(),
    openOverview: vi.fn(),
  });
}
const event = (ratio = 0.5) => ({
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  clientY: ratio * 24,
  currentTarget: { closest: () => null, getBoundingClientRect: () => ({ top: 0, height: 24 }) },
  dataTransfer: { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '', dropEffect: '' },
});
const row = (tree: unknown, key: string) =>
  find(tree, (node) => node.props['data-repository-row'] === key)!;
const handle = (tree: unknown) =>
  find(tree, (node) => node.props.className?.includes('repository-drag-handle'))!;
const heading = (tree: unknown, id: string) =>
  find(tree, (node) => node.props['data-repository-order-key'] === 'collection:' + id)!;
const flush = async () => {
  for (let index = 0; index < 6; index++) await Promise.resolve();
};
beforeEach(() => {
  fixture.reset();
  vi.clearAllMocks();
  fixture.rpc.mockResolvedValue(1);
  fixture.state.selectedRepositoryKeys = [];
  fixture.state.setRepositorySelection.mockImplementation((keys) => {
    fixture.state.selectedRepositoryKeys = keys;
  });
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => callback());
});
describe('repository drag interactions', () => {
  it('moves the dragged occurrence and preserves the source repository without activating it', async () => {
    const sourceKey = repositoryRowKey({ key: '/one/.git', collectionId: 'a' });
    let tree = render();
    handle(row(tree, sourceKey)).props.onDragStart(event());
    tree = render();
    const target = heading(tree, 'c'),
      over = event();
    target.props.onDragOver(over);
    expect(over.preventDefault).toHaveBeenCalled();
    target.props.onDrop(event());
    await flush();
    expect(fixture.rpc).toHaveBeenCalledWith('moveRepositoryRows', undefined, {
      rows: [{ key: '/one/.git', collectionId: 'a' }],
      targetCollectionId: 'c',
    });
    expect(fixture.state.repoId).toBe('one');
    expect(fixture.state.selectedRepositoryKeys).toEqual([
      repositoryRowKey({ key: '/one/.git', collectionId: 'c' }),
    ]);
  });
  it('moves selected occurrences in visual order, including two occurrences of one repository', async () => {
    const a = repositoryRowKey({ key: '/one/.git', collectionId: 'a' }),
      b = repositoryRowKey({ key: '/one/.git', collectionId: 'b' });
    fixture.state.selectedRepositoryKeys = [b, a];
    let tree = render();
    handle(row(tree, b)).props.onDragStart(event());
    tree = render();
    heading(tree, 'c').props.onDrop(event());
    await flush();
    expect(fixture.rpc).toHaveBeenCalledWith('moveRepositoryRows', undefined, {
      rows: [
        { key: '/one/.git', collectionId: 'a' },
        { key: '/one/.git', collectionId: 'b' },
      ],
      targetCollectionId: 'c',
    });
  });
  it('distinguishes a group center from root insertion edges and cancels without saving', () => {
    let tree = render();
    handle(row(tree, '/two/.git')).props.onDragStart(event());
    tree = render();
    heading(tree, 'a').props.onDragOver(event(0.1));
    tree = render();
    expect(heading(tree, 'a').props['data-drop-position']).toBe('before');
    heading(tree, 'a').props.onDragOver(event());
    tree = render();
    expect(heading(tree, 'a').props['data-drop-position']).toBeUndefined();
    expect(find(tree, (node) => node.props.role === 'status')).toBeDefined();
    handle(row(tree, '/two/.git')).props.onDragEnd();
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect(fixture.state.reorderRepository).not.toHaveBeenCalled();
  });
  it('reports failed saves without moving selection or leaving a busy drag', async () => {
    const key = repositoryRowKey({ key: '/one/.git', collectionId: 'a' });
    fixture.state.selectedRepositoryKeys = [key];
    fixture.rpc.mockRejectedValueOnce(new Error('save failed'));
    let tree = render();
    handle(row(tree, key)).props.onDragStart(event());
    tree = render();
    heading(tree, 'c').props.onDrop(event());
    await flush();
    expect(fixture.state.report).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'save failed' }),
    );
    expect(fixture.state.selectedRepositoryKeys).toEqual([key]);
    tree = render();
    expect(handle(row(tree, key)).props.draggable).toBe(true);
    expect(find(tree, (node) => node.props.className === 'repository-root-drop')).toBeUndefined();
  });
  it('makes root removal explicit and rejects group nesting and batch sorting', () => {
    const source = {
      key: 'repository:one',
      collectionId: 'a',
      rows: [{ key: 'one', collectionId: 'a' }],
    };
    expect(repositoryDrop(source, { kind: 'root' })).toEqual({ kind: 'move', collectionId: null });
    expect(
      repositoryDrop(
        { key: 'collection:a', collectionId: null, rows: [] },
        { kind: 'collection', collectionId: 'b' },
      ),
    ).toBeUndefined();
    expect(
      repositoryDrop(
        { ...source, rows: [...source.rows, { key: 'two', collectionId: 'a' }] },
        { kind: 'entry', key: 'repository:three', collectionId: 'a', ratio: 0.2 },
      ),
    ).toBeUndefined();
    expect(repositoryDrop(source, { kind: 'collection', collectionId: 'a' })).toBeUndefined();
  });
});

afterEach(() => vi.unstubAllGlobals());
