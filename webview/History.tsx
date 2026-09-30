import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type React from 'react';
import { GraphRow, layoutGraph } from './graph';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { Button, Empty, Icon, ResizeHandle } from './ui';
import type { ContextHandler } from './Sidebar';

export function History({ context, checkout, checkoutBranch }: { context: ContextHandler; checkout(oid:string):void; checkoutBranch(name:string):void }) {
  const state=useWorkbench(),t=useTranslation(),viewport=useRef<HTMLDivElement>(null),header=useRef<HTMLDivElement>(null),pendingSelection=useRef<string|undefined>(undefined),cached=useRef<{commits:typeof state.commits;graph:ReturnType<typeof layoutGraph>}|undefined>(undefined);
  const graph=useMemo(()=>{
    const prior=cached.current; let result:ReturnType<typeof layoutGraph>;
    if(prior&&state.commits.length>prior.commits.length&&prior.commits.every((c,i)=>state.commits[i]?.oid===c.oid)){const tail=layoutGraph(state.commits.slice(prior.commits.length),prior.graph.endState);result={rows:[...prior.graph.rows,...tail.rows],endState:tail.endState,laneCount:Math.max(prior.graph.laneCount,tail.laneCount)};}else result=layoutGraph(state.commits);
    cached.current={commits:state.commits,graph:result};return result;
  },[state.commits]);
  const rowHeight=state.layout.row,width=Math.max(48,graph.laneCount*16+12);
  const virtual=useVirtualizer({count:state.commits.length,getScrollElement:()=>viewport.current,estimateSize:()=>rowHeight,overscan:10});
  const rows=virtual.getVirtualItems();
  useEffect(()=>virtual.measure(),[rowHeight]);
  useEffect(()=>{const last=rows.at(-1);if(last&&last.index>=state.commits.length-10&&state.hasMore&&!state.historyLoading)void state.loadHistory(true);},[rows.at(-1)?.index,state.hasMore,state.historyLoading]);
  const refsKey=(state.checkedRefs??[]).join('\0');
  useEffect(()=>{viewport.current?.scrollTo({top:0});},[state.repoId,refsKey,state.search]);
  useEffect(()=>{pendingSelection.current=state.tab==='history'?state.selectedOid:undefined;},[state.selectedOid,state.locateToken,state.repoId,state.tab]);
  useEffect(()=>{if(!pendingSelection.current)return;const index=state.commits.findIndex(c=>c.oid===pendingSelection.current);if(index>=0){virtual.scrollToIndex(index,{align:'auto'});pendingSelection.current=undefined;}},[state.commits,state.selectedOid,state.locateToken,state.repoId,state.tab]);
  const columns={gridTemplateColumns:`${width}px minmax(180px,1fr) ${state.layout.author}px ${state.layout.date}px`};
  const keyboard=(event:React.KeyboardEvent,oid:string)=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();context(event,{kind:'commit',oid});}};
  return <section className="history-panel" data-testid="history">
    <div className="pane-heading"><strong>Graph · {t('Commit History','提交历史')}</strong><label className="search"><Icon name="search"/><input aria-label="Search commit history" placeholder={t('Filter commit messages…','过滤 Commit 信息…')} value={state.search} onChange={e=>state.setSearch(e.target.value)}/></label></div>
    <div className="history-caption">{state.checkedRefs?.length??0} {t('refs','个引用')} · {state.commits.length}{state.hasMore?'+':''} Commit · {t('Shared ancestry shown once','共同历史合并展示')}</div>
    <div className="history-table" role="table" aria-label="Commit history" aria-rowcount={state.commits.length+2}>
    <div ref={header} className="history-header-scroll"><div className="history-columns" style={{...columns,minWidth:width+180+state.layout.author+state.layout.date}} role="row"><span role="columnheader">Graph</span><span role="columnheader">{t('Message / Refs','提交信息 / 引用')}</span><span role="columnheader">{t('Author','作者')}<ResizeHandle axis="x" label="Resize author column" className="column-grip" value={state.layout.author} min={64} max={220} onChange={author=>state.setLayout({author})}/></span><span role="columnheader">{t('Date','日期')}<ResizeHandle axis="x" label="Resize date column" className="column-grip" value={state.layout.date} min={82} max={220} onChange={date=>state.setLayout({date})}/></span></div></div>
    <div role="row" className="working-row-wrap"><div role="cell"><button className={`working-row ${state.tab==='changes'?'selected':''}`} onClick={state.selectWorking}><Icon name="files"/><span>{t('Working Tree','工作区')} · {state.snapshot?.changes.length??0} {t('changes','项变更')}</span><span className="muted">{t('Uncommitted','未提交')}</span></button></div></div>
    <div className="history-viewport" ref={viewport} role="rowgroup" tabIndex={0} onScroll={event=>{if(header.current)header.current.scrollLeft=event.currentTarget.scrollLeft;}} onKeyDown={event=>{
      if(!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const index=state.commits.findIndex(c=>c.oid===state.selectedOid),next=Math.min(state.commits.length-1,Math.max(0,index+(event.key==='ArrowDown'?1:-1)));if(state.commits[next])void state.selectCommit(state.commits[next].oid);
    }}>
      {!state.commits.length?<Empty title={state.historyLoading?t('Loading history…','正在读取历史…'):!state.checkedRefs?.length?t('No branches selected','尚未选择分支'):t('No matching commits','没有匹配的 Commit')}>{t('Select branches on the left or adjust the filter.','勾选左侧分支，或调整过滤条件。')}</Empty>:<div className="history-rows" style={{height:virtual.getTotalSize(),minWidth:width+180+state.layout.author+state.layout.date}}>
        {rows.map(row=>{const commit=state.commits[row.index],refs=state.snapshot?.refs.filter(r=>r.oid===commit.oid)??[],selected=state.tab==='history'&&commit.oid===state.selectedOid,head=commit.oid===state.snapshot?.head;return <div key={commit.oid} data-oid={commit.oid} role="row" aria-rowindex={row.index+3} aria-selected={selected} className={`commit-row ${selected?'selected':''} ${head?'head-row':''} ${row.index%2?'alternate':''}`} style={{...columns,position:'absolute',transform:`translateY(${row.start}px)`,height:rowHeight,width:'100%'}} onClick={()=>void state.selectCommit(commit.oid)} onContextMenu={event=>context(event,{kind:'commit',oid:commit.oid})}>
          <div className="graph-cell" role="cell"><button aria-label={`Commit node ${commit.oid}`} onDoubleClick={()=>checkout(commit.oid)} onKeyDown={event=>keyboard(event,commit.oid)}><GraphRow row={graph.rows[row.index]} width={width} height={rowHeight} head={head} selected={selected}/></button></div>
          <div className="commit-subject" role="cell">{refs.map(ref=><button key={ref.fullName} className={`ref-badge ${ref.kind} ${ref.kind==='local'&&ref.name===state.snapshot?.branch?'current':''}`} title={ref.fullName} onClick={event=>{event.stopPropagation();void state.selectCommit(commit.oid);}} onDoubleClick={event=>{event.stopPropagation();if(ref.kind==='local')checkoutBranch(ref.name);}} onContextMenu={event=>{event.stopPropagation();context(event,{kind:'ref',ref});}}>{ref.kind==='local'&&ref.name===state.snapshot?.branch?'HEAD · ':''}{ref.name}</button>)}{head&&!state.snapshot?.branch&&<span className="current-marker">HEAD</span>}<button className="commit-message-button truncate" title={`${commit.subject}\n${commit.oid}`} onKeyDown={event=>keyboard(event,commit.oid)} onDoubleClick={()=>checkout(commit.oid)}>{commit.subject}</button></div>
          <span role="cell" className="history-author truncate" title={`${commit.author} <${commit.email}>`}>{commit.author}</span><span role="cell" className="history-date truncate" title={new Date(commit.timestamp*1000).toLocaleString()}>{new Date(commit.timestamp*1000).toLocaleString(state.language,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}</span>
        </div>;})}
      </div>}
    </div>
    </div>
    {state.hasMore&&<Button className="load-more" disabled={state.historyLoading} onClick={()=>void state.loadHistory(true)}>{t('Load More','加载更多')}</Button>}
  </section>;
}
