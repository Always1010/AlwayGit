import * as vscode from 'vscode';
import type { GitAction, Repository } from '../protocol/types';

export async function confirmAction(repo: Repository, action: GitAction): Promise<boolean> {
  let warning: string | undefined;
  if (action.type === 'discard') warning = `Discard changes in ${action.paths.length} file(s)? Untracked files will be deleted; unstaged tracked content can be lost.`;
  if (action.type === 'reset') warning = `Reset ${repo.name} to ${action.target} (${action.mode})? ${action.mode === 'hard' ? 'HEAD, Index and working files will change; uncommitted content can be lost.' : action.mode === 'mixed' ? 'HEAD and Index will change; working files remain.' : 'HEAD will change; Index and working files remain.'}`;
  if (action.type === 'push' && action.forceWithLease) warning = 'Push with force-with-lease? Published branch history may be replaced.';
  if (action.type === 'branch.delete') warning = `Delete branch ${action.name}?${action.force ? ' Force deletion may remove the last branch referencing unmerged commits.' : ''}`;
  if (action.type === 'tag.delete') warning = `Delete local tag ${action.name}?`;
  if (action.type === 'stash.drop') warning = `Drop ${action.selector}? Its saved uncommitted changes may become unreachable.`;
  if (action.type === 'worktree.remove') warning = `Remove worktree ${action.path}?${action.force ? ' Forced removal may delete uncommitted files.' : ''}`;
  if (action.type === 'operation.abort') warning = `Abort the current ${action.kind}? Conflict-resolution changes can be discarded.`;
  if (warning) return (await vscode.window.showWarningMessage(warning, { modal: true, detail: `Repository: ${repo.root}` }, 'Proceed')) === 'Proceed';
  if (action.type === 'commit') {
    const dirty = vscode.workspace.textDocuments.filter(d => d.isDirty && d.uri.scheme === 'file' && d.uri.fsPath.startsWith(repo.root + require('node:path').sep));
    if (dirty.length) return (await vscode.window.showWarningMessage(`${dirty.length} file(s) have unsaved editor changes. Git commits the staged disk content.`, { modal: true }, 'Commit Staged Content')) === 'Commit Staged Content';
  }
  return true;
}
