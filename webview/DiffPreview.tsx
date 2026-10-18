import type { DiffTarget } from '../src/protocol/types';
import { Button, Empty, hasOpenInteractionLayer } from './ui';

import { uiText } from './text';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useDiffVirtualizer } from './diff-virtualizer';
import { useWorkbenchFields } from './subscriptions';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { rpc } from './rpc';
import { DiffHunkAction, patchHunkAtRow, patchHunkForRow } from './DiffHunkAction';
import { useDiffPages } from './diff-pages';
import type { DiffChangeRange } from '../src/protocol/diff';
import { adjacentDiffFile, alignDiff, changeAtRow, changedParts, changedRanges, remapChange, summarizeChanges, type DiffDirection, type DiffRow } from './diff';

import { diffKey } from './refresh';
import { diffRowHeight } from './appearance';
import { useShortcuts } from './shortcuts';
import type { DiffImage, DiffPreview as Preview } from '../src/protocol/types';

interface Selection {key:string;rows:readonly DiffRow[];index:number;ranges?:readonly DiffChangeRange[]}
type ImageZoom = 'fit' | number;
const zoomSteps=[.25,.5,1,2,4];
function previewChangeCount(preview:Preview|undefined):number {
  return preview?.kind==='image'&&(preview.left||preview.right)?1:preview?.kind==='text'?(preview.index?.changes.length??changedRanges(alignDiff(preview.left,preview.right)).length):0;
}
function imageSummary(preview:Extract<Preview,{kind:'image'}>) {
  return {added:preview.right&&!preview.left?1:0,modified:preview.left&&preview.right?1:0,removed:preview.left&&!preview.right?1:0};
}
function formatBytes(value:number):string { return value<1024?`${value} B`:value<1024*1024?`${(value/1024).toFixed(value<10*1024?1:0)} KiB`:`${(value/1024/1024).toFixed(1)} MiB`; }
function ImageSide({image,label,zoom,onScroll,sideRef}:{image?:DiffImage;label:string;zoom:ImageZoom;onScroll(event:React.UIEvent<HTMLDivElement>):void;sideRef:React.RefObject<HTMLDivElement|null>}) {
  const t=useTranslation();
  return <div className="image-diff-side"><div className="image-diff-canvas" ref={sideRef} onScroll={onScroll}>{image?<img src={`data:${image.mimeType};base64,${image.data}`} alt={t("diff.imagePreviewFor", { label })} draggable="false" className={zoom==='fit'?'fit':undefined} style={zoom==='fit'?undefined:{width:image.width*zoom,height:image.height*zoom}}/>:<div className="image-diff-empty"><span>{t("diff.emptyImageSide")}</span></div>}</div>{image&&<div className="image-diff-meta">{image.width} × {image.height} · {formatBytes(image.byteLength)}</div>}</div>;
}
function content(value:string|undefined,other:string|undefined,changed:boolean,side:'before'|'after',scrollLeft:number) {
  if(value===undefined)return null;
  const style={transform:`translateX(-${scrollLeft}px)`};
  if(!changed||other===undefined)return <code style={style}>{value}</code>;
  const parts=changedParts(side==='before'?value:other,side==='before'?other:value),middle=side==='before'?parts.before:parts.after;
  return <code style={style}>{parts.prefix}{middle&&<mark className={side==='before'?'diff-word-removed':'diff-word-added'}>{middle}</mark>}{parts.suffix}</code>;
}
export interface IsolatedDiffPreview { repoId: string; target?: DiffTarget }
function DiffPreviewPanel({ native, edit, active = true, isolated }: { native():void; edit():void; active?:boolean; isolated?: IsolatedDiffPreview }) {
  const globalState=useWorkbenchFields('busy', 'execute', 'appearance', 'diffNavigationScope', 'details', 'selectedStashOid', 'tab', 'diffRevision', 'diffTarget', 'layout', 'repoId', 'selectedFile', 'selectFile', 'setLayout');
  const [isolatedCollapsed, setIsolatedCollapsed] = useState(false);
  const state = isolated ? { ...globalState, repoId: isolated.repoId, diffTarget: isolated.target, selectedFile: isolated.target?.path, diffRevision: 0, details: undefined, selectedStashOid: undefined, diffNavigationScope: 'file' as const, layout: { ...globalState.layout, diffCollapsed: isolatedCollapsed }, setLayout: (value: { diffCollapsed?: boolean }) => { if (value.diffCollapsed !== undefined) setIsolatedCollapsed(value.diffCollapsed); } } : globalState;
  const t=useTranslation(),[preview,setPreview]=useState<Preview>(),[error,setError]=useState<string>(),[loading,setLoading]=useState(false),[selection,setSelection]=useState<Selection>(),[horizontalScroll,setHorizontalScroll]=useState(0),[viewportWidth,setViewportWidth]=useState(0),viewport=useRef<HTMLDivElement>(null),displayedKey=useRef(''),lastScrollTop=useRef(0),navigationScroll=useRef<number|undefined>(undefined);
  const [pointedHunk,setPointedHunk]=useState<string>();
  const pendingHunkScroll=useRef<{top:number;left:number}|undefined>(undefined);
  const hunkScroll=useRef<{repoId?:string;path:string;top:number;left:number}|undefined>(undefined);
  const [navigating,setNavigating]=useState(false),[navigationError,setNavigationError]=useState<string>(),[noNavigableFiles,setNoNavigableFiles]=useState(false),navigationRequest=useRef<AbortController|undefined>(undefined),preloaded=useRef<{key:string;preview:Preview}|undefined>(undefined),landing=useRef<{key:string;index:number}|undefined>(undefined);
  const [imageZoom,setImageZoom]=useState<ImageZoom>('fit'),[maximized,setMaximized]=useState(false),imageSides=[useRef<HTMLDivElement>(null),useRef<HTMLDivElement>(null)] as const,syncingImageScroll=useRef(false);
  const collapsed=state.layout.diffCollapsed;
  const pendingNavigation=useRef<{key:string;direction:DiffDirection}|undefined>(undefined);
  const initiallyPositioned=useRef(false);
  useLayoutEffect(()=>{
    const element=viewport.current;if(!element)return;
    const measure=()=>setViewportWidth(element.clientWidth);
    measure();const observer=new ResizeObserver(measure);observer.observe(element);
    return()=>observer.disconnect();
  },[collapsed,active]);
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
    if(displayedKey.current!==targetKey){const saved=hunkScroll.current,preserve=saved&&saved.repoId===state.repoId&&saved.path===state.diffTarget?.path;hunkScroll.current=undefined;pendingHunkScroll.current=preserve?{top:saved.top,left:saved.left}:undefined;displayedKey.current=targetKey;initiallyPositioned.current=!!preserve;setPreview(undefined);setSelection(undefined);setHorizontalScroll(preserve?saved.left:0);setImageZoom('fit');lastScrollTop.current=preserve?saved.top:0;navigationScroll.current=undefined;viewport.current?.scrollTo({top:lastScrollTop.current,left:preserve?saved.left:0});}
    setError(undefined);
    const target=state.diffTarget;if(!target){setLoading(false);return;}
    if(preloaded.current?.key===targetKey){setPreview(preloaded.current.preview);preloaded.current=undefined;setLoading(false);return;}
    setLoading(true);
    void rpc<Preview>(isolated ? 'isolatedDiffPreview' : 'diffPreview',state.repoId,{...target,paged:true},{signal:controller.signal}).then(value=>{if(live)setPreview(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);}).catch(error=>{if(live)setError(error instanceof Error?error.message:String(error));}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;controller.abort();};
  },[targetKey,revision]);
  useEffect(()=>{if(preview?.kind!=='image')setMaximized(false);},[preview?.kind]);
  const index=preview?.kind==='text'?preview.index:undefined;
  const rows=useMemo(()=>preview?.kind==='text'&&!preview.index?alignDiff(preview.left,preview.right):[],[preview]);
  const rowCount=index?.rowCount??rows.length;
  useEffect(()=>{
    if(!index?.token)return;
    const token=index.token,repoId=state.repoId;
    return()=>{void rpc('diffRelease',repoId,{token}).catch(()=>{});};
  },[index?.token,state.repoId]);
  const ROW_HEIGHT=diffRowHeight(state.appearance.codeFont,state.appearance.codeRowHeight);
  const virtual=useDiffVirtualizer(rowCount,ROW_HEIGHT,viewport,active&&!collapsed);
  const totalHeight=virtual.getTotalSize(),previousRowHeight=useRef(ROW_HEIGHT),previousScale=useRef(virtual.scale),pendingTopRow=useRef<number|undefined>(undefined);
  useLayoutEffect(()=>{
    const element=viewport.current,topRow=(element?.scrollTop??lastScrollTop.current)/previousScale.current/previousRowHeight.current;
    if(previousRowHeight.current!==ROW_HEIGHT||previousScale.current!==virtual.scale){
      if(element)pendingTopRow.current=topRow;
      else lastScrollTop.current=virtual.toScrollOffset(topRow*ROW_HEIGHT);
    }
    previousRowHeight.current=ROW_HEIGHT;previousScale.current=virtual.scale;virtual.measure();
  },[ROW_HEIGHT,virtual.scale]);
  useLayoutEffect(()=>{
    const element=viewport.current;
    // Wait for the remeasured spacer; the old height can clamp the new offset.
    if(!element||pendingTopRow.current===undefined||totalHeight!==rowCount*ROW_HEIGHT)return;
    const offset=Math.max(0,Math.min(pendingTopRow.current*ROW_HEIGHT,totalHeight-element.clientHeight));
    navigationScroll.current=virtual.toScrollOffset(offset);
    pendingTopRow.current=undefined;
    virtual.scrollToOffset(offset);
    lastScrollTop.current=element.scrollTop;
  },[ROW_HEIGHT,totalHeight,rowCount,collapsed]);
  useLayoutEffect(()=>{
    const saved=pendingHunkScroll.current,element=viewport.current;
    if(!saved||!preview||!element||!rowCount||loading)return;
    pendingHunkScroll.current=undefined;
    const top=Math.max(0,Math.min(saved.top,virtual.getScrollSize()-element.clientHeight));
    navigationScroll.current=top;virtual.scrollToOffset(virtual.toLogicalOffset(top));element.scrollLeft=saved.left;lastScrollTop.current=element.scrollTop;
  },[preview,loading,rowCount,totalHeight]);
  const changes=useMemo(()=>index?.changes??changedRanges(rows),[index,rows]);
  const virtualItems=virtual.getVirtualItems();
  const pages=useDiffPages(state.repoId,index,virtualItems[0]?.index??0,virtualItems.at(-1)?.index??0,active&&!collapsed, !!isolated);
  const summary=useMemo(()=>preview?.kind==='image'?imageSummary(preview):(index?.summary??summarizeChanges(rows,changes)),[preview,index,rows,changes]);
  const changeCount=preview?.kind==='image'&&(preview.left||preview.right)?1:changes.length;
  const activeChange=preview?.kind==='image'?0:selection?.key===targetKey?selection.ranges===changes?Math.min(selection.index,changes.length-1):index?changeAtRow(changes,selection.ranges?.[selection.index]?.start??0):remapChange(selection.rows,rows,selection.index):changes.length?0:-1;
  useLayoutEffect(()=>{setSelection({key:targetKey,rows,index:activeChange,ranges:changes});},[targetKey,rows,changes]);
  const jump=(next:number)=>{
    if(preview?.kind==='image'){for(const side of imageSides)side.current?.scrollTo({top:0,left:0});return;}
    if(!changes.length||!viewport.current)return;
    const index=(next+changes.length)%changes.length,block=changes[index],height=viewport.current.clientHeight;
    setSelection({key:targetKey,rows,index,ranges:changes});
    const top=(block.end-block.start+1)*ROW_HEIGHT>height?block.start*ROW_HEIGHT:(block.start+block.end+1)*ROW_HEIGHT/2-height/2;
    const offset=Math.max(0,Math.min(top,virtual.getTotalSize()-height));
    navigationScroll.current=virtual.toScrollOffset(offset);
    virtual.scrollToOffset(offset);
  };
  const navigate=async(direction:DiffDirection)=>{
    if(loading||navigationRequest.current||displayedKey.current!==targetKey)return;
    setNavigationError(undefined);
    const next=activeChange+direction;
    if(!commitMode||!commitFiles||!commitTarget){jump(next);return;}
    if(changeCount&&next>=0&&next<changeCount){jump(next);return;}
    const controller=new AbortController();navigationRequest.current=controller;setNavigating(true);
    let destination:Preview|undefined;
    const targets=commitFiles.map(file=>({...commitTarget,path:file.path,previousPath:file.previousPath}));
    try{
      const adjacent=await adjacentDiffFile(commitFiles.length,fileIndex,direction,async index=>{
        if(index===fileIndex)return changeCount;
        try{destination=await rpc<Preview>(isolated ? 'isolatedDiffPreview' : 'diffPreview',state.repoId,{...targets[index],summaryOnly:true,paged:true},{signal:controller.signal});}
        catch(error){throw new Error(`${targets[index].path}: ${error instanceof Error?error.message:String(error)}`);}
        return previewChangeCount(destination);
      },controller.signal);
      const current=useWorkbench.getState();
      if(controller.signal.aborted||current.repoId!==state.repoId||diffKey(current.diffTarget)!==diffKey(commitTarget)||current.diffNavigationScope!=='commit')return;
      if(!adjacent){setNoNavigableFiles(true);return;}
      if(adjacent.fileIndex===fileIndex){jump(adjacent.changeIndex);return;}
      const target=targets[adjacent.fileIndex],key=JSON.stringify([state.repoId,diffKey(target)]);
      preloaded.current=destination?.kind==='text'&&destination.index&&!destination.index.token?undefined:{key,preview:destination!};landing.current={key,index:adjacent.changeIndex};
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
    if(preview?.kind!=='text')return;
    const index=changeAtRow(changes,(virtual.toLogicalOffset(element.scrollTop)+element.clientHeight/2)/ROW_HEIGHT);
    setSelection(current=>current?.key===targetKey&&current.ranges===changes&&current.index===index?current:{key:targetKey,rows,index,ranges:changes});
  };
  const contentColumns=useMemo(()=>{
    if(index)return index.columns;
    let columns=0;
    for(const row of rows)for(const value of [row.before,row.after]){
      let length=0;
      for(const character of value??'')length+=character==='\t'?4-length%4:character.codePointAt(0)!>0x2ff?2:1;
      columns=Math.max(columns,length);
    }
    return columns;
  },[rows,index]);
  // The scroll spacer represents overflow within one half; comparison columns
  // retain their visible width and only code moves beneath the fixed gutters.
  const contentWidth=`max(100%, calc(${contentColumns}ch + ${viewportWidth/2+48}px))`;
  const highlighted=activeChange>=0?changes[activeChange]:undefined;
  const openLabel=t("diff.openDiff"),editLabel=t("diff.editInVSCode"),previousLabel=t("diff.previousChange"),nextLabel=t("diff.nextChange");
  const previousHint=commitMode?t("diff.previousChangeAcrossCommitFilesWrapsToTheLast"):changeCount===1?t("diff.locateTheOnlyChange"):t("diff.previousChangeWrapsToTheLast"),nextHint=commitMode?t("diff.nextChangeAcrossCommitFilesWrapsToTheFirst"):changeCount===1?t("diff.locateTheOnlyChange"):t("diff.nextChangeWrapsToTheFirst");
  const hunkTarget=!isolated&&state.tab==='changes'&&state.diffTarget?.kind==='change'&&state.diffTarget.area!=='conflict'?state.diffTarget:undefined;
  const patchHunks=hunkTarget&&preview?.kind==='text'?preview.patchHunks:undefined;
  const applyHunk=(hunkId:string)=>{
    const current=useWorkbench.getState();
    if(!patchHunks?.token||!hunkTarget||current.repoId!==state.repoId||diffKey(current.diffTarget)!==diffKey(hunkTarget))return;
    hunkScroll.current={repoId:state.repoId,path:hunkTarget.path,top:viewport.current?.scrollTop??lastScrollTop.current,left:horizontalScroll};
    void state.execute({type:hunkTarget.area==='staged'?'unstage-hunk':'stage-hunk',token:patchHunks.token,hunkId});
  };
  const truncated=preview?.kind==='text'&&preview.truncated,countLabel=preview?.kind==='image'?t("diff.imageChanges"):t("diff.changeBlocks"),blockCount=`${activeChange<0?0:activeChange+1}/${changeCount}${truncated?t("diff.preview"):''}`,countText=commitMode?`${t("diff.file")} ${fileIndex+1}/${commitFiles!.length} · ${t("diff.change")} ${blockCount}`:blockCount,addedLabel=t("diff.addedBlocks"),modifiedLabel=t("diff.modifiedBlocks"),removedLabel=t("diff.removedBlocks");
  const navigationDisabled=loading||navigating||noNavigableFiles||(!changeCount&&(!commitMode||commitFiles!.length<2));
  const nativeUnavailable=!state.diffTarget||preview?.kind!=='text',nativeUnavailableLabel=preview&&preview.kind!=='text'?t("diff.vsCodeOpenUnavailableForImagesAndBinaryFiles"):undefined;
  const zoomBy=(direction:-1|1)=>setImageZoom(current=>{const value=current==='fit'?1:current,index=zoomSteps.findIndex(step=>step===value),next=Math.max(0,Math.min(zoomSteps.length-1,(index<0?2:index)+direction));return zoomSteps[next];});
  const syncImageScroll=(source:0|1,event:React.UIEvent<HTMLDivElement>)=>{if(syncingImageScroll.current)return;const target=imageSides[source===0?1:0].current;if(!target)return;syncingImageScroll.current=true;target.scrollLeft=event.currentTarget.scrollLeft;target.scrollTop=event.currentTarget.scrollTop;requestAnimationFrame(()=>{syncingImageScroll.current=false;});};
  const moveChange=(direction:DiffDirection)=>{
    if(collapsed){pendingNavigation.current={key:targetKey,direction};state.setLayout({diffCollapsed:false});}
    else void navigate(direction);
  };
  const toggleDiff=()=>{if(!collapsed)setMaximized(false);state.setLayout({diffCollapsed:!collapsed});};
  useEffect(()=>{if(!maximized)return;const restore=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&!hasOpenInteractionLayer()){event.preventDefault();setMaximized(false);}};window.addEventListener('keydown',restore,{capture:true});return()=>window.removeEventListener('keydown',restore,{capture:true});},[maximized]);
  useEffect(()=>{if(collapsed&&maximized)setMaximized(false);},[collapsed,maximized]);
  useEffect(()=>{
    const pending=pendingNavigation.current;if(!pending)return;
    if(pending.key!==targetKey){pendingNavigation.current=undefined;return;}
    if(collapsed||navigationDisabled||!viewportWidth||!viewport.current?.clientHeight)return;
    pendingNavigation.current=undefined;void navigate(pending.direction);
  },[collapsed,targetKey,navigationDisabled,viewportWidth]);
  useShortcuts(isolated ? {} : {
    diff:{enabled:active&&!!state.diffTarget&&!nativeUnavailable,run:native},edit:{enabled:active&&!!state.selectedFile&&!nativeUnavailable,run:edit},
    previousChange:{enabled:active&&!!preview&&displayedKey.current===targetKey&&!navigationDisabled,run:()=>moveChange(-1)},
    nextChange:{enabled:active&&!!preview&&displayedKey.current===targetKey&&!navigationDisabled,run:()=>moveChange(1)},
    toggleDiff:{enabled:active,run:toggleDiff},
  });
  // Same-target revalidation retains the preview, so retain its statistics too.
  const awaitingPreview=loading&&(!preview||displayedKey.current!==targetKey);
  const statusLabel=awaitingPreview?t("diff.loadingDiff"):error??`${addedLabel}: ${summary.added}; ${modifiedLabel}: ${summary.modified}; ${removedLabel}: ${summary.removed}; ${countLabel}: ${countText}`;
  const binaryTitle=preview?.kind==='binary'?(preview.reason==='image-too-large'?t("diff.imageExceedsThe4MiBPreviewLimit"):preview.reason==='image-dimensions-too-large'?t("diff.imageDimensionsExceedThePreviewLimit"):t("diff.binaryFileTextPreviewUnavailable")):undefined;
  return <section className={`diff-preview${maximized?' diff-preview-maximized':''}`} data-testid="diff-preview" style={{'--diff-gutter-width':patchHunks?.token?'32px':'1px','--diff-line-digits':Math.max(2,String(rowCount).length)} as React.CSSProperties}><div className="pane-heading"><span className="truncate">{uiText("diff.diff")}{state.selectedFile||t("diff.noFileSelected")}</span><div className="inline-actions"><Button className="icon-only" icon="diff" shortcut="diff" title={nativeUnavailableLabel??openLabel} aria-label={openLabel} onClick={native} disabled={nativeUnavailable}/><Button className="icon-only" icon="go-to-file" shortcut="edit" title={nativeUnavailableLabel??editLabel} aria-label={editLabel} onClick={edit} disabled={!state.selectedFile||nativeUnavailable}/>{preview?.kind==='image'&&!collapsed&&<><span className="diff-toolbar-divider"/><Button className="icon-only" icon="zoom-out" title={t("diff.zoomOutImages")} aria-label={t("diff.zoomOutImages")} onClick={()=>zoomBy(-1)} disabled={imageZoom!== 'fit'&&imageZoom<=zoomSteps[0]}/><Button className="image-actual-size" title={t("diff.showImagesAtActualSize")} aria-label={t("diff.showImagesAtActualSize")} aria-pressed={imageZoom===1} onClick={()=>setImageZoom(1)}>100%</Button><Button className="icon-only" icon="layout-panel" title={t("diff.fitImagesToPanes")} aria-label={t("diff.fitImagesToPanes")} aria-pressed={imageZoom==='fit'} onClick={()=>setImageZoom('fit')}/><Button className="icon-only" icon="zoom-in" title={t("diff.zoomInImages")} aria-label={t("diff.zoomInImages")} onClick={()=>zoomBy(1)} disabled={imageZoom!== 'fit'&&imageZoom>=zoomSteps.at(-1)!}/><Button className="icon-only" icon={maximized?'screen-normal':'screen-full'} title={maximized?t("diff.restoreImagePreview"):t("diff.maximizeImagePreview")} aria-label={maximized?t("diff.restoreImagePreview"):t("diff.maximizeImagePreview")} aria-pressed={maximized} onClick={()=>setMaximized(value=>!value)}/></>}<span className="diff-change-summary" data-testid="diff-change-summary" role="status" aria-label={statusLabel}><span className="diff-change-kind diff-change-added" title={addedLabel} aria-hidden="true">{awaitingPreview||error?"+…":`+${summary.added}`}</span><span className="diff-change-kind diff-change-modified" title={modifiedLabel} aria-hidden="true">{awaitingPreview||error?"~…":`~${summary.modified}`}</span><span className="diff-change-kind diff-change-removed" title={removedLabel} aria-hidden="true">{awaitingPreview||error?"−…":`−${summary.removed}`}</span></span>{!collapsed&&<><Button className="icon-only" icon="arrow-up" shortcut="previousChange" title={previousHint} aria-label={previousLabel} onClick={()=>moveChange(-1)} disabled={navigationDisabled}/><Button className="icon-only" icon="arrow-down" shortcut="nextChange" title={nextHint} aria-label={nextLabel} onClick={()=>moveChange(1)} disabled={navigationDisabled}/></>}<span className="diff-change-count" data-testid="diff-change-count" aria-hidden="true" title={truncated?t("diff.changeBlocksInTheTruncatedPreview"):countLabel}>{awaitingPreview?t("diff.loadingDiff"):error?"—":countText}</span></div></div>
    {!collapsed&&<>{preview&&<div className="diff-labels"><span>{preview.leftLabel}</span><span>{preview.rightLabel}</span></div>}
    {hunkTarget&&patchHunks?.unavailable&&<div className="history-caption" role="status">{t(patchHunks.unavailable==='changed'?'diff.hunkStale':'diff.hunkUnavailable')}</div>}
    {truncated&&<div className="history-caption">{t("diff.previewIsTruncatedOpenDiffToInspectTheFull")}</div>}
    <div className="diff-viewport" ref={viewport} onScroll={trackScroll}>
      {navigationError&&<p className="form-error" role="alert">{navigationError}</p>}
      {navigating&&<div className="history-caption" role="status">{t("diff.loadingTheNextDiffFile")}</div>}
      {(error||(!loading&&pages.error))&&<p className="form-error" role="alert">{error??pages.error}</p>}
      {loading&&!preview?<Empty title={t("diff.loadingDiff")}/>:preview?.kind==='binary'?<Empty title={binaryTitle!}/>:!preview?(!error&&<Empty title={t("diff.selectAFileToPreviewItsDiff")}/>):preview.kind==='image'?<div className="image-diff"><ImageSide image={preview.left} label={preview.leftLabel} zoom={imageZoom} sideRef={imageSides[0]} onScroll={event=>syncImageScroll(0,event)}/><ImageSide image={preview.right} label={preview.rightLabel} zoom={imageZoom} sideRef={imageSides[1]} onScroll={event=>syncImageScroll(1,event)}/></div>:<div className="diff-content" onMouseLeave={()=>setPointedHunk(undefined)} style={{height:virtual.getScrollSize(),position:'relative',width:contentWidth}}>{virtualItems.map(item=>{
        const row=(index?pages.row(item.index):rows[item.index])??{changed:false,before:t('diff.loadingDiff'),after:t('diff.loadingDiff')};
        const active=!!highlighted&&item.index>=highlighted.start&&item.index<=highlighted.end,rowHunk=patchHunkForRow(patchHunks,row);
        const hunk=patchHunkAtRow(patchHunks,row)??(item.index===virtualItems[0]?.index?rowHunk:undefined),scope=!!rowHunk&&rowHunk.id===pointedHunk;
        return <div key={item.index} className={`diff-line${active?' active-change':''}${active&&item.index===highlighted?.start?' active-change-start':''}${active&&item.index===highlighted?.end?' active-change-end':''}${scope?' hunk-scope':''}`} onMouseEnter={()=>setPointedHunk(rowHunk?.id)} onFocusCapture={()=>setPointedHunk(rowHunk?.id)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))setPointedHunk(undefined);}} style={{position:'absolute',left:horizontalScroll,width:viewportWidth||'100%',height:ROW_HEIGHT,transform:`translateY(${item.start}px)`}}>
          <div className={`diff-side${row.changed&&row.before!==undefined?' removed':''}`}><span className="line-number">{row.beforeLine??''}</span><span className="diff-marker" aria-hidden="true">{row.changed&&row.before!==undefined?'−':''}</span><span className="diff-code">{content(row.before,row.after,row.changed,'before',horizontalScroll)}</span></div>
          <div className={`diff-hunk-gutter${rowHunk?' has-hunk':''}`}>{hunk&&<DiffHunkAction hunk={hunk} area={hunkTarget!.area as 'staged'|'unstaged'} disabled={state.busy||loading} apply={applyHunk}/>}</div>
          <div className={`diff-side${row.changed&&row.after!==undefined?' added':''}`}><span className="line-number">{row.afterLine??''}</span><span className="diff-marker" aria-hidden="true">{row.changed&&row.after!==undefined?'+':''}</span><span className="diff-code">{content(row.after,row.before,row.changed,'after',horizontalScroll)}</span></div>
        </div>;
      })}</div>}
    </div></>}
  </section>;
}

export const DiffPreview = memo(DiffPreviewPanel);
