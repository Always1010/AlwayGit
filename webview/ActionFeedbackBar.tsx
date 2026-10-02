import { actionName } from './actionFeedback';
import { useTranslation } from './i18n';
import { demoMode } from './rpc';
import { useWorkbench } from './store';
import { Button, Icon } from './ui';

export function ActionFeedbackBar({ showLog }: { showLog(): void }) {
  const state = useWorkbench(), { actionFeedback: feedback, busy, activity, dismissFeedback } = state;
  const t = useTranslation();
  if (!feedback && !busy) return null;
  const status = feedback?.status ?? 'running';
  const marked = feedback?.action.type === 'resolve-and-stage' && status === 'success';
  const commit = feedback?.result?.kind === 'commit' ? feedback.result : undefined;
  const stash = feedback?.result?.kind === 'stash' ? feedback.result : undefined;
  const branch = feedback?.result?.kind === 'branch' ? feedback.result : undefined;
  const name = feedback ? actionName(feedback.action) : activity || 'Git';
  const title = branch&&status==='success' ? branch.checkedOut?t(`Created and switched to ${branch.name}`,`已创建并切换到 ${branch.name}`):t(`Created ${branch.name}; still on ${branch.currentBranch}`,`已创建 ${branch.name}，当前仍在 ${branch.currentBranch}`)
    : commit && status === 'success' ? (commit.amended ? t(`Commit ${commit.oid.slice(0,8)} amended`, `Commit ${commit.oid.slice(0,8)} 已修订`) : t(`Commit ${commit.oid.slice(0,8)} created`, `Commit ${commit.oid.slice(0,8)} 已创建`))
    : feedback?.action.type === 'resolve-and-stage' && status === 'success' ? t('Marked and staged; inspect the result before continuing.', '已标记并暂存；继续前请检查结果。') : status === 'running' ? t(`${name} in progress…`, `${name} 正在进行…`)
    : status === 'success' ? t(`${name} completed`, `${name} 已完成`) : t(`${name} failed`, `${name} 失败`);
  const commitSummary = commit ? [commit.files === undefined ? undefined : t(`${commit.files} file${commit.files===1?'':'s'} committed`, `已提交 ${commit.files} 个文件`), commit.remaining ? t(`${commit.remaining} change${commit.remaining===1?'':'s'} remaining`, `仍有 ${commit.remaining} 项更改`) : t('Working tree clean', '工作区干净')].filter(Boolean).join(' · ') : undefined;
  const stashSummary=stash?[t(`${stash.files} file${stash.files===1?'':'s'} saved`,`已保存 ${stash.files} 个文件`),stash.untracked?t(`${stash.untracked} untracked`,`未跟踪文件 ${stash.untracked} 个`):undefined,stash.clean?t('Working tree clean','工作区干净'):undefined].filter(Boolean).join(' · '):undefined;
  return <div className={`action-feedback feedback-${marked?'marked':status}`} data-testid="action-feedback" role={status === 'error' ? 'alert' : 'status'} aria-live={status === 'error' ? 'assertive' : 'polite'}>
    <Icon name={status === 'running' ? 'loading' : marked ? 'add' : status === 'success' ? 'pass' : 'error'} className={status === 'running' ? 'feedback-spinner' : undefined}/>
    <div className="feedback-content"><strong>{title}</strong>{feedback?.target&&!branch&&<span className="feedback-target">{feedback.target}</span>}{(commitSummary||stashSummary)&&<span className="feedback-target">{commitSummary||stashSummary}</span>}
      {feedback?.error && <><span className="feedback-message">{feedback.error.split('\n').find(line => line.trim())?.slice(0, 240)}</span><details className="feedback-details"><summary>{t('Error details', '错误详情')}</summary><pre>{feedback.error}</pre></details></>}
      {demoMode && <span className="muted">{t('Demo · sample data only', 'Demo · 仅示例数据')}</span>}
    </div>
    {commit&&status==='success'&&<Button icon="git-commit" onClick={()=>void state.selectCommit(commit.oid)}>{t('View Commit','查看 Commit')}</Button>}
    {status === 'error' && <Button icon="output" onClick={showLog}>{t('Show Log', '查看日志')}</Button>}
    {status !== 'running' && <Button icon="close" aria-label={t('Dismiss notification', '关闭提醒')} onClick={dismissFeedback}/>}
  </div>;
}
