import type { GitAction, Snapshot } from '../src/protocol/types';

export interface ActionFeedback {
  id: number;
  repoId: string;
  action: GitAction;
  status: 'running' | 'success' | 'error';
  target?: string;
  error?: string;
}

export function actionName(action: GitAction): string {
  const names: Partial<Record<GitAction['type'], string>> = {
    stage: 'Stage', unstage: 'Unstage', discard: 'Discard', commit: action.type === 'commit' && action.amend ? 'Amend' : 'Commit',
    fetch: 'Fetch', pull: 'Pull', push: 'Push', 'branch.create': 'Create Branch', 'branch.checkout': 'Checkout', 'commit.checkout': 'Checkout',
    'checkout.stash': 'Stash & Checkout', 'branch.delete': 'Delete Branch', 'tag.create': 'Create Tag', 'tag.delete': 'Delete Tag',
    'stash.create': 'Stash', 'stash.apply': action.type === 'stash.apply' && action.pop ? 'Pop Stash' : 'Apply Stash', 'stash.drop': 'Drop Stash',
    'worktree.add': 'Add Worktree', 'worktree.remove': 'Remove Worktree', merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick', revert: 'Revert', reset: 'Reset',
  };
  if (action.type === 'operation.continue') return `${operationName(action.kind)} Continue`;
  if (action.type === 'operation.abort') return `${operationName(action.kind)} Abort`;
  if (action.type === 'operation.skip') return `${operationName(action.kind)} Skip`;
  return names[action.type] ?? action.type;
}

export function operationName(kind: string): string {
  return kind === 'cherry-pick' ? 'Cherry-pick' : kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function actionTarget(action: GitAction, snapshot?: Snapshot): string | undefined {
  if (action.type === 'push') {
    const branch = action.branch ?? snapshot?.branch;
    const remote = action.remote ?? snapshot?.pushTarget?.remote;
    const remoteBranch = action.remoteBranch ?? snapshot?.pushTarget?.remoteBranch ?? branch;
    return branch && remote ? `${branch} → ${remote}/${remoteBranch}` : branch;
  }
  if ('target' in action) return action.target;
  if ('name' in action) return action.name;
  if ('remote' in action) return action.remote;
  return undefined;
}
