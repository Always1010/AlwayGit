import { beforeEach, expect, it, vi } from 'vitest';

type Node = { type: unknown; props: { children?: unknown; onClick?(): void; disabled?: boolean } };
const fixture = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, epoch: 1,
  state: { repoId: 'a', busy: false, snapshot: { repository: { id: 'a' }, changes: [], operation: { kind: 'rebase', canSkip: true, skipToken: 'first', conflicts: 1 } }, execute: vi.fn() },
}));
vi.mock('react', () => ({ useEffect: () => {}, useState: (initial: unknown) => {
  const index = fixture.cursor++;
  if (!(index in fixture.slots)) fixture.slots[index] = initial;
  return [fixture.slots[index], (value: unknown) => { fixture.slots[index] = value; }];
} }));
vi.mock('react/jsx-runtime', () => ({ Fragment: 'fragment', jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) }));
vi.mock('../webview/store', () => ({
  useWorkbench: Object.assign(() => fixture.state, { getState: () => fixture.state }),
  captureActionContext: () => ({ repoId: fixture.state.repoId, epoch: fixture.epoch }),
  isActionContextCurrent: (context: { repoId: string; epoch: number }) => context.repoId === fixture.state.repoId && context.epoch === fixture.epoch,
}));
vi.mock('../webview/i18n', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('../webview/text', () => ({ uiText: (key: string) => key }));
vi.mock('../webview/actionFeedback', () => ({ operationName: (kind: string) => kind }));
vi.mock('../webview/ui', () => ({ Button: 'button', Modal: 'modal', Icon: 'icon' }));
vi.mock('../webview/ConflictWorkflow', () => ({ ConflictWorkflow: 'workflow' }));
import { OperationNotice } from '../webview/OperationNotice';
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node; return [node, ...nodes(node.props.children)];
}
function render() { fixture.cursor = 0; return nodes(OperationNotice({ abort() {} })); }
function openConfirmation() {
  render().find(node => node.type === 'button' && node.props.children === 'operations.skip')!.props.onClick!();
  return nodes(render().find(node => node.type === 'modal')).find(node => node.type === 'button')!;
}
beforeEach(() => {
  fixture.slots = []; fixture.epoch = 1; fixture.state.repoId = 'a'; fixture.state.busy = false;
  fixture.state.snapshot.repository.id = 'a'; fixture.state.snapshot.operation.skipToken = 'first'; fixture.state.execute.mockClear();
});
it.each(['repository', 'step', 'epoch'] as const)('invalidates an open Skip confirmation after a changed %s, including stale handlers', change => {
  const confirm = openConfirmation();
  if (change === 'repository') { fixture.state.repoId = 'b'; fixture.state.snapshot.repository.id = 'b'; }
  else if (change === 'step') fixture.state.snapshot.operation.skipToken = 'second';
  else fixture.epoch++;
  expect(render().some(node => node.type === 'modal')).toBe(false);
  confirm.props.onClick!();
  expect(fixture.state.execute).not.toHaveBeenCalled();
});
it('sends the captured token and repository context for a still-current confirmation', () => {
  openConfirmation().props.onClick!();
  expect(fixture.state.execute).toHaveBeenCalledWith({ type: 'operation.skip', kind: 'rebase', skipToken: 'first' }, { repoId: 'a', epoch: 1 });
});
