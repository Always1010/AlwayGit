import type { GitAction, Snapshot } from '../src/protocol/types';

export interface ActionFeedback {
  id: number;
  repoId: string;
  action: GitAction;
  status: 'running' | 'success' | 'error';
  target?: string;
  error?: string;
  result?: { kind: 'commit'; oid: string; files?: number; remaining: number; amended: boolean } | {kind:'stash';files:number;untracked:number;clean:boolean} | {kind:'branch';name:string;checkedOut:boolean;currentBranch:string};
}

export function actionName(action: GitAction): string {
  const names: Partial<Record<GitAction['type'], string>> = {
    stage: 'Stage', 'resolve-and-stage': 'Mark & Stage', unstage: 'Unstage', discard: 'Discard', commit: action.type === 'commit' && action.amend ? 'Amend' : 'Commit',
    fetch: 'Fetch', pull: 'Pull', push: 'Push', 'remote.add':'Add Remote', 'branch.create': 'Create Branch', 'branch.checkout': 'Checkout', 'commit.checkout': 'Checkout',
    'checkout.stash': 'Stash & Checkout', 'branch.track': action.type==='branch.track'&&action.checkout?'Checkout Remote Branch':'Create Tracking Branches', 'branch.delete': action.type==='branch.delete'&&action.names.length>1?'Delete Branches':'Delete Branch', 'remote.delete':'Delete Remote Branches', 'tag.create': 'Create Tag', 'tag.delete': 'Delete Tag',
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
  if(action.type==='branch.delete')return action.names.join(', ');
  if(action.type==='branch.track')return action.branches.map(branch=>`${branch.source.replace(/^refs\/remotes\//,'')} → ${branch.name}`).join(', ');
  if(action.type==='remote.delete')return `${action.remote}: ${action.branches.join(', ')}`;
  if ('target' in action) return action.target;
  if ('name' in action) return action.name;
  if ('remote' in action) return action.remote;
  return undefined;
}
