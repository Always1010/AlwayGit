import { Button, Empty } from './ui';

import { uiText } from './text';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useWorkbenchFields } from './subscriptions';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { rpc } from './rpc';
import { adjacentDiffFile, alignDiff, changeAtRow, changedParts, changedRanges, remapChange, summarizeChanges, type DiffDirection, type DiffRow } from './diff';

import { diffKey } from './refresh';
import { diffRowHeight } from './appearance';
import { useShortcuts } from './shortcuts';

interface Preview {path:string;leftLabel:string;rightLabel:string;left:string;right:string;binary?:boolean;truncated?:boolean}
interface Selection {key:string;rows:readonly DiffRow[];index:number}
function content(value:string|undefined,other:string|undefined,changed:boolean,side:'before'|'after',scrollLeft:number) {
  if(value===undefined)return null;
  const style={transform:`translateX(-${scrollLeft}px)`};
  if(!changed||other===undefined)return <code style={style}>{value}</code>;
  const parts=changedParts(side==='before'?value:other,side==='before'?other:value),middle=side==='before'?parts.before:parts.after;
  return <code style={style}>{parts.prefix}{middle&&<mark className={side==='before'?'diff-word-removed':'diff-word-added'}>{middle}</mark>}{parts.suffix}</code>;
}
function DiffPreviewPanel({ native, edit }: { native():void; edit():void }) {
  const state=useWorkbenchFields('appearance', 'diffNavigationScope', 'details', 'selectedStashOid', 'tab', 'diffRevision', 'diffTarget', 'layout', 'repoId', 'selectedFile', 'selectFile', 'setLayout'),t=useTranslation(),[preview,setPreview]=useState<Preview>(),[error,setError]=useState<string>(),[loading,setLoading]=useState(false),[selection,setSelection]=useState<Selection>(),[horizontalScroll,setHorizontalScroll]=useState(0),[viewportWidth,setViewportWidth]=useState(0),viewport=useRef<HTMLDivElement>(null),displayedKey=useRef(''),lastScrollTop=useRef(0),navigationScroll=useRef<number|undefined>(undefined);
  const [navigating,setNavigating]=useState(false),[navigationError,setNavigationError]=useState<string>(),[noNavigableFiles,setNoNavigableFiles]=useState(false),navigationRequest=useRef<AbortController|undefined>(undefined),preloaded=useRef<{key:string;preview:Preview}|undefined>(undefined),landing=useRef<{key:string;index:number}|undefined>(undefined);
  const collapsed=state.layout.diffCollapsed;
  const pendingNavigation=useRef<{key:string;direction:DiffDirection}|undefined>(undefined);
  const initiallyPositioned=useRef(false);
  useLayoutEffect(()=>{
    const element=viewport.current;if(!element)return;
    const measure=()=>setViewportWidth(element.clientWidth);
    measure();const observer=new ResizeObserver(measure);observer.observe(element);
    return()=>observer.disconnect();
  },[collapsed]);
  const targetKey=JSON.stringify([state.repoId,diffKey(state.diffTarget)]),revision=state.diffTarget?.kind==='change'?state.diffRevision:0;
  const commitTarget=state.diffTarget?.kind==='commit'?state.diffTarget:undefined;
  const commitFiles=state.diffNavigationScope==='commit'&&commitTarget&&!state.selectedStashOid&&state.tab==='history'&&state.details?.commit.oid===commitTarget.oid&&state.details.parent===commitTarget.parent?state.details.files:undefined;
  const fileIndex=commitFiles?.findIndex(file=>file.path===commitTarget?.path)??-1,commitMode=fileIndex>=0;
  const commitScopeKey=JSON.stringify(commitFiles);
  useLayoutEffect(()=>{
    navigationRequest.current?.abort();navigationRequest.current=undefined;
    setNavigating(false);setNavigationError(undefined);setNoNavigableFiles(false);
    if(landing.current?.key!==targetKey)landing.current=undefined;
    if(preloaded.current?.key!==targetKey)preloaded.current=undefined;
    return()=>{navigationRequest.current?.abort();};
  },[targetKey,commitScopeKey,state.diffNavigationScope,collapsed]);
  useEffect(()=>{
    let live=true;
    const controller=new AbortController();
    if(displayedKey.current!==targetKey){displayedKey.current=targetKey;initiallyPositioned.current=false;setPreview(undefined);setSelection(undefined);setHorizontalScroll(0);lastScrollTop.current=0;navigationScroll.current=undefined;viewport.current?.scrollTo({top:0,left:0});}
    setError(undefined);
    const target=state.diffTarget;if(!target){setLoading(false);return;}
    if(preloaded.current?.key===targetKey){setPreview(preloaded.current.preview);preloaded.current=undefined;setLoading(false);return;}
    setLoading(true);
    void rpc<Preview>('diffPreview',state.repoId,target,{signal:controller.signal}).then(value=>{if(live)setPreview(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);}).catch(error=>{if(live)setError(error instanceof Error?error.message:String(error));}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;controller.abort();};
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
  const navigate=async(direction:DiffDirection)=>{
    if(loading||navigationRequest.current||displayedKey.current!==targetKey)return;
    setNavigationError(undefined);
    const next=activeChange+direction;
    if(!commitMode||!commitFiles||!commitTarget){jump(next);return;}
    if(changes.length&&next>=0&&next<changes.length){jump(next);return;}
    const controller=new AbortController();navigationRequest.current=controller;setNavigating(true);
    let destination:Preview|undefined;
    const targets=commitFiles.map(file=>({...commitTarget,path:file.path,previousPath:file.previousPath}));
    try{
      const adjacent=await adjacentDiffFile(commitFiles.length,fileIndex,direction,async index=>{
        if(index===fileIndex)return changes.length;
        try{destination=await rpc<Preview>('diffPreview',state.repoId,targets[index],{signal:controller.signal});}
        catch(error){throw new Error(`${targets[index].path}: ${error instanceof Error?error.message:String(error)}`);}
        return destination.binary?0:changedRanges(alignDiff(destination.left,destination.right)).length;
      },controller.signal);
      const current=useWorkbench.getState();
      if(controller.signal.aborted||current.repoId!==state.repoId||diffKey(current.diffTarget)!==diffKey(commitTarget)||current.diffNavigationScope!=='commit')return;
      if(!adjacent){setNoNavigableFiles(true);return;}
      if(adjacent.fileIndex===fileIndex){jump(adjacent.changeIndex);return;}
      const target=targets[adjacent.fileIndex],key=JSON.stringify([state.repoId,diffKey(target)]);
      preloaded.current={key,preview:destination!};landing.current={key,index:adjacent.changeIndex};
      state.selectFile(target);
    }catch(error){if(!controller.signal.aborted)setNavigationError(error instanceof Error?error.message:String(error));}
    finally{if(navigationRequest.current===controller){navigationRequest.current=undefined;setNavigating(false);}}
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
    jump(landing.current?.key===targetKey?landing.current.index:0);landing.current=undefined;
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
  const openLabel=t("diff.openDiff"),editLabel=t("diff.editInVSCode"),previousLabel=t("diff.previousChange"),nextLabel=t("diff.nextChange"),toggleLabel=collapsed?t("diff.expandDiffPanel"):t("diff.minimizeDiffPanel");
  const previousHint=commitMode?t("diff.previousChangeAcrossCommitFilesWrapsToTheLast"):changes.length===1?t("diff.locateTheOnlyChange"):t("diff.previousChangeWrapsToTheLast"),nextHint=commitMode?t("diff.nextChangeAcrossCommitFilesWrapsToTheFirst"):changes.length===1?t("diff.locateTheOnlyChange"):t("diff.nextChangeWrapsToTheFirst");
  const countLabel=t("diff.changeBlocks"),blockCount=`${activeChange<0?0:activeChange+1}/${changes.length}${preview?.truncated?t("diff.preview"):''}`,countText=commitMode?`${t("diff.file")} ${fileIndex+1}/${commitFiles!.length} · ${t("diff.change")} ${blockCount}`:blockCount,addedLabel=t("diff.addedBlocks"),modifiedLabel=t("diff.modifiedBlocks"),removedLabel=t("diff.removedBlocks");
  const navigationDisabled=loading||navigating||noNavigableFiles||(!changes.length&&(!commitMode||commitFiles!.length<2));
  const moveChange=(direction:DiffDirection)=>{
    if(collapsed){pendingNavigation.current={key:targetKey,direction};state.setLayout({diffCollapsed:false});}
    else void navigate(direction);
  };
  useEffect(()=>{
    const pending=pendingNavigation.current;if(!pending)return;
    if(pending.key!==targetKey){pendingNavigation.current=undefined;return;}
    if(collapsed||navigationDisabled||!viewportWidth||!viewport.current?.clientHeight)return;
    pendingNavigation.current=undefined;void navigate(pending.direction);
  },[collapsed,targetKey,navigationDisabled,viewportWidth]);
  useShortcuts({
    diff:{enabled:!!state.diffTarget,run:native},edit:{enabled:!!state.selectedFile,run:edit},
    previousChange:{enabled:!!preview&&displayedKey.current===targetKey&&!navigationDisabled,run:()=>moveChange(-1)},
    nextChange:{enabled:!!preview&&displayedKey.current===targetKey&&!navigationDisabled,run:()=>moveChange(1)},
    toggleDiff:{enabled:true,run:()=>state.setLayout({diffCollapsed:!collapsed})},
  });
  const statusLabel=`${addedLabel}: ${summary.added}; ${modifiedLabel}: ${summary.modified}; ${removedLabel}: ${summary.removed}; ${countLabel}: ${countText}`;
  return <section className="diff-preview" data-testid="diff-preview"><div className="pane-heading"><span className="truncate">{uiText("diff.diff")}{state.selectedFile||t("diff.noFileSelected")}</span><div className="inline-actions"><Button className="icon-only" icon="diff" shortcut="diff" title={openLabel} aria-label={openLabel} onClick={native} disabled={!state.diffTarget}/><Button className="icon-only" icon="go-to-file" shortcut="edit" title={editLabel} aria-label={editLabel} onClick={edit} disabled={!state.selectedFile}/><span className="diff-change-summary" data-testid="diff-change-summary" role="status" aria-label={statusLabel}><span className="diff-change-kind diff-change-added" title={addedLabel} aria-hidden="true">+{summary.added}</span><span className="diff-change-kind diff-change-modified" title={modifiedLabel} aria-hidden="true">~{summary.modified}</span><span className="diff-change-kind diff-change-removed" title={removedLabel} aria-hidden="true">−{summary.removed}</span></span>{!collapsed&&<><Button className="icon-only" icon="arrow-up" shortcut="previousChange" title={previousHint} aria-label={previousLabel} onClick={()=>moveChange(-1)} disabled={navigationDisabled}/><Button className="icon-only" icon="arrow-down" shortcut="nextChange" title={nextHint} aria-label={nextLabel} onClick={()=>moveChange(1)} disabled={navigationDisabled}/></>}<span className="diff-change-count" data-testid="diff-change-count" aria-hidden="true" title={preview?.truncated?t("diff.changeBlocksInTheTruncatedPreview"):countLabel}>{countText}</span><span className="diff-toolbar-divider"/><Button className="icon-only diff-panel-toggle" shortcut="toggleDiff" icon={collapsed?'chevron-up':'chevron-down'} title={toggleLabel} aria-label={toggleLabel} onClick={()=>state.setLayout({diffCollapsed:!collapsed})}/></div></div>
    {!collapsed&&<>{preview&&<div className="diff-labels"><span>{preview.leftLabel}</span><span>{preview.rightLabel}</span></div>}
    {preview?.truncated&&<div className="history-caption">{t("diff.previewIsTruncatedOpenDiffToInspectTheFull")}</div>}
    <div className="diff-viewport" ref={viewport} onScroll={trackScroll}>
      {navigationError&&<p className="form-error" role="alert">{navigationError}</p>}
      {navigating&&<div className="history-caption" role="status">{t("diff.loadingTheNextDiffFile")}</div>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      {loading&&!preview?<Empty title={t("diff.loadingDiff")}/>:preview?.binary?<Empty title={t("diff.binaryFileTextPreviewUnavailable")}/>:!preview?(!error&&<Empty title={t("diff.selectAFileToPreviewItsDiff")}/>):<div className="diff-content" style={{height:virtual.getTotalSize(),position:'relative',width:contentWidth}}>{virtual.getVirtualItems().map(item=>{const row=rows[item.index],active=!!highlighted&&item.index>=highlighted.start&&item.index<=highlighted.end;return <div key={item.index} className={`diff-line${active?' active-change':''}${active&&item.index===highlighted?.start?' active-change-start':''}${active&&item.index===highlighted?.end?' active-change-end':''}`} style={{position:'absolute',left:horizontalScroll,width:viewportWidth||'100%',height:ROW_HEIGHT,transform:`translateY(${item.start}px)`}}><div className={`${row.changed&&row.before!==undefined?'removed':''}`}><span className="diff-marker" aria-hidden="true">{row.changed&&row.before!==undefined?'−':''}</span><span className="line-number">{row.beforeLine??''}</span><span className="diff-code">{content(row.before,row.after,row.changed,'before',horizontalScroll)}</span></div><div className={`${row.changed&&row.after!==undefined?'added':''}`}><span className="diff-marker" aria-hidden="true">{row.changed&&row.after!==undefined?'+':''}</span><span className="line-number">{row.afterLine??''}</span><span className="diff-code">{content(row.after,row.before,row.changed,'after',horizontalScroll)}</span></div></div>;})}</div>}
    </div></>}
  </section>;
}

export const DiffPreview = memo(DiffPreviewPanel);
