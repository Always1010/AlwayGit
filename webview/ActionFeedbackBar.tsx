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
  const name = feedback ? actionName(feedback.action) : activity || 'Git';
  const title = commit && status === 'success' ? (commit.amended ? t(`Commit ${commit.oid.slice(0,8)} amended`, `Commit ${commit.oid.slice(0,8)} 已修订`) : t(`Commit ${commit.oid.slice(0,8)} created`, `Commit ${commit.oid.slice(0,8)} 已创建`))
    : feedback?.action.type === 'resolve-and-stage' && status === 'success' ? t('Marked and staged; inspect the result before continuing.', '已标记并暂存；继续前请检查结果。') : status === 'running' ? t(`${name} in progress…`, `${name} 正在进行…`)
    : status === 'success' ? t(`${name} completed`, `${name} 已完成`) : t(`${name} failed`, `${name} 失败`);
  const commitSummary = commit ? [commit.files === undefined ? undefined : t(`${commit.files} file${commit.files===1?'':'s'} committed`, `已提交 ${commit.files} 个文件`), commit.remaining ? t(`${commit.remaining} change${commit.remaining===1?'':'s'} remaining`, `仍有 ${commit.remaining} 项更改`) : t('Working tree clean', '工作区干净')].filter(Boolean).join(' · ') : undefined;
  return <div className={`action-feedback feedback-${marked?'marked':status}`} data-testid="action-feedback" role={status === 'error' ? 'alert' : 'status'} aria-live={status === 'error' ? 'assertive' : 'polite'}>
    <Icon name={status === 'running' ? 'loading' : marked ? 'add' : status === 'success' ? 'pass' : 'error'} className={status === 'running' ? 'feedback-spinner' : undefined}/>
    <div className="feedback-content"><strong>{title}</strong>{feedback?.target && <span className="feedback-target">{feedback.target}</span>}{commitSummary&&<span className="feedback-target">{commitSummary}</span>}
      {feedback?.error && <><span className="feedback-message">{feedback.error.split('\n').find(line => line.trim())?.slice(0, 240)}</span><details className="feedback-details"><summary>{t('Error details', '错误详情')}</summary><pre>{feedback.error}</pre></details></>}
      {demoMode && <span className="muted">{t('Demo · sample data only', 'Demo · 仅示例数据')}</span>}
    </div>
    {commit&&status==='success'&&<Button icon="git-commit" onClick={()=>void state.selectCommit(commit.oid)}>{t('View Commit','查看 Commit')}</Button>}
    {status === 'error' && <Button icon="output" onClick={showLog}>{t('Show Log', '查看日志')}</Button>}
    {status !== 'running' && <Button icon="close" aria-label={t('Dismiss notification', '关闭提醒')} onClick={dismissFeedback}/>}
  </div>;
}
