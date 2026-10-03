import * as vscode from 'vscode';
import type { GitAction, OperationState, Repository } from '../protocol/types';
import { hostText, type Language } from './language';
import { translator, type MessageArgs, type MessageKey } from '../i18n';

export async function confirmAction(repo: Repository, action: GitAction, language?: Language, operation?: OperationState): Promise<boolean> {
  const text = <K extends MessageKey>(key: K, ...args: MessageArgs<K>) => hostText(language, key, ...args);
  // Existing callers without an explicit language retain English destructive warnings.
  const warningText = translator(language ?? 'en');
  let warning: string | undefined;
  if (action.type === 'discard') warning = text(action.mode === 'all' ? 'confirm.discardAll' : 'confirm.discard', { count: action.paths.length });
  if (action.type === 'reset') warning = warningText('confirm.reset', { name: repo.name, target: action.target, mode: action.mode, effect: warningText(action.mode === 'hard' ? 'confirm.resetHard' : action.mode === 'mixed' ? 'confirm.resetMixed' : 'confirm.resetSoft') });
  if (action.type === 'push' && action.forceWithLease) warning = warningText('confirm.forcePush');
  if (action.type === 'branch.delete') warning = warningText('confirm.deleteBranches', { count: action.names.length, names: action.names.join('\n'), effect: action.force ? warningText('confirm.forceDeleteBranches') : '' });
  if (action.type === 'remote.delete') warning = warningText('confirm.deleteRemoteBranches', { count: action.branches.length, remote: action.remote, names: action.branches.join('\n') });
  if (action.type === 'tag.delete') warning = warningText('confirm.deleteTag', { name: action.name });
  if (action.type === 'stash.drop') warning = warningText('confirm.dropStash', { selector: action.selector });
  if (action.type === 'worktree.remove') warning = warningText('confirm.removeWorktree', { path: action.path, effect: action.force ? warningText('confirm.forceRemoveWorktree') : '' });
  if (action.type === 'operation.abort') warning = warningText('confirm.abort', { kind: action.kind });
  if (action.type === 'commit.checkout') warning = text('confirm.detachedCheckout', { target: action.target });
  if (action.type === 'checkout.stash' && action.detached) warning = text('confirm.stashDetachedCheckout', { target: action.target });
  const proceed = text('confirm.proceed');
  if (action.type === 'reset') warning += text('confirm.currentHead', { branch: action.expectedBranch || text('confirm.detachedHead'), head: action.expectedHead || text('confirm.unborn') });
  if (action.type === 'operation.abort' && operation?.originalHead) warning += text('confirm.restoreOriginalHead', { head: operation.originalHead });
  if (warning) return (await vscode.window.showWarningMessage(warning, { modal: true, detail: text('confirm.repository', { root: repo.root }) }, proceed)) === proceed;
  if (action.type === 'commit' || action.type === 'operation.continue') {
    const selected = action.type === 'commit' ? action.files : undefined;
    const taskPath = require('node:path') as typeof import('node:path');
    const dirty = vscode.workspace.textDocuments.filter(d => d.isDirty && d.uri.scheme === 'file' && d.uri.fsPath.startsWith(repo.root + taskPath.sep) && (!selected || selected.some(file => taskPath.resolve(repo.root, file.path) === d.uri.fsPath)));
    const includesUnstaged = selected?.some(file => file.area === 'unstaged');
    const button = text(includesUnstaged ? 'confirm.useDiskContent' : 'confirm.useStagedContent');
    if (dirty.length) return (await vscode.window.showWarningMessage(text(includesUnstaged ? 'confirm.unsavedSelectedFiles' : 'confirm.unsavedFiles', { count: dirty.length }), { modal: true }, button)) === button;
  }
  return true;
}
