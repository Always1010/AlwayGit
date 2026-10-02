import { uiText } from './text';
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
    stage: uiText("actionNames.stage"), 'resolve-and-stage': uiText("actionNames.markStage"), unstage: uiText("actionNames.unstage"), discard: uiText("actionNames.discard"), commit: action.type === 'commit' && action.amend ? uiText("actionNames.amend") : uiText("actionNames.commit"),
    fetch: uiText("actionNames.fetch"), pull: uiText("actionNames.pull"), push: uiText("actionNames.push"), 'remote.add':uiText("actionNames.addRemote"), 'branch.create': uiText("actionNames.createBranch"), 'branch.checkout': uiText("actionNames.checkout"), 'commit.checkout': uiText("actionNames.checkout"),
    'checkout.stash': uiText("actionNames.stashCheckout"), 'branch.track': action.type==='branch.track'&&action.checkout?uiText("actionNames.checkoutRemoteBranch"):uiText("actionNames.createTrackingBranches"), 'branch.delete': action.type==='branch.delete'&&action.names.length>1?uiText("actionNames.deleteBranches"):uiText("actionNames.deleteBranch"), 'remote.delete':uiText("actionNames.deleteRemoteBranches"), 'tag.create': uiText("actionNames.createTag"), 'tag.delete': uiText("actionNames.deleteTag"),
    'stash.create': action.type==='stash.create'&&action.paths?uiText("actionNames.stashSelectedFiles"):uiText("actionNames.stashAllChanges"), 'stash.apply': action.type === 'stash.apply' && action.pop ? uiText("actionNames.popStash") : uiText("actionNames.applyStash"), 'stash.drop': uiText("actionNames.dropStash"),
    'worktree.add': uiText("actionNames.addWorktree"), 'worktree.remove': uiText("actionNames.removeWorktree"), merge: uiText("actionNames.merge"), rebase: uiText("actionNames.rebase"), 'cherry-pick': uiText("actionNames.cherryPick"), revert: uiText("actionNames.revert"), reset: uiText("common.reset"),
  };
  if (action.type === 'operation.continue') return uiText("actionNames.continue", { value: (operationName(action.kind)) });
  if (action.type === 'operation.abort') return uiText("actionNames.abort", { value: (operationName(action.kind)) });
  if (action.type === 'operation.skip') return uiText("actionNames.skip", { value: (operationName(action.kind)) });
  return names[action.type] ?? action.type;
}

export function operationName(kind: string): string {
  return kind === 'cherry-pick' ? uiText("actionNames.cherryPick") : kind.charAt(0).toUpperCase() + kind.slice(1);
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
