import { useEffect, useRef, useState } from 'react';
import type { BranchComparison as Comparison, BranchComparisonQuery, CommitDetails, DiffTarget, Snapshot } from '../src/protocol/types';
import { Button, Empty, Icon, Modal } from './ui';
import { useTranslation } from './i18n';
import { useWorkbenchFields } from './subscriptions';
import { DiffPreview } from './DiffPreview';
import { VirtualFileRows } from './VirtualFileRows';
import { filterFilesByPath } from './fileSelection';
import { rpc } from './rpc';

export function comparisonUpdated(value: Comparison, snapshot?: Snapshot): boolean {
  if (!snapshot) return false;
  const oid = (name: string) => name === 'HEAD' ? snapshot.head : snapshot.refs.find(ref => ref.fullName === name)?.oid;
  return oid(value.baseRef) !== value.baseOid || oid(value.targetRef) !== value.targetOid;
}

/** All selections and immutable snapshots belong to this dialog, never the graph store. */
export function BranchComparison({ repoId, initialBase, initialTarget, onClose }: { repoId: string; initialBase: string; initialTarget: string; onClose(): void }) {
  const { snapshot } = useWorkbenchFields('snapshot'), t = useTranslation();
  const [baseRef, setBaseRef] = useState(initialBase), [targetRef, setTargetRef] = useState(initialTarget);
  const [result, setResult] = useState<Comparison>(), [loading, setLoading] = useState(false), [error, setError] = useState<string>();
  const [detail, setDetail] = useState<CommitDetails>(), [selected, setSelected] = useState<DiffTarget>(), [filter, setFilter] = useState('');
  const sequence = useRef(0), controller = useRef<AbortController | undefined>(undefined);
  const load = async (query: BranchComparisonQuery, append?: 'base' | 'target') => {
    const request = ++sequence.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setLoading(true); setError(undefined);
    if (!append) { setResult(undefined); setDetail(undefined); setSelected(undefined); setFilter(''); }
    try {
      const value = await rpc<Comparison>('branchComparison', repoId, query, { signal: abort.signal });
      if (request !== sequence.current) return;
      setResult(previous => append && previous ? { ...value, base: append === 'base' ? { ...value.base, commits: [...previous.base.commits, ...value.base.commits] } : previous.base, target: append === 'target' ? { ...value.target, commits: [...previous.target.commits, ...value.target.commits] } : previous.target } : value);
      if (!append && value.diffBase && value.files[0]) setSelected({ kind: 'comparison', left: value.diffBase, right: value.targetOid, path: value.files[0].path, previousPath: value.files[0].previousPath });
    } catch (failure) { if (request === sequence.current && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (request === sequence.current) setLoading(false); }
  };
  useEffect(() => { void load({ baseRef: initialBase, targetRef: initialTarget }); return () => { ++sequence.current; controller.current?.abort(); }; }, [repoId]);
  const pinned = (): BranchComparisonQuery => ({ baseRef: result!.baseRef, targetRef: result!.targetRef, baseOid: result!.baseOid, targetOid: result!.targetOid, mode: result!.mode, mergeBase: result!.mergeBase });
  const inspect = async (oid: string) => {
    const request = ++sequence.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort; setLoading(true); setError(undefined); setSelected(undefined);
    try { const value = await rpc<CommitDetails>('inspectDetails', repoId, { oid }, { signal: abort.signal }); if (request !== sequence.current) return; setDetail(value); const file = value.files[0]; if (file) setSelected({ kind: 'commit', oid: value.commit.oid, parent: value.parent, path: file.path, previousPath: file.previousPath }); }
    catch (failure) { if (request === sequence.current && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (request === sequence.current) setLoading(false); }
  };
  const files = detail?.files ?? result?.files ?? [], visible = filterFilesByPath(files, filter);
  const targetFor = (file: typeof files[number]): DiffTarget => detail ? { kind: 'commit', oid: detail.commit.oid, parent: detail.parent, path: file.path, previousPath: file.previousPath } : { kind: 'comparison', left: result!.diffBase!, right: result!.targetOid, path: file.path, previousPath: file.previousPath };
  const native = () => { if (selected) void rpc('diff', repoId, selected).catch(failure => setError(String(failure))); };
  const edit = () => { if (selected) void rpc('openFile', repoId, {path:selected.path}).catch(failure => setError(String(failure))); };
  const options = [...(snapshot?.refs.filter(ref => ref.kind === 'local' || ref.kind === 'remote') ?? [])];
  for (const name of [baseRef, targetRef]) if (name !== 'HEAD' && !options.some(ref => ref.fullName === name)) options.push({ name, fullName: name, kind: 'local', oid: '' });
  return <Modal title={t('comparison.title')} className="branch-comparison-modal" onClose={onClose} footer={null}>
    <div className="comparison-controls">
      <label>{t('comparison.base')}<select aria-label={t('comparison.base')} value={baseRef} disabled={loading} onChange={event => { setBaseRef(event.target.value); void load({ baseRef: event.target.value, targetRef, mode: result?.mode }); }}><option value="HEAD">HEAD</option>{options.map(ref => <option key={ref.fullName} value={ref.fullName}>{ref.name}</option>)}</select></label>
      <Button className="icon-only" icon="arrow-swap" title={t('comparison.reverse')} aria-label={t('comparison.reverse')} disabled={loading || !result} onClick={() => { if (!result) return; setBaseRef(result.targetRef); setTargetRef(result.baseRef); void load({ baseRef: result.targetRef, targetRef: result.baseRef, baseOid: result.targetOid, targetOid: result.baseOid, mode: result.mode }); }}/>
      <label>{t('comparison.target')}<select aria-label={t('comparison.target')} value={targetRef} disabled={loading} onChange={event => { setTargetRef(event.target.value); void load({ baseRef, targetRef: event.target.value, mode: result?.mode }); }}><option value="HEAD">HEAD</option>{options.map(ref => <option key={ref.fullName} value={ref.fullName}>{ref.name}</option>)}</select></label>
      <select aria-label={t('comparison.mode')} value={result?.mode ?? 'review'} disabled={loading || !result} onChange={event => void load({ ...pinned(), mode: event.target.value as 'review' | 'snapshot' })}><option value="review">{t('comparison.review')}</option><option value="snapshot">{t('comparison.snapshot')}</option></select>
      <Button className="icon-only" icon="refresh" title={t('comparison.refresh')} aria-label={t('comparison.refresh')} disabled={loading} onClick={() => void load({ baseRef, targetRef, mode: result?.mode })}/>
    </div>
    {result && <div className="history-caption"><span title={result.baseOid}>{result.baseOid.slice(0,8)}</span> <Icon name="arrow-right"/> <span title={result.targetOid}>{result.targetOid.slice(0,8)}</span>{result.mergeBase && <span> · {t('comparison.mergeBase')}: {result.mergeBase.slice(0,8)}</span>}{comparisonUpdated(result, snapshot) && <strong role="status"> · {t('comparison.updated')}</strong>}</div>}
    {error && <div className="warning-text" role="alert">{error}</div>}
    {loading && <div role="status">{t('comparison.loading')}</div>}
    {result && <div className="comparison-content" aria-busy={loading}>
      <div className="comparison-commits">{(['base', 'target'] as const).map(side => <section key={side}><strong>{t(side === 'base' ? 'comparison.baseOnly' : 'comparison.targetOnly', {count: result[side].total})}</strong><div className="comparison-commit-list">{result[side].commits.map(commit => <button key={commit.oid} disabled={loading} title={`${commit.oid}\n${commit.subject}`} onClick={() => void inspect(commit.oid)}><code>{commit.oid.slice(0,8)}</code> {commit.subject}</button>)}</div>{result[side].hasMore && <Button disabled={loading} icon="chevron-down" onClick={() => void load({ ...pinned(), [`${side}Offset`]: result[side].nextOffset }, side)}>{t('comparison.more')}</Button>}</section>)}</div>
      {!detail && result.mode === 'review' && !result.diffBase && <div className="warning-text" role="status">{t(result.mergeBases.length ? 'comparison.multipleBases' : 'comparison.noBase')}{result.mergeBases.length > 1 && <select aria-label={t('comparison.mergeBase')} value="" disabled={loading} onChange={event => void load({ ...pinned(), mergeBase: event.target.value })}><option value="">{t('comparison.chooseBase')}</option>{result.mergeBases.map(oid => <option key={oid} value={oid}>{oid}</option>)}</select>}</div>}
      <div className="comparison-file-heading"><strong>{detail ? `${detail.commit.oid.slice(0,8)} · ${detail.commit.subject}` : t('comparison.files', {count: files.length})}</strong>{detail && <Button className="icon-only" icon="arrow-left" title={t('comparison.back')} aria-label={t('comparison.back')} onClick={() => { setDetail(undefined); setSelected(undefined); setFilter(''); }}/>}<input type="search" aria-label={t('details.filterChangedFilePaths')} placeholder={t('details.filterPaths')} value={filter} onChange={event => setFilter(event.target.value)}/></div>
      {detail?.body && <pre className="comparison-message">{detail.body}</pre>}
      <div className="comparison-file-diff"><div className="comparison-files" role="group" aria-label={t('details.changedFiles')}><VirtualFileRows items={visible} getKey={file => file.path} scrollParent=".comparison-files">{file => <button aria-pressed={selected?.path === file.path} key={file.path} disabled={loading} className={`file-item ${selected?.path === file.path ? 'preview-current' : ''}`} title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path} onClick={() => setSelected(targetFor(file))}><span className={`file-status status-${file.status[0]}`}>{file.status}</span><span className="truncate">{file.path}</span></button>}</VirtualFileRows>{!files.length && result.diffBase && <Empty title={t('details.theSelectedCommitsHaveIdenticalFileContents')}/>}</div><DiffPreview isolated={{ repoId, target: loading ? undefined : selected }} native={native} edit={edit}/></div>
    </div>}
  </Modal>;
}
