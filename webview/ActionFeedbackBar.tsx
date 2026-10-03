import { Button, Icon } from './ui';

import { actionName } from './actionFeedback';
import { useTranslation } from './i18n';
import { demoMode } from './rpc';
import { useWorkbench } from './store';
import { PushFeedback } from './PushFeedback';
import type { DialogRequest } from './ActionDialog';
import { rpc } from './rpc';


export function ActionFeedbackBar({ showLog, openAction }: { showLog(): void; openAction?(action: DialogRequest): void }) {
  const state = useWorkbench(), { actionFeedback: feedback, busy, activity, dismissFeedback } = state;
  const t = useTranslation();
  if (!feedback && !busy) return null;
  const status = feedback?.status ?? 'running';
  const marked = feedback?.action.type === 'resolve-and-stage' && status === 'success';
  const commit = feedback?.result?.kind === 'commit' ? feedback.result : undefined;
  const stash = feedback?.result?.kind === 'stash' ? feedback.result : undefined;
  const branch = feedback?.result?.kind === 'branch' ? feedback.result : undefined;
  const pushed = feedback?.result?.kind === 'push' ? feedback.result : undefined;
  const checkedOut = feedback?.result?.kind === 'checkout' ? feedback.result : undefined;
  const fetched = feedback?.result?.kind === 'fetch' ? feedback.result : undefined;
  const worktree = feedback?.result?.kind === 'worktree' ? feedback.result : undefined;
  const updated = feedback?.result?.kind === 'update' ? feedback.result : undefined;
  const tag = feedback?.result?.kind === 'tag' ? feedback.result : undefined;
  const name = feedback ? actionName(feedback.action) : activity || 'Git';
  const title = pushed?.outcome === 'partial' ? t('feedback.pushPartiallyCompleted') : pushed && feedback?.action.type === 'tag.create' && status === 'error' ? t('feedback.tagCreatedPushFailed') : branch&&status==='success' ? branch.checkedOut?t("feedback.createdAndSwitchedTo", { name: (branch.name) }):t("feedback.createdStillOn", { name: (branch.name), currentBranch: (branch.currentBranch) })
    : commit && status === 'success' ? (commit.amended ? t("feedback.commitAmended", { value: (commit.oid.slice(0,8)) }) : t("feedback.commitCreated", { value: (commit.oid.slice(0,8)) }))
    : feedback?.action.type === 'resolve-and-stage' && status === 'success' ? t("feedback.markedAndStagedInspectTheResultBeforeContinuing") : status === 'running' ? t("feedback.inProgress", { name: (name) })
    : status === 'success' ? t("feedback.completed", { name: (name) }) : t("feedback.failed", { name: (name) });
  const commitSummary = commit ? [commit.files === undefined ? undefined : t("feedback.filesCommitted", { count: (commit.files) }), commit.remaining ? t("feedback.changesRemaining", { count: (commit.remaining) }) : t("feedback.workingTreeClean")].filter(Boolean).join(' · ') : undefined;
  const stashSummary=stash?[t("feedback.filesSaved", { count: (stash.files) }),stash.untracked?t("feedback.untracked", { untracked: (stash.untracked) }):undefined,stash.clean?t("feedback.workingTreeClean"):undefined].filter(Boolean).join(' · '):undefined;
  return <div className={`action-feedback feedback-${marked?'marked':status}`} data-testid="action-feedback" role={status === 'error' ? 'alert' : 'status'} aria-live={status === 'error' ? 'assertive' : 'polite'}>
    <Icon name={status === 'running' ? 'loading' : marked ? 'add' : status === 'success' ? 'pass' : 'error'} className={status === 'running' ? 'feedback-spinner' : undefined}/>
    <div className="feedback-content"><strong>{title}</strong>{feedback?.target&&!branch&&<span className="feedback-target">{feedback.target}</span>}{(commitSummary||stashSummary)&&<span className="feedback-target">{commitSummary||stashSummary}</span>}
      {feedback?.error && <><span className="feedback-message">{feedback.error.split('\n').find(line => line.trim())?.slice(0, 240)}</span><details className="feedback-details"><summary>{t("feedback.errorDetails")}</summary><pre>{feedback.error}</pre></details></>}
      {feedback?.refreshWarning && <span className="feedback-message">{t('feedback.refreshFailed')} <Button icon="refresh" disabled={busy} title={t('workbench.refreshCurrentRepositoryStatusAndHistory')} aria-label={t('workbench.refreshCurrentRepositoryStatusAndHistory')} onClick={()=>void state.refresh()}/></span>}
      {checkedOut && <span className="feedback-target">{t('feedback.switchedTo', { branch: checkedOut.branch })}</span>}
      {fetched && <span className="feedback-target">{t('feedback.remoteRefsUpdated', { count: fetched.refs.length })}</span>}
      {worktree && <span className="feedback-target">{worktree.path}</span>}
      {updated && <span className="feedback-target">{updated.head === updated.previousHead ? t('feedback.headUnchanged') : `${updated.previousHead?.slice(0,8) ?? '—'} → ${updated.head?.slice(0,8) ?? '—'}`}</span>}
      {tag && <span className="feedback-target">{tag.name}</span>}
      {pushed && feedback && <PushFeedback result={pushed} repoId={feedback.repoId}/>}
      {demoMode && <span className="muted">{t("feedback.demoSampleDataOnly")}</span>}
    </div>
    {commit&&status==='success'&&<Button icon="git-commit" onClick={()=>void state.selectCommit(commit.oid)}>{t("feedback.viewCommit")}</Button>}
    {commit&&status==='success'&&<Button icon="cloud-upload" disabled={busy || !state.snapshot?.branch} onClick={()=>openAction?.({type:'push'})}>{t('workbench.push')}</Button>}
    {(checkedOut || updated || branch?.checkedOut)&&status==='success'&&<Button icon="location" disabled={busy || !state.snapshot?.head} title={t('workbench.locateHEAD')} aria-label={t('workbench.locateHEAD')} onClick={state.locateHead}/>}
    {fetched&&status==='success'&&fetched.refs.length>0&&<Button icon="eye" disabled={busy} title={t('feedback.viewRemoteChanges')} aria-label={t('feedback.viewRemoteChanges')} onClick={()=>state.setCheckedRefs(fetched.refs.filter(name=>state.snapshot?.refs.some(ref=>ref.fullName===name)))}/>}
    {stash&&status==='success'&&feedback?.stashOid&&<Button icon="archive" disabled={busy} title={t('feedback.viewStash')} aria-label={t('feedback.viewStash')} onClick={()=>void state.selectCommit(feedback.stashOid!,undefined,feedback.stashOid)}/>}
    {worktree&&status==='success'&&<Button icon="folder-opened" title={t('feedback.openWorktree')} aria-label={t('feedback.openWorktree')} onClick={()=>void rpc('openWorktree',feedback!.repoId,{path:worktree.path,newWindow:false}).catch(error=>state.report(error))}/>}
    {tag&&status==='success'&&<Button icon="tag" disabled={busy} title={t('feedback.viewTag')} aria-label={t('feedback.viewTag')} onClick={()=>state.setCheckedRefs([`refs/tags/${tag.name}`])}/>}
    {status === 'error' && <Button icon="output" onClick={showLog}>{t("feedback.showLog")}</Button>}
    {status !== 'running' && <Button icon="close" aria-label={t("feedback.dismissNotification")} onClick={dismissFeedback}/>}
  </div>;
}
