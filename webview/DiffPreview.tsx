import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { rpc } from './rpc';
import { alignDiff, changedParts } from './diff';
import { Button, Empty } from './ui';

interface Preview {path:string;leftLabel:string;rightLabel:string;left:string;right:string;binary?:boolean;truncated?:boolean}
function content(value:string|undefined,other:string|undefined,changed:boolean,side:'before'|'after') {
  if(value===undefined)return null;
  if(!changed||other===undefined)return <code>{value}</code>;
  const parts=changedParts(side==='before'?value:other,side==='before'?other:value),middle=side==='before'?parts.before:parts.after;
  return <code>{parts.prefix}{middle&&<mark className={side==='before'?'diff-word-removed':'diff-word-added'}>{middle}</mark>}{parts.suffix}</code>;
}
export function DiffPreview({ native, edit }: { native():void; edit():void }) {
  const state=useWorkbench(),t=useTranslation(),[preview,setPreview]=useState<Preview>(),[error,setError]=useState<string>(),[loading,setLoading]=useState(false),viewport=useRef<HTMLDivElement>(null);
  useEffect(()=>{let live=true;setPreview(undefined);setError(undefined);const target=state.diffTarget;if(!target){setLoading(false);return;}setLoading(true);void rpc<Preview>('diffPreview',state.repoId,target).then(value=>{if(live)setPreview(value);}).catch(error=>{if(live)setError(error instanceof Error?error.message:String(error));}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[state.repoId,state.diffTarget,state.snapshot?.version]);
  const rows=useMemo(()=>preview&&!preview.binary?alignDiff(preview.left,preview.right):[],[preview]);
  const virtual=useVirtualizer({count:rows.length,getScrollElement:()=>viewport.current,estimateSize:()=>22,overscan:8});
  useEffect(()=>{viewport.current?.scrollTo({top:0});},[preview]);
  return <section className="diff-preview" data-testid="diff-preview"><div className="pane-heading"><span className="truncate">Diff · {state.selectedFile||t('No file selected','未选择文件')}</span><div className="inline-actions"><Button icon="diff" onClick={native} disabled={!state.diffTarget}>Open Diff</Button><Button icon="go-to-file" onClick={edit} disabled={!state.selectedFile}>{t('Edit in VS Code','在 VS Code 中编辑')}</Button></div></div>
    {preview&&<div className="diff-labels"><span>{preview.leftLabel}</span><span>{preview.rightLabel}</span></div>}
    {preview?.truncated&&<div className="history-caption">{t('Preview is truncated. Open Diff to inspect the full comparison.','预览已截断；可以 Open Diff 查看完整比较。')}</div>}
    <div className="diff-viewport" ref={viewport}>
      {loading?<Empty title={t('Loading Diff…','正在读取 Diff…')}/>:error?<p className="form-error" role="alert">{error}</p>:preview?.binary?<Empty title={t('Binary file: text preview unavailable','二进制文件：无法提供文本预览')}/>:!preview?<Empty title={t('Select a file to preview its Diff','选择文件以预览 Diff')}/>:<div style={{height:virtual.getTotalSize(),position:'relative'}}>{virtual.getVirtualItems().map(item=>{const row=rows[item.index];return <div key={item.index} className="diff-line" style={{position:'absolute',width:'100%',height:22,transform:`translateY(${item.start}px)`}}><div className={`${row.changed&&row.before!==undefined?'removed':''}`}><span className="diff-marker" aria-hidden="true">{row.changed&&row.before!==undefined?'−':''}</span><span className="line-number">{row.beforeLine??''}</span>{content(row.before,row.after,row.changed,'before')}</div><div className={`${row.changed&&row.after!==undefined?'added':''}`}><span className="diff-marker" aria-hidden="true">{row.changed&&row.after!==undefined?'+':''}</span><span className="line-number">{row.afterLine??''}</span>{content(row.after,row.before,row.changed,'after')}</div></div>;})}</div>}
    </div>
  </section>;
}
