import { useEffect, useState } from 'react';
import type { RebasePlan, RebaseStep } from '../src/protocol/interactive-rebase';
import type { ReflogPage } from '../src/protocol/reflog';
import { useWorkbench } from './store';
import { rpc } from './rpc';
import { useTranslation } from './i18n';
import { Button, Modal } from './ui';
import { RevisionInspector } from './RevisionInspector';
import './revision-tools.css';
export function InteractiveRebaseDialog({ start, onClose }: { start?: string; onClose():void }) {
  const t=useTranslation(),state=useWorkbench(),repoId=state.repoId!;
  const [scope,setScope]=useState(start??''),[loadedScope,setLoadedScope]=useState(start??''),[plan,setPlan]=useState<RebasePlan>(),[steps,setSteps]=useState<RebaseStep[]>([]),[selected,setSelected]=useState<string>(),[loading,setLoading]=useState(false),[error,setError]=useState<string>(),[acknowledgePublished,setAcknowledgePublished]=useState(false),[backup,setBackup]=useState<string>(),[completed,setCompleted]=useState(false);
  const busy=state.busy||loading,changed=!!plan&&(state.snapshot?.head!==plan.head||state.snapshot?.branch!==plan.branch),expired=!!plan&&Date.now()>plan.expires;
  async function load() {setLoading(true);setError(undefined);setPlan(undefined);setBackup(undefined);setCompleted(false);setAcknowledgePublished(false);try{const value=await rpc<RebasePlan>('prepareInteractiveRebase',repoId,scope.trim()?{start:scope.trim()}:{});setPlan(value);setLoadedScope(scope.trim());setSteps(value.commits.map(commit=>({oid:commit.oid,action:'pick',message:commit.message})));setSelected(value.commits[0]?.oid);}catch(error){setError((error as Error).message);}finally{setLoading(false);}}
  useEffect(()=>{void load();},[repoId]);
  function move(index:number,to:number) {if(!Number.isInteger(index)||!Number.isInteger(to)||index<0||index>=steps.length||to<0||to>=steps.length||busy)return;setSteps(values=>{const copy=[...values],item=copy.splice(index,1)[0];copy.splice(to,0,item);return copy;});}
  function update(index:number,value:Partial<RebaseStep>){setSteps(values=>values.map((step,i)=>i===index?{...step,...value}:step));}
  let retained=false;const invalid=steps.some(step=>{if(step.action==='drop')return false;if(step.action==='squash'||step.action==='fixup'){if(!retained)return true;}else retained=true;return (step.action==='squash'||step.action==='reword')&&!step.message?.trim();});
  async function execute() {if(!plan)return;setError(undefined);const ok=await state.execute({type:'rebase.interactive',token:plan.token,steps,acknowledgePublished});if(ok){setCompleted(true);try{const logs=await rpc<ReflogPage>('reflog',repoId,{});setBackup(logs.recoveries.find(item=>item.oid===plan.head)?.ref);}catch{ /* Recovery references remain available in Reflog. */ }}else setError(useWorkbench.getState().error);}
  return <Modal className="revision-dialog" title={t('interactiveRebase.title')} busy={busy} onClose={onClose}>
    <p>{t('interactiveRebase.hint')}</p>
    <div className="revision-controls"><label>{t('interactiveRebase.start')}<input value={scope} disabled={busy||completed} placeholder={t('interactiveRebase.defaultScope')} onChange={event=>setScope(event.target.value)}/></label><Button icon="refresh" aria-label={t('interactiveRebase.load')} title={t('interactiveRebase.load')} disabled={busy||completed} onClick={()=>void load()}/></div>
    {error&&<p role="alert">{error}</p>}{state.snapshot?.operation.managedRebase&&<Button onClick={()=>{state.selectWorking();onClose();}}>{t('interactiveRebase.reviewPaused')}</Button>}{plan&&<p>{plan.branch} · {t('interactiveRebase.base')}: {plan.base.slice(0,12)} · {t('interactiveRebase.head')}: {plan.head.slice(0,12)}</p>}
    {plan&&scope.trim()!==loadedScope&&!completed&&<p role="alert">{t('interactiveRebase.scopeDraft')}</p>}{changed&&!completed&&<p role="alert">{t('interactiveRebase.changed')}</p>}{expired&&!completed&&<p role="alert">{t('interactiveRebase.changed')}</p>}
    {completed?<p role="status">{t('interactiveRebase.completed')} {backup&&<code>{backup}</code>}</p>:<>
      <div className="revision-columns"><ol className="rebase-plan" aria-label={t('interactiveRebase.order')}>
        {steps.map((step,index)=><li key={step.oid} className={step.action==='drop'?'rebase-drop':''} draggable={!busy} onDragStart={event=>event.dataTransfer.setData('text/alwaygit-rebase',String(index))} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const source=event.dataTransfer.getData('text/alwaygit-rebase');if(/^\d+$/.test(source))move(Number(source),index);}} onKeyDown={event=>{if(event.altKey&&(event.key==='ArrowUp'||event.key==='ArrowDown')){event.preventDefault();move(index,index+(event.key==='ArrowUp'?-1:1));}}}>
          <div className="rebase-row"><Button icon="arrow-up" disabled={busy||index===0} aria-label={t('interactiveRebase.up')} title={t('interactiveRebase.up')} onClick={()=>move(index,index-1)}/><Button icon="arrow-down" disabled={busy||index===steps.length-1} aria-label={t('interactiveRebase.down')} title={t('interactiveRebase.down')} onClick={()=>move(index,index+1)}/><select aria-label={t('interactiveRebase.action')} value={step.action} disabled={busy} onChange={event=>update(index,{action:event.target.value as RebaseStep['action']})}>{(['pick','reword','squash','fixup','drop'] as const).map(action=><option value={action} key={action}>{t(({pick:'interactiveRebase.pick',reword:'interactiveRebase.reword',squash:'interactiveRebase.squash',fixup:'interactiveRebase.fixup',drop:'interactiveRebase.drop'} as const)[action])}</option>)}</select></div>
          <button className="button rebase-commit" aria-pressed={selected===step.oid} onClick={()=>setSelected(step.oid)}>{step.oid.slice(0,8)} {plan?.commits.find(commit=>commit.oid===step.oid)?.subject}{plan?.published.includes(step.oid)&&<span> · {t('interactiveRebase.publishedLabel')}</span>}</button>
          {(step.action==='reword'||step.action==='squash')&&<label>{step.action==='squash'?t('interactiveRebase.combinedMessage'):t('interactiveRebase.message')}<textarea value={step.message??''} disabled={busy} onChange={event=>update(index,{message:event.target.value})}/></label>}
        </li>)}
      </ol><RevisionInspector repoId={repoId} oid={selected}/></div>
      {invalid&&<p role="alert">{t('interactiveRebase.invalid')}</p>}
      {!!plan?.published.length&&<label><input type="checkbox" disabled={busy} checked={acknowledgePublished} onChange={event=>setAcknowledgePublished(event.target.checked)}/>{t('interactiveRebase.acknowledge')}</label>}
      <p>{t('interactiveRebase.recovery')}</p><Button className="primary" disabled={!plan||busy||changed||expired||invalid||scope.trim()!==loadedScope||!!plan.published.length&&!acknowledgePublished} onClick={()=>void execute()}>{t('interactiveRebase.execute')}</Button>
    </>}
  </Modal>;
}
