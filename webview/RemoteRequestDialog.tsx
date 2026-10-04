import { useState } from 'react';
import type { HostingRepository, RemoteLinks } from '../src/protocol/types';
import { hostingRepository, requestWebUrl } from '../src/protocol/hosting';
import { branchNameProblem } from '../src/protocol/ref-name';
import { captureActionContext, isActionContextCurrent, useWorkbench } from './store';
import { useTranslation } from './i18n';
import { uiText } from './text';
import { rpc } from './rpc';
import { Button, Modal } from './ui';

let remoteRequestGeneration = 0;
let activeRemoteRequestIdentity = '';

function beginRemoteRequest(repoId: string, branch: string, source?: HostingRepository, remote?: string, localBranch?: string) {
  const sourceIdentity = source ? { url: source.url, label: source.label, provider: source.provider } : undefined;
  const identity = `${++remoteRequestGeneration}:${JSON.stringify({ repoId, branch, source: sourceIdentity, remote, localBranch })}`;
  activeRemoteRequestIdentity = identity;
  return { identity, context: captureActionContext() };
}

export function closeRemoteRequest(identity?: string) {
  const displayed = useWorkbench.getState().remoteRequest;
  if (identity && displayed?.identity !== identity) return;
  ++remoteRequestGeneration;
  activeRemoteRequestIdentity = '';
  useWorkbench.setState({ remoteRequest: undefined });
}

export async function showRemoteRequest(repoId: string, branch: string, source?: HostingRepository, remote?: string, localBranch?: string) {
  if (useWorkbench.getState().repoId !== repoId) return;
  const request = beginRemoteRequest(repoId, branch, source, remote, localBranch);
  const current = () => useWorkbench.getState().repoId === repoId && activeRemoteRequestIdentity === request.identity && isActionContextCurrent(request.context);
  try {
    const links = await rpc<RemoteLinks>('remoteLinks', repoId, { remote, branch: localBranch });
    if (!current()) return;
    const repositories = source ? [source] : links?.repositories?.filter(repository => !!repository.provider) ?? [];
    if (!repositories.length) { useWorkbench.getState().report(new Error(uiText('feedback.noHostingLinks'))); return; }
    useWorkbench.setState({ remoteRequest: { identity: request.identity, repoId, branch, repositories, defaultBranch: links?.defaultBranch } });
  } catch (error) {
    if (!current()) return;
    if (source) useWorkbench.setState({ remoteRequest: { identity: request.identity, repoId, branch, repositories: [source] } });
    else useWorkbench.getState().report(error);
  }
}

export function RemoteRequestDialog() {
  const request = useWorkbench(state => state.remoteRequest), t = useTranslation();
  const [sourceIndex, setSourceIndex] = useState(0), [base, setBase] = useState(request?.defaultBranch ?? '');
  const [target, setTarget] = useState(request?.repositories[0]?.url ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  if (!request) return null;
  const source = request.repositories[sourceIndex], destination = hostingRepository(target);
  const url = source && destination && (!base || !branchNameProblem(base)) ? requestWebUrl(source, request.branch, base || undefined, destination) : undefined;
  const close = () => closeRemoteRequest(request.identity);
  const open = async () => {
    if (!url) return; setBusy(true); setError(undefined);
    try { await rpc('openExternal', request.repoId, { url }); close(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <Modal title={source?.provider === 'gitlab' ? t('feedback.createMR') : t('feedback.createPR')} onClose={close} busy={busy} footer={<>
    <Button icon="copy" disabled={!url || busy} title={t('feedback.copyRequestLink')} aria-label={t('feedback.copyRequestLink')} onClick={()=>void rpc('copyText',request.repoId,{text:url}).catch(error=>setError(String(error)))}/>
    <Button disabled={busy} onClick={close}>{t('common.cancel')}</Button>
    <Button className="primary" icon="link-external" disabled={!url || busy} onClick={()=>void open()}>{t('feedback.continueOnWebsite')}</Button>
  </>}>
    <div className="remote-request-fields">
      <label>{t('feedback.sourceRepository')}<select value={sourceIndex} disabled={busy} onChange={event=>{const index=Number(event.target.value);setSourceIndex(index);setTarget(request.repositories[index].url);}}>{request.repositories.map((repository,index)=><option key={repository.url} value={index}>{repository.label}</option>)}</select></label>
      <p>{t('feedback.sourceBranch')}: <strong>{request.branch}</strong></p>
      <label>{t('feedback.targetRepository')}<input value={target} disabled={busy} onChange={event=>setTarget(event.target.value)}/></label>
      <label>{t('feedback.targetBranch')}<input data-autofocus="true" value={base} disabled={busy} onChange={event=>setBase(event.target.value)}/></label>
      <p className="muted">{t('feedback.requestWebsiteHint')}</p>
      {!url && <p className="warning-text">{t('feedback.invalidRequestTarget')}</p>}
      {error && <p className="warning-text" role="alert">{error}</p>}
    </div>
  </Modal>;
}
