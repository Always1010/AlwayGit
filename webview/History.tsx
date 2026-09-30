import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type React from 'react';
import { GraphRow, layoutGraph, type GraphCommit } from './graph';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { Button, Empty, Icon, ResizeHandle } from './ui';
import type { ContextHandler } from './Sidebar';
import { selectionForClick } from './commitSelection';
import { effectiveRowHeight } from './appearance';
import { buildHistoryItems, WORKING_TREE_OID, type HistoryItem } from './historyItems';

const sameGraphPrefix = (prior: readonly GraphCommit[], next: readonly GraphCommit[]) => prior.every((commit,index)=>{
  const candidate=next[index];
  return candidate?.oid===commit.oid&&candidate.parents.length===commit.parents.length&&candidate.parents.every((parent,parentIndex)=>parent===commit.parents[parentIndex]);
});

export function History({ context, checkout, checkoutBranch }: { context: ContextHandler; checkout(oid:string):void; checkoutBranch(name:string,remote?:boolean):void }) {
  const state=useWorkbench(),t=useTranslation(),viewport=useRef<HTMLDivElement>(null),header=useRef<HTMLDivElement>(null),pendingSelection=useRef<string|undefined>(undefined),pendingRowFocus=useRef<string|undefined>(undefined),cached=useRef<{commits:GraphCommit[];paletteKey:string;graph:ReturnType<typeof layoutGraph>}|undefined>(undefined);
  const [hoveredPath,setHoveredPath]=useState<string|undefined>(undefined);
  const items=useMemo(()=>buildHistoryItems(state.commits,state.historyHead),[state.commits,state.historyHead]);
  const graphCommits=useMemo<GraphCommit[]>(()=>items.map(item=>({oid:item.oid,parents:item.parents})),[items]);
  const paletteKey=`${state.appearance.palette}:${state.appearance.colors.light.join(',')}:${state.appearance.colors.dark.join(',')}`;
  const graph=useMemo(()=>{
    const prior=cached.current; let result:ReturnType<typeof layoutGraph>;
    if(prior&&prior.paletteKey===paletteKey&&graphCommits.length>prior.commits.length&&sameGraphPrefix(prior.commits,graphCommits)){const tail=layoutGraph(graphCommits.slice(prior.commits.length),prior.graph.endState,state.appearance.palette,state.appearance.colors);result={rows:[...prior.graph.rows,...tail.rows],endState:tail.endState,laneCount:Math.max(prior.graph.laneCount,tail.laneCount)};}else result=layoutGraph(graphCommits,undefined,state.appearance.palette,state.appearance.colors);
    cached.current={commits:graphCommits,paletteKey,graph:result};return result;
  },[graphCommits,paletteKey]);
  const rowHeight=effectiveRowHeight(state.layout),width=Math.max(state.layout.graph,graph.laneCount*6+8),laneWidth=Math.min(12,(width-8)/Math.max(1,graph.laneCount));
  const previousRowHeight=useRef(rowHeight);
  const lastScrollTop=useRef(0);
  const mainOids=useMemo(()=>{const result=new Set<string>(),all=state.historyHead?[state.historyHead,...state.commits]:state.commits,byOid=new Map(all.map(commit=>[commit.oid,commit])),name=state.snapshot?.defaultBranch;if(!name)return result;let oid=state.snapshot?.refs.find(ref=>ref.kind==='local'&&ref.name===name)?.oid??state.snapshot?.refs.find(ref=>ref.kind==='remote'&&ref.name.endsWith(`/${name}`))?.oid;while(oid&&!result.has(oid)){result.add(oid);oid=byOid.get(oid)?.parents[0];}return result;},[state.commits,state.historyHead,state.snapshot?.defaultBranch,state.snapshot?.refs]);
  const virtual=useVirtualizer({count:items.length,getScrollElement:()=>viewport.current,estimateSize:()=>rowHeight,overscan:10});
  const rows=virtual.getVirtualItems();
  useLayoutEffect(()=>{
    const anchor=lastScrollTop.current/previousRowHeight.current;
    virtual.measure();
    if(previousRowHeight.current!==rowHeight){lastScrollTop.current=anchor*rowHeight;virtual.scrollToOffset(lastScrollTop.current);}
    previousRowHeight.current=rowHeight;
  },[rowHeight,state.layout.font]);
  useEffect(()=>setHoveredPath(undefined),[state.repoId,paletteKey,state.search]);
  useEffect(()=>{const last=rows.at(-1);if(last&&last.index>=items.length-10&&state.hasMore&&!state.historyLoading)void state.loadHistory(true);},[rows.at(-1)?.index,items.length,state.hasMore,state.historyLoading]);
  const refsKey=(state.checkedRefs??[]).join('\0');
  useEffect(()=>{viewport.current?.scrollTo({top:0});},[state.repoId,refsKey,state.search]);
  useEffect(()=>{pendingSelection.current=state.tab==='changes'?WORKING_TREE_OID:state.selectedOid;},[state.selectedOid,state.locateToken,state.repoId,state.tab]);
  useEffect(()=>{const key=pendingSelection.current;if(!key)return;const index=items.findIndex(item=>item.key===key);if(index>=0){const target=items[index].kind==='commit'&&items[index].oid===state.snapshot?.head&&items[index-1]?.kind==='working'?index-1:index;virtual.scrollToIndex(target,{align:'auto'});pendingSelection.current=undefined;}},[items,state.selectedOid,state.locateToken,state.repoId,state.tab]);
  useEffect(()=>{const key=pendingRowFocus.current;if(!key)return;const target=[...(viewport.current?.querySelectorAll<HTMLElement>('[data-history-key]')??[])].find(element=>element.dataset.historyKey===key);if(target){target.focus();pendingRowFocus.current=undefined;}},[rows.at(0)?.index,rows.at(-1)?.index,state.selectedOid,state.tab]);
  useEffect(()=>{pendingRowFocus.current=undefined;},[state.repoId]);
  const columns={gridTemplateColumns:`${width}px minmax(180px,1fr) ${state.layout.author}px ${state.layout.date}px`};
  const choose=(event:React.MouseEvent|React.KeyboardEvent,item:Extract<HistoryItem,{kind:'commit'}>)=>{const oid=item.oid;if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey){void state.selectCommit(oid);return;}const next=selectionForClick(state.commits.map(commit=>commit.oid),state.selectedOids,state.selectionAnchor,oid,{toggle:event.ctrlKey||event.metaKey,range:event.shiftKey}),primary=next.selected.includes(oid)?oid:next.selected.at(-1);state.setCommitSelection(next.selected,next.anchor,primary);};
  const openContext=(event:React.MouseEvent|React.KeyboardEvent,oid:string)=>{const selected=state.selectedOids.includes(oid)?state.selectedOids:[oid];if(!state.selectedOids.includes(oid))state.setCommitSelection([oid],oid,oid);context(event,{kind:'commit',oid,oids:selected});};
  const selectItem=(item:HistoryItem)=>{if(item.kind==='working')state.selectWorking();else void state.selectCommit(item.oid);};
  const move=(index:number,direction:-1|1)=>{const next=Math.min(items.length-1,Math.max(0,index+direction)),item=items[next];if(item&&next!==index){pendingRowFocus.current=item.key;virtual.scrollToIndex(next,{align:'auto'});selectItem(item);}};
  const keyboard=(event:React.KeyboardEvent,index:number,item:HistoryItem)=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();if(item.kind==='working')state.selectWorking();else choose(event,item);}else if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();event.stopPropagation();move(index,event.key==='ArrowDown'?1:-1);}else if(item.kind==='commit'&&(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')){event.preventDefault();event.stopPropagation();openContext(event,item.oid);}};
  const conflictCount=state.snapshot?.changes.filter(change=>change.conflict).length??0,changeCount=state.snapshot?.changes.length??0,branch=state.snapshot?.branch||'Detached HEAD';
  return <section className="history-panel" data-testid="history">
    <div className="pane-heading"><strong>Graph · {t('Commit History','提交历史')}</strong><label className="search"><Icon name="search"/><input aria-label="Search commit history" placeholder={t('Filter commit messages…','过滤 Commit 信息…')} value={state.search} onChange={e=>state.setSearch(e.target.value)}/></label></div>
    <div className="history-caption selection-summary"><span>{state.checkedRefs?.length??0} {t('refs','个引用')} · {state.commits.length}{state.hasMore?'+':''} Commit · {t('Shared ancestry shown once','共同历史合并展示')}{state.selectedOids.length>1?` · ${state.selectedOids.length} ${t('Commits selected','个 Commit 已选择')}`:''}</span><div className="push-state-legend" aria-label={t('Commit push status legend','Commit 推送状态图例')}><span><i className="push-node pushed"/>{t('Pushed','已推送')}</span><span><i className="push-node local"/>{t('Local only','仅本地')}</span></div>{state.selectedOids.length>1&&<Button icon="close" onClick={()=>state.setCommitSelection([])}>{t('Clear','清除')}</Button>}</div>
    <div className="history-table" role="table" aria-label="Commit history" aria-multiselectable="true" aria-rowcount={items.length+1}>
    <div ref={header} className="history-header-scroll"><div className="history-columns" style={{...columns,minWidth:width+180+state.layout.author+state.layout.date}} role="row"><span role="columnheader" className="resizable-column-end">Graph<ResizeHandle axis="x" label="Resize graph column" className="column-grip column-grip-end" value={state.layout.graph} min={48} max={180} onChange={graph=>state.setLayout({graph})}/></span><span role="columnheader">{t('Message / Refs','提交信息 / 引用')}</span><span role="columnheader" className="resizable-column-start">{t('Author','作者')}<ResizeHandle axis="x" label="Resize author column" className="column-grip column-grip-start" value={state.layout.author} min={64} max={220} reverse onChange={author=>state.setLayout({author})}/></span><span role="columnheader" className="resizable-column-start">{t('Date','日期')}<ResizeHandle axis="x" label="Resize date column" className="column-grip column-grip-start" value={state.layout.date} min={82} max={220} reverse onChange={date=>state.setLayout({date})}/></span></div></div>
    <div className="history-viewport" ref={viewport} role="rowgroup" tabIndex={0} onMouseLeave={()=>setHoveredPath(undefined)} onScroll={event=>{lastScrollTop.current=event.currentTarget.scrollTop;if(header.current)header.current.scrollLeft=event.currentTarget.scrollLeft;}} onKeyDown={event=>{
      if(!['ArrowUp','ArrowDown'].includes(event.key)||event.target!==event.currentTarget)return;event.preventDefault();const index=state.tab==='changes'?items.findIndex(item=>item.kind==='working'):items.findIndex(item=>item.kind==='commit'&&item.oid===state.selectedOid);move(index<0?0:index,event.key==='ArrowDown'?1:-1);
    }}>
      <div className="history-rows" style={{height:virtual.getTotalSize(),minWidth:width+180+state.layout.author+state.layout.date}}>
        {rows.map(row=>{const item=items[row.index],graphRow=graph.rows[row.index],selected=item.kind==='working'?state.tab==='changes':state.tab==='history'&&state.selectedOids.includes(item.oid);if(item.kind==='working')return <div key={item.key} data-history-key={item.key} data-working-tree role="row" tabIndex={0} aria-rowindex={row.index+2} aria-selected={selected} aria-label={`${t('Working Tree','工作区')}, ${changeCount} ${t('changes','项变更')}, ${branch}, ${t('Uncommitted','未提交')}`} className={`commit-row commit-row-interactive working-tree-row ${selected?'selected':''} ${row.index%2?'alternate':''}`} style={{...columns,position:'absolute',transform:`translateY(${row.start}px)`,height:rowHeight,width:'100%'}} onClick={event=>{event.currentTarget.focus();state.selectWorking();}} onKeyDown={event=>keyboard(event,row.index,item)}>
          <div className="graph-cell" role="cell" aria-label={t('Working Tree virtual node','工作区虚拟节点')}><GraphRow row={graphRow} width={width} laneWidth={laneWidth} height={rowHeight} working selected={selected} mainTargets={mainOids} paletteId={state.appearance.palette} paletteSize={state.appearance.colors.light.length} hoveredPath={hoveredPath} onHoverPath={setHoveredPath}/></div>
          <div className="commit-subject working-tree-subject" role="cell"><Icon name="files"/><strong>{t('Working Tree','工作区')}</strong><span className="working-change-badge">{changeCount} {t('changes','项变更')}</span>{conflictCount>0&&<span className="working-conflict-badge" title={t('Unresolved conflicts','未解决的冲突')}>{conflictCount} {t('conflicts','个冲突')}</span>}<span className="working-branch truncate">{t('on','位于')} {branch}</span></div>
          <span role="cell" className="history-author" aria-hidden="true"/><span role="cell" className="history-date working-state"><span>{t('Uncommitted','未提交')}</span><Icon name="chevron-right"/></span>
        </div>;
        const commit=item.commit,refs=state.snapshot?.refs.filter(ref=>ref.oid===commit.oid)??[],head=commit.oid===state.snapshot?.head,pushed=commit.pushed!==false;return <div key={item.key} data-history-key={item.key} data-oid={commit.oid} data-head-commit={head||undefined} role="row" tabIndex={0} aria-rowindex={row.index+2} aria-selected={selected} aria-label={`${commit.subject}, ${commit.author}, ${pushed?t('available on remote','远端已有'):t('local only','仅本地')}`} className={`commit-row commit-row-interactive ${pushed?'pushed-commit':'local-commit'} ${selected?'selected':''} ${row.index%2?'alternate':''}`} style={{...columns,position:'absolute',transform:`translateY(${row.start}px)`,height:rowHeight,width:'100%'}} onClick={event=>{event.currentTarget.focus();choose(event,item);}} onDoubleClick={()=>checkout(commit.oid)} onContextMenu={event=>{event.currentTarget.focus();openContext(event,commit.oid);}} onKeyDown={event=>keyboard(event,row.index,item)}>
          <div className="graph-cell" role="cell" aria-label={`Commit node ${commit.oid}`}><GraphRow row={graphRow} width={width} laneWidth={laneWidth} height={rowHeight} head={head} selected={selected} pushed={pushed} main={mainOids.has(commit.oid)} mainTargets={mainOids} paletteId={state.appearance.palette} paletteSize={state.appearance.colors.light.length} hoveredPath={hoveredPath} onHoverPath={setHoveredPath}/></div>
          <div className="commit-subject" role="cell">{refs.map(ref=>{const current=ref.kind==='local'&&ref.name===state.snapshot?.branch;return <button key={ref.fullName} className={`ref-badge ${ref.kind}`} aria-current={current?'true':undefined} title={ref.fullName} onClick={event=>{event.stopPropagation();void state.selectCommit(commit.oid);}} onDoubleClick={event=>{event.stopPropagation();if(ref.kind==='local')checkoutBranch(ref.name);else if(ref.kind==='remote')checkoutBranch(ref.fullName,true);}} onContextMenu={event=>{event.stopPropagation();context(event,{kind:'ref',ref});}} onKeyDown={event=>{event.stopPropagation();if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();context(event,{kind:'ref',ref});}}}>{ref.name}</button>;})}{head&&!state.snapshot?.branch&&<span className="ref-badge">Detached HEAD</span>}<span className="commit-message-button truncate" title={`${commit.subject}\n${commit.oid}`}>{commit.subject}</span></div>
          <span role="cell" className="history-author truncate" title={`${commit.author} <${commit.email}>`}>{commit.author}</span><span role="cell" className="history-date truncate" title={new Date(commit.timestamp*1000).toLocaleString()}>{new Date(commit.timestamp*1000).toLocaleString(state.language,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}</span>
        </div>;})}
      </div>
      {!state.commits.length&&<Empty title={state.historyLoading?t('Loading history…','正在读取历史…'):!state.checkedRefs?.length?t('No branches selected','尚未选择分支'):t('No matching commits','没有匹配的 Commit')}>{t('The Working Tree stays visible. Select branches on the left or adjust the filter.','工作区会继续显示。请勾选左侧分支，或调整过滤条件。')}</Empty>}
    </div>
    </div>
    {state.hasMore&&<Button className="load-more" disabled={state.historyLoading} onClick={()=>void state.loadHistory(true)}>{t('Load More','加载更多')}</Button>}
  </section>;
}
