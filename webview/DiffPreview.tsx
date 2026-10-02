import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { rpc } from './rpc';
import { alignDiff, changeAtRow, changedParts, changedRanges, remapChange, summarizeChanges, type DiffRow } from './diff';
import { Button, Empty } from './ui';
import { diffKey } from './refresh';
import { diffRowHeight } from './appearance';

interface Preview {path:string;leftLabel:string;rightLabel:string;left:string;right:string;binary?:boolean;truncated?:boolean}
interface Selection {key:string;rows:readonly DiffRow[];index:number}
function content(value:string|undefined,other:string|undefined,changed:boolean,side:'before'|'after',scrollLeft:number) {
  if(value===undefined)return null;
  const style={transform:`translateX(-${scrollLeft}px)`};
  if(!changed||other===undefined)return <code style={style}>{value}</code>;
  const parts=changedParts(side==='before'?value:other,side==='before'?other:value),middle=side==='before'?parts.before:parts.after;
  return <code style={style}>{parts.prefix}{middle&&<mark className={side==='before'?'diff-word-removed':'diff-word-added'}>{middle}</mark>}{parts.suffix}</code>;
}
export function DiffPreview({ native, edit }: { native():void; edit():void }) {
  const state=useWorkbench(),t=useTranslation(),[preview,setPreview]=useState<Preview>(),[error,setError]=useState<string>(),[loading,setLoading]=useState(false),[selection,setSelection]=useState<Selection>(),[horizontalScroll,setHorizontalScroll]=useState(0),[viewportWidth,setViewportWidth]=useState(0),viewport=useRef<HTMLDivElement>(null),displayedKey=useRef(''),lastScrollTop=useRef(0),navigationScroll=useRef<number|undefined>(undefined);
  const collapsed=state.layout.diffCollapsed;
  const initiallyPositioned=useRef(false);
  useLayoutEffect(()=>{
    const element=viewport.current;if(!element)return;
    const measure=()=>setViewportWidth(element.clientWidth);
    measure();const observer=new ResizeObserver(measure);observer.observe(element);
    return()=>observer.disconnect();
  },[collapsed]);
  const targetKey=JSON.stringify([state.repoId,diffKey(state.diffTarget)]),revision=state.diffTarget?.kind==='change'?state.diffRevision:0;
  useEffect(()=>{
    let live=true;
    if(displayedKey.current!==targetKey){displayedKey.current=targetKey;initiallyPositioned.current=false;setPreview(undefined);setSelection(undefined);setHorizontalScroll(0);lastScrollTop.current=0;navigationScroll.current=undefined;viewport.current?.scrollTo({top:0,left:0});}
    setError(undefined);
    const target=state.diffTarget;if(!target){setLoading(false);return;}
    setLoading(true);
    void rpc<Preview>('diffPreview',state.repoId,target).then(value=>{if(live)setPreview(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);}).catch(error=>{if(live)setError(error instanceof Error?error.message:String(error));}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[targetKey,revision]);
  const rows=useMemo(()=>preview&&!preview.binary?alignDiff(preview.left,preview.right):[],[preview]);
  const ROW_HEIGHT=diffRowHeight(state.appearance.codeFont,state.appearance.codeRowHeight);
  const virtual=useVirtualizer({count:rows.length,getScrollElement:()=>viewport.current,estimateSize:()=>ROW_HEIGHT,overscan:8});
  const totalHeight=virtual.getTotalSize(),previousRowHeight=useRef(ROW_HEIGHT),pendingTopRow=useRef<number|undefined>(undefined);
  useLayoutEffect(()=>{
    const element=viewport.current,topRow=(element?.scrollTop??lastScrollTop.current)/previousRowHeight.current;
    if(previousRowHeight.current!==ROW_HEIGHT){
      if(element)pendingTopRow.current=topRow;
      else lastScrollTop.current=topRow*ROW_HEIGHT;
    }
    previousRowHeight.current=ROW_HEIGHT;virtual.measure();
  },[ROW_HEIGHT]);
  useLayoutEffect(()=>{
    const element=viewport.current;
    // Wait for the remeasured spacer; the old height can clamp the new offset.
    if(!element||pendingTopRow.current===undefined||totalHeight!==rows.length*ROW_HEIGHT)return;
    navigationScroll.current=Math.max(0,Math.min(pendingTopRow.current*ROW_HEIGHT,totalHeight-element.clientHeight));
    pendingTopRow.current=undefined;
    virtual.scrollToOffset(navigationScroll.current);
    lastScrollTop.current=element.scrollTop;
  },[ROW_HEIGHT,totalHeight,rows.length,collapsed]);
  const changes=useMemo(()=>changedRanges(rows),[rows]);
  const summary=useMemo(()=>summarizeChanges(rows,changes),[rows,changes]);
  const activeChange=selection?.key===targetKey?selection.rows===rows?Math.min(selection.index,changes.length-1):remapChange(selection.rows,rows,selection.index):changes.length?0:-1;
  useLayoutEffect(()=>{setSelection({key:targetKey,rows,index:activeChange});},[targetKey,rows]);
  const jump=(next:number)=>{
    if(!changes.length||!viewport.current)return;
    const index=(next+changes.length)%changes.length,block=changes[index],height=viewport.current.clientHeight;
    setSelection({key:targetKey,rows,index});
    const top=(block.end-block.start+1)*ROW_HEIGHT>height?block.start*ROW_HEIGHT:(block.start+block.end+1)*ROW_HEIGHT/2-height/2;
    navigationScroll.current=Math.max(0,Math.min(top,virtual.getTotalSize()-height));
    virtual.scrollToOffset(navigationScroll.current);
  };
  useLayoutEffect(()=>{
    const element=viewport.current;
    if(!element||!initiallyPositioned.current)return;
    navigationScroll.current=lastScrollTop.current;
    element.scrollTo({top:lastScrollTop.current,left:horizontalScroll});
  },[collapsed]);
  useLayoutEffect(()=>{
    if(initiallyPositioned.current||displayedKey.current!==targetKey||!preview||collapsed||!viewportWidth||!viewport.current?.clientHeight)return;
    initiallyPositioned.current=true;
    jump(0);
  },[targetKey,rows,collapsed,viewportWidth]);
  const trackScroll=()=>{
    const element=viewport.current;if(!element)return;
    setHorizontalScroll(element.scrollLeft);
    if(element.scrollTop===lastScrollTop.current)return;
    lastScrollTop.current=element.scrollTop;
    if(navigationScroll.current!==undefined&&Math.abs(element.scrollTop-navigationScroll.current)<2){navigationScroll.current=undefined;return;}
    navigationScroll.current=undefined;
    const index=changeAtRow(changes,(element.scrollTop+element.clientHeight/2)/ROW_HEIGHT);
    setSelection(current=>current?.key===targetKey&&current.rows===rows&&current.index===index?current:{key:targetKey,rows,index});
  };
  const contentColumns=useMemo(()=>{
    let columns=0;
    for(const row of rows)for(const value of [row.before,row.after]){
      let length=0;
      for(const character of value??'')length+=character==='\t'?4-length%4:character.codePointAt(0)!>0x2ff?2:1;
      columns=Math.max(columns,length);
    }
    return columns;
  },[rows]);
  // The scroll spacer represents overflow within one half; comparison columns
  // retain their visible width and only code moves beneath the fixed gutters.
  const contentWidth=`max(100%, calc(${contentColumns}ch + ${viewportWidth/2+64}px))`;
  const highlighted=activeChange>=0?changes[activeChange]:undefined;
  const openLabel=t('Open Diff','打开 Diff'),editLabel=t('Edit in VS Code','在 VS Code 中编辑'),previousLabel=t('Previous change','上一处修改'),nextLabel=t('Next change','下一处修改'),toggleLabel=collapsed?t('Expand Diff panel','展开 Diff 面板'):t('Minimize Diff panel','最小化 Diff 面板');
  const previousHint=changes.length===1?t('Locate the only change','定位唯一修改'):t('Previous change (wraps to the last)','上一处修改（从首处循环到末处）'),nextHint=changes.length===1?t('Locate the only change','定位唯一修改'):t('Next change (wraps to the first)','下一处修改（从末处循环到首处）');
  const countLabel=t('Change blocks','修改块'),countText=`${activeChange<0?0:activeChange+1}/${changes.length}${preview?.truncated?t(' (preview)','（预览）'):''}`,addedLabel=t('Added blocks','新增块'),modifiedLabel=t('Modified blocks','修改块'),removedLabel=t('Removed blocks','删除块');
  const statusLabel=`${addedLabel}: ${summary.added}; ${modifiedLabel}: ${summary.modified}; ${removedLabel}: ${summary.removed}; ${countLabel}: ${countText}`;
  return <section className="diff-preview" data-testid="diff-preview"><div className="pane-heading"><span className="truncate">Diff · {state.selectedFile||t('No file selected','未选择文件')}</span><div className="inline-actions"><Button className="icon-only" icon="diff" title={openLabel} aria-label={openLabel} onClick={native} disabled={!state.diffTarget}/><Button className="icon-only" icon="go-to-file" title={editLabel} aria-label={editLabel} onClick={edit} disabled={!state.selectedFile}/><span className="diff-change-summary" data-testid="diff-change-summary" role="status" aria-label={statusLabel}><span className="diff-change-kind diff-change-added" title={addedLabel} aria-hidden="true">+{summary.added}</span><span className="diff-change-kind diff-change-modified" title={modifiedLabel} aria-hidden="true">~{summary.modified}</span><span className="diff-change-kind diff-change-removed" title={removedLabel} aria-hidden="true">−{summary.removed}</span></span>{!collapsed&&<><Button className="icon-only" icon="arrow-up" title={previousHint} aria-label={previousLabel} onClick={()=>jump(activeChange-1)} disabled={!changes.length}/><Button className="icon-only" icon="arrow-down" title={nextHint} aria-label={nextLabel} onClick={()=>jump(activeChange+1)} disabled={!changes.length}/></>}<span className="diff-change-count" data-testid="diff-change-count" aria-hidden="true" title={preview?.truncated?t('Change blocks in the truncated preview','截断预览中的修改块'):countLabel}>{countText}</span><span className="diff-toolbar-divider"/><Button className="icon-only diff-panel-toggle" icon={collapsed?'chevron-up':'chevron-down'} title={toggleLabel} aria-label={toggleLabel} onClick={()=>state.setLayout({diffCollapsed:!collapsed})}/></div></div>
    {!collapsed&&<>{preview&&<div className="diff-labels"><span>{preview.leftLabel}</span><span>{preview.rightLabel}</span></div>}
    {preview?.truncated&&<div className="history-caption">{t('Preview is truncated. Open Diff to inspect the full comparison.','预览已截断；可以 Open Diff 查看完整比较。')}</div>}
    <div className="diff-viewport" ref={viewport} onScroll={trackScroll}>
      {error&&<p className="form-error" role="alert">{error}</p>}
      {loading&&!preview?<Empty title={t('Loading Diff…','正在读取 Diff…')}/>:preview?.binary?<Empty title={t('Binary file: text preview unavailable','二进制文件：无法提供文本预览')}/>:!preview?(!error&&<Empty title={t('Select a file to preview its Diff','选择文件以预览 Diff')}/>):<div className="diff-content" style={{height:virtual.getTotalSize(),position:'relative',width:contentWidth}}>{virtual.getVirtualItems().map(item=>{const row=rows[item.index],active=!!highlighted&&item.index>=highlighted.start&&item.index<=highlighted.end;return <div key={item.index} className={`diff-line${active?' active-change':''}${active&&item.index===highlighted?.start?' active-change-start':''}${active&&item.index===highlighted?.end?' active-change-end':''}`} style={{position:'absolute',left:horizontalScroll,width:viewportWidth||'100%',height:ROW_HEIGHT,transform:`translateY(${item.start}px)`}}><div className={`${row.changed&&row.before!==undefined?'removed':''}`}><span className="diff-marker" aria-hidden="true">{row.changed&&row.before!==undefined?'−':''}</span><span className="line-number">{row.beforeLine??''}</span><span className="diff-code">{content(row.before,row.after,row.changed,'before',horizontalScroll)}</span></div><div className={`${row.changed&&row.after!==undefined?'added':''}`}><span className="diff-marker" aria-hidden="true">{row.changed&&row.after!==undefined?'+':''}</span><span className="line-number">{row.afterLine??''}</span><span className="diff-code">{content(row.after,row.before,row.changed,'after',horizontalScroll)}</span></div></div>;})}</div>}
    </div></>}
  </section>;
}
