import { useRef, useState } from 'react';
import type { GitAction, Snapshot } from '../src/protocol/types';
import { branchNameProblem, type BranchNameProblem } from '../src/protocol/ref-name';
import { useWorkbench } from './store';
import { demoMode, rpc } from './rpc';
import { useTranslation } from './i18n';
import { Button, Modal } from './ui';
import { samePath } from './pathIdentity';
import { RemoteTrackingDialog } from './RemoteTrackingDialog';

export type ActionType = GitAction['type'];
export interface DialogRequest { type: ActionType; target?: string; sources?: string[]; batch?: boolean; paths?: string[]; names?:string[]; expectedOids?:Record<string,string>; remoteBranches?:string[]; pop?: boolean; expectedOid?: string; remote?: string; branch?: string; checkout?: boolean; candidates?: string[] }
export const actionTitles: Partial<Record<ActionType, string>> = { 'branch.create': 'Create Branch', 'branch.checkout': 'Checkout', 'commit.checkout': 'Checkout', 'branch.delete': 'Delete Branch', 'remote.delete':'Delete Remote Branches', 'tag.create': 'Create Tag', 'tag.delete': 'Delete Tag', 'stash.create': 'Stash Changes', 'stash.apply': 'Apply Stash', 'stash.drop': 'Drop Stash', 'worktree.add': 'Add Worktree', 'worktree.remove': 'Remove Worktree', merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick', revert: 'Revert', reset: 'Reset', fetch: 'Fetch', pull: 'Pull', push: 'Push', discard: 'Discard Changes', 'operation.abort': 'Abort' };
function pushDefaults(snapshot: Snapshot, dialog: DialogRequest) {
  const localBranch=dialog.branch??snapshot.branch,ref=snapshot.refs.find(item=>item.kind==='local'&&item.name===localBranch),upstream=ref?.upstream;
  const upstreamRemote=(snapshot.remotes??[]).slice().sort((a,b)=>b.length-a.length).find(remote=>upstream?.startsWith(`${remote}/`));
  const current=localBranch===snapshot.pushTarget?.localBranch?snapshot.pushTarget:undefined;
  const remote=dialog.remote??current?.remote??upstreamRemote??((snapshot.remotes?.length??0)===1?snapshot.remotes![0]:'');
  const remoteBranch=current?.remoteBranch??(upstreamRemote?upstream!.slice(upstreamRemote.length+1):localBranch);
  return {localBranch,remote,remoteBranch,configured:current?.configured??!!upstream};
}
function branchStartLabel(snapshot:Snapshot,start:string,t:(en:string,zh:string)=>string):string {
  const ref=snapshot.refs.find(item=>item.fullName===start);
  if(ref?.kind==='local')return ref.name===snapshot.branch?t(`Current branch ${ref.name} · current version`,`当前分支 ${ref.name} · 当前版本`):t(`Branch ${ref.name}`,`分支 ${ref.name}`);
  if(ref?.kind==='remote')return t(`Remote branch ${ref.name}`,`远程分支 ${ref.name}`);
  if(ref?.kind==='tag')return `Tag ${ref.name}`;
  if(start==='HEAD'||start===snapshot.head)return snapshot.branch?t(`Current branch ${snapshot.branch} · current version`,`当前分支 ${snapshot.branch} · 当前版本`):t('Current Commit','当前 Commit');
  return `Commit ${start.slice(0,12)}`;
}
export function ActionDialog({ dialog, onClose, openAbort }: { dialog: DialogRequest; onClose(): void; openAbort(): void }) {
  if(dialog.type==='branch.track')return <RemoteTrackingDialog dialog={dialog} onClose={onClose}/>;
  return <StandardActionDialog dialog={dialog} onClose={onClose} openAbort={openAbort}/>;
}
function StandardActionDialog({ dialog, onClose, openAbort }: { dialog: DialogRequest; onClose(): void; openAbort(): void }) {
  const state = useWorkbench(), snapshot = state.snapshot!, t = useTranslation(), { type } = dialog;
  const local = snapshot.refs.filter(r => r.kind === 'local'), tags = snapshot.refs.filter(r => r.kind === 'tag');
  const push=pushDefaults(snapshot,dialog);
  const [stashChoices] = useState(() => snapshot.stashes);
  const [values, setValues] = useState<Record<string, string>>({
    target: dialog.target ?? state.selectedOid ?? snapshot.head ?? 'HEAD', start: dialog.target ?? snapshot.head ?? 'HEAD',
    name: ['branch.checkout','branch.delete','tag.delete'].includes(type) ? dialog.target ?? (type === 'tag.delete' ? tags[0]?.name : local.find(r => r.name !== snapshot.branch)?.name) ?? '' : '',
    selector: dialog.target ?? snapshot.stashes[0]?.selector ?? '', path: type === 'worktree.remove' ? dialog.target ?? '' : '',
    strategy: 'ff-only', mode: 'mixed', remote: type==='push'?push.remote:dialog.remote ?? '', branch: type==='push'?push.localBranch:dialog.branch ?? '', remoteBranch:type==='push'?push.remoteBranch:'', newBranch: '', message: '', mainline: '',
  });
  const [checks, setChecks] = useState<Record<string, boolean>>({ checkout: dialog.checkout ?? false, includeUntracked: true, pop: !!dialog.pop });
  const [customizePush,setCustomizePush]=useState(()=>type==='push'&&!push.remote);
  const [validation, setValidation] = useState<string>();
  const [branchTouched,setBranchTouched]=useState(false),branchInput=useRef<HTMLInputElement>(null);
  const set = (key: string, value: string) => { if(key==='selector')useWorkbench.setState({stashApplyFailure:undefined,error:undefined});setValues(old => ({ ...old, [key]: value })); };
  const field = (key: string, en: string, zh: string = en, options?: { value: string; label: string }[], required = false, hint?: string) => <label className="form-field"><span>{t(en, zh)}</span>{options ? <select aria-label={en} required={required} disabled={state.busy} value={values[key]} onChange={e => set(key,e.target.value)}>{!options.length && <option value="">{t('None available','暂无可用项')}</option>}{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input aria-label={en} required={required} disabled={state.busy} value={values[key]} onChange={e => set(key,e.target.value)} placeholder={hint} />}{hint && <small className="muted">{hint}</small>}</label>;
  const checkbox = (key: string, en: string, zh: string = en) => <label className="form-checkbox"><input type="checkbox" checked={!!checks[key]} disabled={state.busy} onChange={e => setChecks(old => ({ ...old,[key]:e.target.checked }))} />{t(en,zh)}</label>;
  const title = type === 'stash.apply' && checks.pop ? 'Pop Stash' : type==='branch.delete'&&(dialog.names?.length??0)>1?'Delete Branches':actionTitles[type] ?? type;
  const stashFailure=type==='stash.apply'&&state.stashApplyFailure?.selector===values.selector?state.stashApplyFailure:undefined;
  const branch = snapshot.branch || 'Detached HEAD';
  const displayTarget = snapshot.refs.find(r => r.fullName === values.target)?.name ?? values.target;
  const branchProblem=type==='branch.create'?branchNameProblem(values.name):undefined;
  const branchProblemText=(problem:BranchNameProblem)=>{
    switch(problem){
      case 'empty':return t('Enter a branch name.','请输入分支名称。');
      case 'leading-hyphen':return t('Branch names cannot start with a hyphen.','分支名称不能以连字符开头。');
      case 'space':return t('Branch names cannot contain spaces. Try feature/ux-flow.','分支名称不能包含空格，可用 feature/ux-flow。');
      case 'control':return t('Branch names cannot contain control characters.','分支名称不能包含控制字符。');
      case 'invalid-character':return t('Branch names cannot contain ~, ^, :, ?, *, [, or backslash.','分支名称不能包含 ~、^、:、?、*、[ 或反斜杠。');
      case 'double-dot':return t('Branch names cannot contain two consecutive dots.','分支名称不能包含连续两个点。');
      case 'reflog':return t('Branch names cannot contain @{.','分支名称不能包含 @{。');
      case 'slash':return t('Branch names cannot start or end with a slash, or contain consecutive slashes.','分支名称不能以斜杠开头或结尾，也不能包含连续斜杠。');
      case 'dot-component':return t('Branch name segments cannot start with a dot.','分支名称的各段不能以点开头。');
      case 'lock-suffix':return t('Branch name segments cannot end with .lock.','分支名称的各段不能以 .lock 结尾。');
      case 'trailing-dot':return t('Branch names cannot end with a dot.','分支名称不能以点结尾。');
      case 'single-at':return t('A branch name cannot be only @.','分支名称不能只有 @。');
    }
  };
  async function executeAction(branchCheckout?:boolean) {
    setValidation(undefined); const v = Object.fromEntries(Object.entries(values).map(([key,value]) => [key,type==='branch.create'&&key==='name'?value:value.trim()])); let action: GitAction;
    if(type==='branch.create'&&branchProblem){setBranchTouched(true);setValidation(branchProblemText(branchProblem));branchInput.current?.focus();return;}
    switch(type) {
      case 'fetch': action={type,remote:v.remote || undefined}; break;
      case 'pull': action={type,remote:v.remote || undefined,strategy:v.strategy as 'ff-only'|'merge'|'rebase'}; break;
      case 'push': if(!v.branch||!v.remote||!v.remoteBranch){setValidation(t('Select a local branch, remote, and remote branch.','请选择本地分支、远端和远端分支。'));return;} action={type,remote:v.remote,branch:v.branch,remoteBranch:v.remoteBranch,setUpstream:!push.configured,forceWithLease:!!checks.forceWithLease}; break;
      case 'branch.create': action={type,name:v.name,start:v.start || undefined,checkout:branchCheckout??true}; break;
      case 'branch.checkout': action={type,name:v.name}; break;
      case 'commit.checkout': action={type,target:v.target}; break;
      case 'branch.delete': action={type,names:dialog.names?.length?dialog.names:[v.name],force:!!checks.force,expectedOids:dialog.expectedOids}; break;
      case 'remote.delete': if(!dialog.remote||!dialog.remoteBranches?.length)return;action={type,remote:dialog.remote,branches:dialog.remoteBranches,expectedOids:dialog.expectedOids};break;
      case 'tag.create': action={type,name:v.name,target:v.target,message:v.message || undefined}; break;
      case 'tag.delete': action={type,name:v.name}; break;
      case 'stash.create': action={type,message:v.message || undefined,includeUntracked:!!checks.includeUntracked}; break;
      case 'stash.apply': case 'stash.drop': { const stash=stashChoices.find(s => s.selector===v.selector),expectedOid=v.selector===dialog.target?dialog.expectedOid??stash?.oid:stash?.oid; if(!expectedOid){setValidation(t('Select a Stash and try again.','请选择 Stash 后重试。'));return;} action=type==='stash.apply'?{type,selector:v.selector,pop:!!checks.pop,expectedOid}:{type,selector:v.selector,expectedOid}; break; }
      case 'worktree.add':
        if (v.branch && v.newBranch || checks.detach && (v.branch || v.newBranch)) { setValidation(t('Choose an existing branch, a new branch, or Detached HEAD.','请选择已有分支、新分支或 Detached HEAD 中的一项。')); return; }
        action={type,path:v.path,branch:v.branch || undefined,newBranch:v.newBranch || undefined,start:v.start || undefined,detach:!!checks.detach}; break;
      case 'worktree.remove': action={type,path:v.path,force:!!checks.force}; break;
      case 'merge': case 'rebase': action={type,target:v.target}; break;
      case 'cherry-pick': case 'revert': { const mainline=v.mainline?Number(v.mainline):undefined; if(mainline!==undefined && (!Number.isInteger(mainline)||mainline<1)){setValidation(t('Mainline parent must be a positive integer.','Mainline 父 Commit 序号必须为正整数。'));return;} action={type,commits:v.target.split(/[\s,]+/).filter(Boolean),mainline,expectedHead:snapshot.head,expectedBranch:snapshot.branch||undefined}; break; }
      case 'reset': action={type,target:v.target,mode:v.mode as 'soft'|'mixed'|'hard'}; break;
      case 'discard': action={type,paths:dialog.paths ?? []}; break;
      case 'operation.abort': if(!snapshot.operation.kind)return; action={type,kind:snapshot.operation.kind}; break;
      default: return;
    }
    if(await state.execute(action)){if(['branch.checkout','commit.checkout'].includes(action.type)||action.type==='branch.create'&&action.checkout){const latest=useWorkbench.getState();if(latest.repoId===state.repoId&&latest.snapshot?.head)void latest.selectCommit(latest.snapshot.head);}onClose();}
  }
  const submit=(event:React.FormEvent)=>{event.preventDefault();void executeAction(type==='branch.create'?true:undefined);};
  const destructive = ['discard','branch.delete','remote.delete','tag.delete','stash.drop','worktree.remove','operation.abort'].includes(type) || type==='reset' && values.mode==='hard';
  if (snapshot.operation.kind && ['merge','rebase','cherry-pick','revert','pull'].includes(type)) {
    const kind=snapshot.operation.kind, files=snapshot.changes.filter(file=>file.conflict);
    return <Modal title={t(`${kind} paused`,`${kind} 已暂停`)} busy={state.busy} onClose={onClose} footer={<>
      <Button disabled={state.busy} onClick={onClose}>{t('Close This Window','关闭此窗口')}</Button>
      <Button className="danger" disabled={state.busy} onClick={openAbort}>{t(`Abort ${kind}…`,`中止本次 ${kind}…`)}</Button>
      <Button className="primary" icon="files" disabled={state.busy} onClick={()=>{onClose();state.selectWorking();const file=files[0]??snapshot.changes.find(file=>file.indexStatus!==' '&&!file.untracked);if(file)state.selectFile({kind:'change',path:file.path,area:file.conflict?'conflict':'staged'});state.setLayout({diffCollapsed:false});}}>{files.length?t('View & Handle Conflicts','查看并处理冲突'):t('Review Staged Result','检查暂存结果')}</Button>
    </>}><p>{snapshot.repository.name} · {branch}</p><p>{t('Closing this window leaves the Git operation paused. Edit and save conflicting files, then return to mark and stage the result.','关闭此窗口后 Git 操作仍处于暂停状态。请编辑保存冲突文件，再返回这里标记并暂存结果。')}</p>{state.error&&<details><summary>{t('Git details','Git 详情')}</summary><pre>{state.error}</pre></details>}</Modal>;
  }
  return <Modal title={title} busy={state.busy} onClose={onClose} footer={stashFailure?<Button onClick={onClose} disabled={state.busy}>{t('Cancel and keep current state','取消并保留当前状态')}</Button>:type==='branch.create'?<><Button onClick={onClose} disabled={state.busy}>{t('Cancel','取消')}</Button><Button type="button" disabled={state.busy||!!branchProblem} onClick={()=>void executeAction(false)}>{t('Create Only','仅创建')}</Button><Button type="submit" form="ag-action-form" className="primary" disabled={state.busy||!!branchProblem}>{state.busy?t('Working…','处理中…'):t('Create and Checkout','创建并切换')}</Button></>:<><Button onClick={onClose} disabled={state.busy}>{t('Cancel','取消')}</Button><Button type="submit" form="ag-action-form" className={destructive?'danger':'primary'} disabled={state.busy}>{state.busy?t('Working…','处理中…'):title}</Button></>}><form id="ag-action-form" className="action-form" onSubmit={submit}>
    <p className="muted">{snapshot.repository.name} · {branch}</p>
    {type==='branch.create' && <><label className="form-field"><span>{t('Branch Name','分支名称')}</span><input ref={branchInput} aria-label="Branch Name" aria-invalid={branchTouched&&!!branchProblem||undefined} aria-describedby={branchTouched&&branchProblem?'branch-name-error':undefined} required disabled={state.busy} value={values.name} onChange={event=>{setBranchTouched(true);set('name',event.target.value);}} placeholder="feature/my-change"/>{branchTouched&&branchProblem&&<small id="branch-name-error" className="form-error">{branchProblemText(branchProblem)}</small>}</label><div className="branch-start-point"><span>{t('Start Point','起始位置')}</span><strong>{branchStartLabel(snapshot,values.start,t)}</strong><small>{t('The new branch starts from this selected version.','新分支将从这个选定版本开始。')}</small><details><summary>{t('Git details','Git 详情')}</summary><code>{values.start}</code></details></div></>}
    {(type==='branch.checkout'||type==='branch.delete') && <>{type==='branch.delete'&&dialog.names?.length?<div className="discard-paths">{dialog.names.map(name=><div key={name}>{name}</div>)}</div>:field('name','Branch','分支',(dialog.candidates ? local.filter(r=>dialog.candidates!.includes(r.name)) : local.filter(r=>type!=='branch.delete'||r.name!==snapshot.branch)).map(r=>({value:r.name,label:r.name})),true)}{type==='branch.delete'&&checkbox('force','Force deletion of unmerged branches','强制删除尚未合并的分支')}{type==='branch.checkout'&&<p>{t('Checkout preserves changes when possible; Git stops if they would be overwritten.','Checkout 会尽可能保留修改；可能覆盖修改时 Git 会停止操作。')}</p>}</>}
    {type==='remote.delete'&&<><strong>{t(`Delete from ${dialog.remote}`,`从 ${dialog.remote} 删除`)}</strong><div className="discard-paths">{dialog.remoteBranches?.map(name=><div key={name}>{name}</div>)}</div><p className="warning-text">{t('This deletes branches from the shared remote repository.','此操作会从共享远端仓库删除分支。')}</p></>}
    {type==='commit.checkout'&&<><strong>Checkout {displayTarget}</strong><p>{t('No local branch was selected. This enters Detached HEAD. Create a branch to keep new commits.','此操作进入 Detached HEAD。可以创建分支来保留新的 Commit。')}</p></>}
    {type==='tag.create'&&<>{field('name','Tag Name','Tag 名称',undefined,true)}{field('target','Target Commit','目标 Commit',undefined,true)}{field('message','Annotation (optional)','说明（可选）')}</>}
    {type==='tag.delete'&&field('name','Tag','Tag',tags.map(r=>({value:r.name,label:r.name})),true)}
    {type==='stash.create'&&<>{field('message','Description (optional)','说明（可选）')}{checkbox('includeUntracked','Include untracked files','包含未跟踪文件')}<p>{t('Save Staged and Unstaged Changes for later, then clean the Working Tree.','保存 Staged 和 Unstaged Changes 供之后恢复，并清理工作区。')}</p></>}
    {(type==='stash.apply'||type==='stash.drop')&&<>{field('selector','Stash','Stash',stashChoices.map(s=>({value:s.selector,label:`${s.selector}: ${s.subject}`})),true)}<p>{type==='stash.drop'?t('Remove this entry. Its saved changes may become unreachable.','移除此条目；其中保存的修改可能无法恢复。'):checks.pop?t('Apply changes and remove the Stash only on success. A conflict preserves the entry.','应用修改，成功后移除 Stash；发生冲突时保留条目。'):t('Apply changes and keep this Stash.','应用修改，并保留此 Stash。')}</p>{stashFailure&&<section className="stash-apply-blocker" role="alert"><strong>{t('Cannot restore because these files already exist in the project.','无法恢复，因为项目中已存在以下文件。')}</strong><p>{t('Existing files were not overwritten. The Stash is still saved. Compare or open a file before deciding how to resolve it.','现有文件未被覆盖，收起记录仍然保留。请先比较或打开文件，再决定如何处理。')}</p><div className="stash-conflict-files">{stashFailure.paths.map(path=><div className="stash-conflict-file" key={path}><code>{path}</code><div><Button type="button" className="icon-only" icon="diff" title={t('Compare saved and existing file','比较收起内容与现有文件')} aria-label={`${t('Compare saved and existing file','比较收起内容与现有文件')}: ${path}`} onClick={()=>void rpc('diff',state.repoId,{kind:'stash-working',stashOid:stashFailure.stashOid,path}).catch(state.report)}/><Button type="button" className="icon-only" icon="go-to-file" title={t('Open existing file','打开现有文件')} aria-label={`${t('Open existing file','打开现有文件')}: ${path}`} onClick={()=>void rpc('openFile',state.repoId,{path}).catch(state.report)}/></div></div>)}</div><p className="muted">{t('Resolve the name or content collision, then choose the Stash again if you still want to restore it.','解决文件名或内容冲突后，如仍需恢复，请重新选择该 Stash。')}</p>{state.error&&<details><summary>{t('Git details','Git 详情')}</summary><pre>{state.error}</pre></details>}</section>}</>}
    {type==='worktree.add'&&<>{field('path','Worktree Folder','Worktree 目录',undefined,true)}<Button type="button" icon="folder-opened" onClick={()=>void rpc<string|undefined>('pickWorktree',state.repoId,{}).then(path=>{if(path)set('path',path);}).catch(state.report)}>{t('Browse…','浏览…')}</Button>{field('branch','Existing Branch','已有分支',[{value:'',label:t('None','无')},...local.map(r=>({value:r.name,label:r.name}))])}{field('newBranch','New Branch (optional)','新分支（可选）')}{field('start','Start Point','起始位置')}{checkbox('detach','Detached HEAD')}</>}
    {type==='worktree.remove'&&<>{field('path','Worktree','Worktree',snapshot.worktrees.filter(w=>!samePath(w.path,snapshot.repository.root)&&!w.locked&&w!==snapshot.worktrees[0]).map(w=>({value:w.path,label:w.path})),true)}{checkbox('force','Remove even with uncommitted changes','强制移除，包括未提交修改')}</>}
    {(type==='merge'||type==='rebase')&&<>{field('target',type==='merge'?'Merge Source':'New Base',type==='merge'?'Merge 来源':'新的基点',undefined,true)}<strong>{type==='merge'?`Merge ${displayTarget} into ${branch}`:`Rebase ${branch} onto ${displayTarget}`}</strong><p>{type==='merge'?t('Bring selected history into the current branch.','将选中的历史 Merge 到当前分支。'):t('Replay current-branch commits onto the selected base. Replayed Commit IDs change.','将当前分支的 Commit 重新应用到选定基点；这些 Commit 的 ID 会改变。')}</p></>}
    {(type==='cherry-pick'||type==='revert')&&<>{field('target','Commit IDs','Commit ID',undefined,true)}{field('mainline','Mainline Parent (Merge Commits only)','Mainline 父 Commit（仅 Merge Commit）')}<strong>{type==='cherry-pick'?`Cherry-pick ${displayTarget} onto ${branch}`:`Revert ${displayTarget} on ${branch}`}</strong><p>{type==='revert'?t('Create new commits reversing these changes.','生成新的 Commit 撤销这些修改。'):t('Apply these commits to the current branch in the entered order.','按输入顺序将这些 Commit 应用到当前分支。')}</p></>}
    {type==='reset'&&<>{field('target','Target Commit','目标 Commit',undefined,true)}{field('mode','Reset Mode','Reset 模式',[{value:'soft',label:'Soft'},{value:'mixed',label:'Mixed'},{value:'hard',label:'Hard'}])}<strong>Reset {branch} to {displayTarget}</strong><p className={values.mode==='hard'?'warning-text':''}>{values.mode==='soft'?t('Keep Index and Working Tree changes.','保留 Index 和工作区修改。'):values.mode==='mixed'?t('Reset Index; keep Working Tree changes.','重置 Index；保留工作区修改。'):t('Reset Index and tracked Working Tree files. Uncommitted tracked changes will be lost.','重置 Index 和工作区中的已跟踪文件；这些文件的未提交修改将丢失。')}</p></>}
    {['fetch','pull'].includes(type)&&<>{field('remote','Remote (optional)','远端（可选）')}{type==='pull'&&field('strategy','Pull Strategy','Pull 策略',[{value:'ff-only',label:'Fast-forward Only'},{value:'merge',label:'Merge'},{value:'rebase',label:'Rebase'}])}</>}
    {type==='push'&&<><div className="push-target"><span>{t('Push Target','Push 目标')}</span><strong>{values.branch} <span aria-hidden="true">→</span> {values.remote?`${values.remote}/${values.remoteBranch}`:t('Select remote','选择远端')}</strong><dl><div><dt>{t('Local Branch','本地分支')}</dt><dd>{values.branch}</dd></div><div><dt>{t('Remote','远端')}</dt><dd>{values.remote||'—'}</dd></div><div><dt>{t('Remote Branch','远端分支')}</dt><dd>{values.remoteBranch||'—'}</dd></div></dl></div>{(!customizePush||!!push.remote)&&<Button type="button" icon="settings-gear" onClick={()=>{setCustomizePush(value=>!value);if(customizePush){set('remote',push.remote);set('remoteBranch',push.remoteBranch);}}}>{customizePush?t('Use Default Target','使用默认目标'):t('Change Target…','更改目标…')}</Button>}{customizePush&&<>{field('remote','Remote','远端',[{value:'',label:t('Select remote…','选择远端…')},...[...new Set([values.remote,...(snapshot.remotes??[])].filter(Boolean))].map(remote=>({value:remote,label:remote}))],true)}{field('remoteBranch','Remote Branch','远端分支',undefined,true)}</>}{checkbox('forceWithLease','Force-with-lease')}{!push.configured&&<p className="muted">{t('This Push will set the selected target as the upstream branch.','本次 Push 会将所选目标设置为 upstream 分支。')}</p>}</>}
    {type==='discard'&&<><div className="discard-paths">{dialog.paths?.map(path=><div key={path}>{path}</div>)}</div><p className="warning-text">{t('Discard Unstaged Changes and selected untracked files. Staged Changes remain in the Index.','丢弃 Unstaged Changes 和选中的未跟踪文件。Index 中的 Staged Changes 保留。')}</p></>}
    {type==='operation.abort'&&<><p className="warning-text">{t(`Abort the active ${snapshot.operation.kind}; edits made while resolving conflicts may be discarded. Closing this window does not abort.`,`中止当前 ${snapshot.operation.kind}；解决冲突期间的修改可能被丢弃。关闭此窗口不会中止操作。`)}</p>{snapshot.operation.originalHead&&<p>{t('Git will attempt to restore the operation start state at Commit ','Git 将尝试恢复到操作开始时的状态，Commit ')}<code>{snapshot.operation.originalHead}</code>{t('. Pre-existing local changes may prevent a full restoration.','。操作前已有的本地修改可能影响完整恢复。')}</p>}</>}
    {validation&&!(type==='branch.create'&&branchProblem)&&<p role="alert" className="form-error">{validation}</p>}{state.error&&!stashFailure&&(type==='branch.create'?<details><summary>{t('Git details','Git 详情')}</summary><pre>{state.error}</pre></details>:<p role="alert" className="form-error">{state.error}</p>)}{demoMode&&<p className="muted">{t('Demo: sample data only.','模拟操作：仅修改示例数据。')}</p>}
  </form></Modal>;
}
