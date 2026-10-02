import * as vscode from 'vscode';
import type { GitAction, OperationState, Repository } from '../protocol/types';
import { hostText, type Language } from './language';

export async function confirmAction(repo: Repository, action: GitAction, language?: Language, operation?: OperationState): Promise<boolean> {
  const text = (english: string, chinese: string) => hostText(english, chinese, language);
  let warning: string | undefined;
  if (action.type === 'discard') warning = text(`Discard Unstaged Changes in ${action.paths.length} file(s)? Untracked files will be deleted; Index content and Staged Changes remain.`, `Discard ${action.paths.length} 个文件的 Unstaged Changes？未跟踪文件将被删除；Index 中的 Staged Changes 保留。`);
  if (action.type === 'reset') warning = `Reset ${repo.name} to ${action.target} (${action.mode})? ${action.mode === 'hard' ? 'HEAD, Index and working files will change; uncommitted content can be lost.' : action.mode === 'mixed' ? 'HEAD and Index will change; working files remain.' : 'HEAD will change; Index and working files remain.'}`;
  if (action.type === 'push' && action.forceWithLease) warning = 'Push with force-with-lease? Published branch history may be replaced.';
  if (action.type === 'branch.delete') warning = `Delete ${action.names.length} local branch${action.names.length===1?'':'es'}?\n${action.names.join('\n')}${action.force ? '\nForce deletion may remove the last branch referencing unmerged commits.' : ''}`;
  if(action.type==='remote.delete')warning=`Delete ${action.branches.length} branch${action.branches.length===1?'':'es'} from remote ${action.remote}?\n${action.branches.join('\n')}\nThis changes the shared remote repository.`;
  if (action.type === 'tag.delete') warning = `Delete local tag ${action.name}?`;
  if (action.type === 'stash.drop') warning = `Drop ${action.selector}? Its saved uncommitted changes may become unreachable.`;
  if (action.type === 'worktree.remove') warning = `Remove worktree ${action.path}?${action.force ? ' Forced removal may delete uncommitted files.' : ''}`;
  if (action.type === 'operation.abort') warning = `Abort the current ${action.kind}? Conflict-resolution changes can be discarded.`;
  if (action.type === 'commit.checkout') warning = text(`Checkout ${action.target} as Detached HEAD? New commits will not belong to a branch until you create one.`, `Checkout ${action.target} 并进入 Detached HEAD？新提交不会属于分支，请及时创建分支保存。`);
  if (action.type === 'checkout.stash' && action.detached) warning = text(`Stash Changes and Checkout ${action.target} as Detached HEAD? The Stash will be retained for you to apply.`, `Stash Changes 后 Checkout ${action.target} 并进入 Detached HEAD？Stash 将保留，供你之后 Apply。`);
  if (language === 'zh-CN') {
    if (action.type === 'branch.delete') warning = `Delete ${action.names.length} 个本地分支？\n${action.names.join('\n')}${action.force ? '\n强制删除可能使未合并提交失去分支引用。' : ''}`;
    if(action.type==='remote.delete')warning=`从远端 ${action.remote} Delete ${action.branches.length} 个分支？\n${action.branches.join('\n')}\n此操作会修改共享远端仓库。`;
    if (action.type === 'tag.delete') warning = `Delete 本地 Tag ${action.name}？`;
    if (action.type === 'stash.drop') warning = `Drop ${action.selector}？保存的未提交修改可能无法再恢复。`;
    if (action.type === 'worktree.remove') warning = `Remove Worktree ${action.path}？${action.force ? '强制移除可能删除未提交的文件。' : ''}`;
    if (action.type === 'operation.abort') warning = `Abort 当前 ${action.kind}？解决冲突时的修改可能被丢弃。`;
    if (action.type === 'push' && action.forceWithLease) warning = 'Push with force-with-lease？已发布的分支历史可能被替换。';
    if (action.type === 'reset') warning = `Reset ${repo.name} 到 ${action.target}（${action.mode}）？${action.mode === 'hard' ? 'HEAD、Index 和工作区文件都将改变，未提交内容可能丢失。' : action.mode === 'mixed' ? 'HEAD 和 Index 将改变，工作区文件保留。' : 'HEAD 将改变，Index 和工作区文件保留。'}`;
  }
  const proceed = text('Proceed', '继续');
  if (action.type === 'operation.abort' && operation?.originalHead) warning += text(`\nGit will attempt to restore the operation start state at ${operation.originalHead}. Pre-existing local changes may prevent full restoration.`, `\nGit 将尝试恢复到操作开始时的 ${operation.originalHead}；操作前已有的本地修改可能影响完整恢复。`);
  if (warning) return (await vscode.window.showWarningMessage(warning, { modal: true, detail: text(`Repository: ${repo.root}`, `仓库：${repo.root}`) }, proceed)) === proceed;
  if (action.type === 'commit' || action.type === 'operation.continue') {
    const dirty = vscode.workspace.textDocuments.filter(d => d.isDirty && d.uri.scheme === 'file' && d.uri.fsPath.startsWith(repo.root + require('node:path').sep));
    const button = text('Use Staged Content', '使用暂存内容');
    if (dirty.length) return (await vscode.window.showWarningMessage(text(`${dirty.length} file(s) have unsaved editor changes. Git commits the staged disk content.`, `${dirty.length} 个文件在编辑器中有未保存修改。Git 提交的是磁盘上已暂存的内容。`), { modal: true }, button)) === button;
  }
  return true;
}
