import { afterEach, expect, it, vi } from 'vitest';
import { operationTasks } from '../webview/operationTasks';

const fixture = vi.hoisted(() => ({ rpc: vi.fn(async () => true) }));
vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react/jsx-runtime', () => ({
  Fragment: 'fragment',
  jsx: (type: unknown, props: unknown) => ({ type, props }),
  jsxs: (type: unknown, props: unknown) => ({ type, props }),
}));
vi.mock('../webview/rpc', () => ({ rpc: fixture.rpc }));
vi.mock('../webview/i18n', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('../webview/actionFeedback', () => ({
  actionName: (action: { type: string }) => action.type,
}));
vi.mock('../webview/ui', () => ({ Button: 'button', Modal: 'modal' }));
vi.mock('../webview/store', () => ({
  useWorkbench: { getState: () => ({ repositories: [], report: vi.fn() }) },
}));
import { StopOperationButton, StopOperationConfirmation } from '../webview/StopOperation';

type Node = {
  type: unknown;
  props: {
    children?: unknown;
    footer?: unknown;
    onClick?(): void;
    onClose?(): void;
    'data-autofocus'?: string;
  };
};
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children), ...nodes(node.props.footer)];
}
function open() {
  nodes(StopOperationButton({ requestId: 'old' })).find((node) => node.type === 'button')!.props
    .onClick!();
  return nodes(StopOperationConfirmation());
}
afterEach(() => {
  for (const task of operationTasks.snapshot()) operationTasks.remove(task.id);
  operationTasks.confirm([]);
  fixture.rpc.mockClear();
});
it('requires explicit confirmation, defaults to continuing, and displays the operation risk', async () => {
  operationTasks.add({ id: 'old', repoId: 'repo', action: { type: 'push' }, stopping: false });
  const dialog = open();
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(dialog.some((node) => node.props.children === 'cancellation.pushRisk')).toBe(true);
  const buttons = dialog.filter((node) => node.type === 'button');
  expect(buttons[0].props['data-autofocus']).toBe('true');
  dialog.find((node) => node.type === 'modal')!.props.onClose!();
  expect(StopOperationConfirmation()).toBeNull();
  const reopened = open().filter((node) => node.type === 'button');
  reopened[1].props.onClick!();
  await Promise.resolve();
  expect(fixture.rpc).toHaveBeenCalledWith('cancelOperation', 'repo', { requestId: 'old' });
  expect(operationTasks.snapshot()[0].stopping).toBe(true);
});
it('automatically closes a completed target and rejects its stale confirm handler without stopping a newer operation', () => {
  operationTasks.add({ id: 'old', repoId: 'repo', action: { type: 'fetch' }, stopping: false });
  const stop = open().filter((node) => node.type === 'button')[1].props.onClick!;
  operationTasks.remove('old');
  operationTasks.add({ id: 'new', repoId: 'repo', action: { type: 'fetch' }, stopping: false });
  expect(StopOperationConfirmation()).toBeNull();
  stop();
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(operationTasks.snapshot()[0].stopping).toBe(false);
});
