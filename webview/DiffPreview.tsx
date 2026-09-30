import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { rpc } from './rpc';
import { alignDiff, changedParts, changedRanges } from './diff';
import { Button, Empty } from './ui';
import { diffKey } from './refresh';

interface Preview {path:string;leftLabel:string;rightLabel:string;left:string;right:string;binary?:boolean;truncated?:boolean}
function content(value:string|undefined,other:string|undefined,changed:boolean,side:'before'|'after') {
  if(value===undefined)return null;
  if(!changed||other===undefined)return <code>{value}</code>;
  const parts=changedParts(side==='before'?value:other,side==='before'?other:value),middle=side==='before'?parts.before:parts.after;
  return <code>{parts.prefix}{middle&&<mark className={side==='before'?'diff-word-removed':'diff-word-added'}>{middle}</mark>}{parts.suffix}</code>;
}
export function DiffPreview({ native, edit }: { native():void; edit():void }) {
  const state=useWorkbench(),t=useTranslation(),[preview,setPreview]=useState<Preview>(),[error,setError]=useState<string>(),[loading,setLoading]=useState(false),[activeChange,setActiveChange]=useState(-1),viewport=useRef<HTMLDivElement>(null),displayedKey=useRef('');
  const targetKey=JSON.stringify([state.repoId,diffKey(state.diffTarget)]),revision=state.diffTarget?.kind==='change'?state.diffRevision:0;
  useEffect(()=>{
    let live=true;
    if(displayedKey.current!==targetKey){displayedKey.current=targetKey;setPreview(undefined);setActiveChange(-1);viewport.current?.scrollTo({top:0});}
    setError(undefined);
    const target=state.diffTarget;if(!target){setLoading(false);return;}
    setLoading(true);
    void rpc<Preview>('diffPreview',state.repoId,target).then(value=>{if(live)setPreview(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);}).catch(error=>{if(live)setError(error instanceof Error?error.message:String(error));}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[targetKey,revision]);
  const rows=useMemo(()=>preview&&!preview.binary?alignDiff(preview.left,preview.right):[],[preview]);
  const virtual=useVirtualizer({count:rows.length,getScrollElement:()=>viewport.current,estimateSize:()=>22,overscan:8});
  const changes=useMemo(()=>changedRanges(rows),[rows]);
  const jump=(next:number)=>{const block=changes[next];if(!block)return;setActiveChange(next);virtual.scrollToIndex(block.start,{align:'center'});};
  const highlighted=activeChange>=0?changes[activeChange]:undefined;
  const openLabel=t('Open Diff','打开 Diff'),editLabel=t('Edit in VS Code','在 VS Code 中编辑'),previousLabel=t('Previous change','上一处修改'),nextLabel=t('Next change','下一处修改');
  return <section className="diff-preview" data-testid="diff-preview"><div className="pane-heading"><span className="truncate">Diff · {state.selectedFile||t('No file selected','未选择文件')}</span><div className="inline-actions"><Button className="icon-only" icon="diff" title={openLabel} aria-label={openLabel} onClick={native} disabled={!state.diffTarget}/><Button className="icon-only" icon="go-to-file" title={editLabel} aria-label={editLabel} onClick={edit} disabled={!state.selectedFile}/><Button className="icon-only" icon="arrow-up" title={previousLabel} aria-label={previousLabel} onClick={()=>jump(activeChange-1)} disabled={activeChange<=0}/><Button className="icon-only" icon="arrow-down" title={nextLabel} aria-label={nextLabel} onClick={()=>jump(activeChange+1)} disabled={!changes.length||activeChange>=changes.length-1}/></div></div>
    {preview&&<div className="diff-labels"><span>{preview.leftLabel}</span><span>{preview.rightLabel}</span></div>}
    {preview?.truncated&&<div className="history-caption">{t('Preview is truncated. Open Diff to inspect the full comparison.','预览已截断；可以 Open Diff 查看完整比较。')}</div>}
    <div className="diff-viewport" ref={viewport}>
      {error&&<p className="form-error" role="alert">{error}</p>}
      {loading&&!preview?<Empty title={t('Loading Diff…','正在读取 Diff…')}/>:preview?.binary?<Empty title={t('Binary file: text preview unavailable','二进制文件：无法提供文本预览')}/>:!preview?(!error&&<Empty title={t('Select a file to preview its Diff','选择文件以预览 Diff')}/>):<div style={{height:virtual.getTotalSize(),position:'relative'}}>{virtual.getVirtualItems().map(item=>{const row=rows[item.index],active=!!highlighted&&item.index>=highlighted.start&&item.index<=highlighted.end;return <div key={item.index} className={`diff-line ${active?'active-change':''}`} style={{position:'absolute',width:'100%',height:22,transform:`translateY(${item.start}px)`}}><div className={`${row.changed&&row.before!==undefined?'removed':''}`}><span className="diff-marker" aria-hidden="true">{row.changed&&row.before!==undefined?'−':''}</span><span className="line-number">{row.beforeLine??''}</span>{content(row.before,row.after,row.changed,'before')}</div><div className={`${row.changed&&row.after!==undefined?'added':''}`}><span className="diff-marker" aria-hidden="true">{row.changed&&row.after!==undefined?'+':''}</span><span className="line-number">{row.afterLine??''}</span>{content(row.after,row.before,row.changed,'after')}</div></div>;})}</div>}
    </div>
  </section>;
}
