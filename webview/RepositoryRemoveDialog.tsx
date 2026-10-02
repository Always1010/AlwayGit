import { useState } from 'react';
import type { RepositoryGroup } from '../src/protocol/repositories';
import { rpc } from './rpc';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { Button, Icon, Modal } from './ui';

export function RepositoryRemoveDialog({groups,onClose}:{groups:RepositoryGroup[];onClose():void}){
  const state=useWorkbench(),t=useTranslation(),[busy,setBusy]=useState(false),[error,setError]=useState<string>();
  const count=groups.length;
  const remove=async()=>{setBusy(true);setError(undefined);try{const removed=await rpc<number>('removeRepositories',undefined,{keys:groups.map(group=>group.key)});await state.initialize();useWorkbench.setState({notice:t(removed===1?'Removed 1 repository from AlwayGit.':`Removed ${removed} repositories from AlwayGit.`,removed===1?'已从 AlwayGit 移除 1 个仓库。':`已从 AlwayGit 移除 ${removed} 个仓库。`),selectedRepositoryKeys:[],repositorySelectionAnchor:undefined});onClose();}catch(reason){setError(reason instanceof Error?reason.message:String(reason));setBusy(false);}};
  return <Modal title={t(count===1?'Remove Repository':`Remove ${count} Repositories`,count===1?'移除仓库':`移除 ${count} 个仓库`)} busy={busy} onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>{t('Cancel','取消')}</Button><Button className="danger" icon="trash" disabled={busy} onClick={()=>void remove()}>{busy?t('Removing…','正在移除…'):t(count===1?'Remove Repository':`Remove ${count} Repositories`,count===1?'移除仓库':`移除 ${count} 个仓库`)}</Button></>}>
    <div className="repository-remove-warning"><Icon name="warning"/><div><strong>{t('Remove from AlwayGit only','仅从 AlwayGit 中移除')}</strong><p>{t('Files on disk and Git history will not be deleted. You can add these repositories again later.','不会删除磁盘上的文件或 Git 历史，之后仍可重新添加这些仓库。')}</p></div></div>
    <div className="repository-batch-list">{groups.map(group=><div key={group.key}><strong>{group.name}</strong><span>{group.repository.root}</span></div>)}</div>
    {error&&<div className="banner error" role="alert"><span>{error}</span></div>}
  </Modal>;
}
