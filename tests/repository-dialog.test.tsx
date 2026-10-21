import { beforeEach, describe, expect, it, vi } from 'vitest';

// Drive the real dialog handlers without a desktop/browser or a second selection implementation.
const fixture = vi.hoisted(() => {
  const slots: unknown[] = [];
  let cursor = 0;
  return {
    reset() { slots.length = 0; cursor = 0; },
    begin() { cursor = 0; },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value: unknown) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    rpc: vi.fn(), close: vi.fn(),
    state: { repositoryCollections: [], initialize: vi.fn(async () => {}) },
  };
});
vi.mock('react', () => ({ useState: fixture.useState, useRef: fixture.useRef, useMemo: (factory: () => unknown) => factory(), useEffect: () => {} }));
vi.mock('react/jsx-runtime', () => ({ Fragment: 'fragment', jsx: (type: unknown, props: unknown, key?: unknown) => ({ type, props, key }), jsxs: (type: unknown, props: unknown, key?: unknown) => ({ type, props, key }) }));
vi.mock('../webview/store', () => ({ useWorkbench: Object.assign(() => fixture.state, { setState: vi.fn() }) }));
vi.mock('../webview/rpc', () => ({ rpc: fixture.rpc, subscribe: () => () => {} }));
vi.mock('../webview/i18n', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('../webview/text', () => ({ uiText: (key: string) => key }));
vi.mock('../webview/ui', () => ({ Button: 'button', Icon: 'icon', Modal: 'modal' }));

import { RepositoryDialog } from '../webview/RepositoryDialog';

type Node = { type?: unknown; key?: unknown; props: Record<string, any> };
function find(node: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const result = find(child, predicate); if (result) return result; }
  } else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as Node;
    if (predicate(element)) return element;
    return find(element.props.children, predicate) ?? find(element.props.footer, predicate);
  }
}
function render() { fixture.begin(); return RepositoryDialog({ onClose: fixture.close }); }
function checkbox(key: string): Node {
  const row = find(render(), node => node.type === 'label' && node.key === key);
  return find(row, node => node.type === 'input' && node.props.type === 'checkbox')!;
}
function click(key: string, modifiers: { shiftKey?: boolean; ctrlKey?: boolean } = {}) {
  checkbox(key).props.onClick({ preventDefault() {}, shiftKey: false, ctrlKey: false, metaKey: false, ...modifiers });
}
function selectAll(checked: boolean) {
  const label = find(render(), node => node.type === 'label' && node.props.children?.includes?.('repositoriesDialog.selectAllAvailable'));
  find(label, node => node.type === 'input')!.props.onChange({ target: { checked } });
}
async function add() {
  find(render(), node => node.type === 'button' && node.props.children === 'repositoriesDialog.addRepositories')!.props.onClick();
  await vi.waitFor(() => expect(fixture.close).toHaveBeenCalledOnce());
  return fixture.rpc.mock.calls.find(([method]) => method === 'addRepository')![2].keys;
}
beforeEach(async () => {
  fixture.reset(); vi.clearAllMocks();
  fixture.rpc.mockImplementation(async (method: string) => {
    if (method === 'pickRepositoryDirectory') return '/repos';
    if (method === 'discoverRepositories') return { candidates: ['A', 'B', 'C'].map(key => ({ key, name: key, path: `/repos/${key}`, existing: false })), issues: [], cancelled: false };
    if (method === 'addRepository') return { added: 2, existing: 0, skipped: 0 };
  });
  find(render(), node => node.type === 'button' && node.props.children === 'repositoriesDialog.chooseFolder')!.props.onClick();
  await vi.waitFor(() => expect(find(render(), node => node.type === 'label' && node.key === 'C')).toBeDefined());
});

describe('repository discovery checkboxes', () => {
  it('unchecks one default-selected repository without replacing the rest of the submitted selection', async () => {
    expect(['A', 'B', 'C'].map(key => checkbox(key).props.checked)).toEqual([true, true, true]);
    click('B');
    expect(['A', 'B', 'C'].map(key => checkbox(key).props.checked)).toEqual([true, false, true]);
    expect(await add()).toEqual(['A', 'C']);
  });
  it('accumulates independent checkbox clicks after clearing all repositories', async () => {
    selectAll(false); click('A'); click('B');
    expect(['A', 'B', 'C'].map(key => checkbox(key).props.checked)).toEqual([true, true, false]);
    expect(await add()).toEqual(['A', 'B']);
  });
  it('preserves Shift range selection and modifier toggles', async () => {
    selectAll(false); click('A'); click('C', { shiftKey: true }); click('B', { ctrlKey: true });
    expect(await add()).toEqual(['A', 'C']);
  });
});
