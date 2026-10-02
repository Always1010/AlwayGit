import { Button, Icon } from './ui';

import { actionName } from './actionFeedback';
import { useTranslation } from './i18n';
import { demoMode } from './rpc';
import { useWorkbench } from './store';


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
  const title = branch&&status==='success' ? branch.checkedOut?t("feedback.createdAndSwitchedTo", { name: (branch.name) }):t("feedback.createdStillOn", { name: (branch.name), currentBranch: (branch.currentBranch) })
    : commit && status === 'success' ? (commit.amended ? t("feedback.commitAmended", { value: (commit.oid.slice(0,8)) }) : t("feedback.commitCreated", { value: (commit.oid.slice(0,8)) }))
    : feedback?.action.type === 'resolve-and-stage' && status === 'success' ? t("feedback.markedAndStagedInspectTheResultBeforeContinuing") : status === 'running' ? t("feedback.inProgress", { name: (name) })
    : status === 'success' ? t("feedback.completed", { name: (name) }) : t("feedback.failed", { name: (name) });
  const commitSummary = commit ? [commit.files === undefined ? undefined : t("feedback.filesCommitted", { count: (commit.files) }), commit.remaining ? t("feedback.changesRemaining", { count: (commit.remaining) }) : t("feedback.workingTreeClean")].filter(Boolean).join(' · ') : undefined;
  const stashSummary=stash?[t("feedback.filesSaved", { count: (stash.files) }),stash.untracked?t("feedback.untracked", { untracked: (stash.untracked) }):undefined,stash.clean?t("feedback.workingTreeClean"):undefined].filter(Boolean).join(' · '):undefined;
  return <div className={`action-feedback feedback-${marked?'marked':status}`} data-testid="action-feedback" role={status === 'error' ? 'alert' : 'status'} aria-live={status === 'error' ? 'assertive' : 'polite'}>
    <Icon name={status === 'running' ? 'loading' : marked ? 'add' : status === 'success' ? 'pass' : 'error'} className={status === 'running' ? 'feedback-spinner' : undefined}/>
    <div className="feedback-content"><strong>{title}</strong>{feedback?.target&&!branch&&<span className="feedback-target">{feedback.target}</span>}{(commitSummary||stashSummary)&&<span className="feedback-target">{commitSummary||stashSummary}</span>}
      {feedback?.error && <><span className="feedback-message">{feedback.error.split('\n').find(line => line.trim())?.slice(0, 240)}</span><details className="feedback-details"><summary>{t("feedback.errorDetails")}</summary><pre>{feedback.error}</pre></details></>}
      {demoMode && <span className="muted">{t("feedback.demoSampleDataOnly")}</span>}
    </div>
    {commit&&status==='success'&&<Button icon="git-commit" onClick={()=>void state.selectCommit(commit.oid)}>{t("feedback.viewCommit")}</Button>}
    {status === 'error' && <Button icon="output" onClick={showLog}>{t("feedback.showLog")}</Button>}
    {status !== 'running' && <Button icon="close" aria-label={t("feedback.dismissNotification")} onClick={dismissFeedback}/>}
  </div>;
}
