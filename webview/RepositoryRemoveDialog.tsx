import { Button, Icon, Modal } from './ui';

import { useState } from 'react';
import type { RepositoryGroup } from '../src/protocol/repositories';
import { rpc } from './rpc';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';


export function RepositoryRemoveDialog({groups,onClose}:{groups:RepositoryGroup[];onClose():void}){
  const state=useWorkbench(),t=useTranslation(),[busy,setBusy]=useState(false),[error,setError]=useState<string>();
  const count=groups.length;
  const remove=async()=>{setBusy(true);setError(undefined);try{const removed=await rpc<number>('removeRepositories',undefined,{keys:groups.map(group=>group.key)});await state.initialize();useWorkbench.setState({notice:removed===1 ? t("repositoriesRemove.removed1RepositoryFromAlwayGit") : t("repositoriesRemove.removedRepositoriesFromAlwayGit", { removed: (removed) }),selectedRepositoryKeys:[],repositorySelectionAnchor:undefined});onClose();}catch(reason){setError(reason instanceof Error?reason.message:String(reason));setBusy(false);}};
  return <Modal title={count===1 ? t("repositoriesRemove.removeRepository") : t("repositoriesRemove.removeRepositories", { count: (count) })} busy={busy} onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>{t("common.cancel")}</Button><Button className="danger" icon="trash" disabled={busy} onClick={()=>void remove()}>{busy?t("repositoriesRemove.removing"):count===1 ? t("repositoriesRemove.removeRepository") : t("repositoriesRemove.removeRepositories", { count: (count) })}</Button></>}>
    <div className="repository-remove-warning"><Icon name="warning"/><div><strong>{t("repositoriesRemove.removeFromAlwayGitOnly")}</strong><p>{t("repositoriesRemove.filesOnDiskAndGitHistoryWillNotBe")}</p></div></div>
    <div className="repository-batch-list">{groups.map(group=><div key={group.key}><strong>{group.name}</strong><span>{group.repository.root}</span></div>)}</div>
    {error&&<div className="banner error" role="alert"><span>{error}</span></div>}
  </Modal>;
}
