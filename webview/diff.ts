export interface DiffRow { before?: string; after?: string; beforeLine?: number; afterLine?: number; changed: boolean }
export interface DiffChangeRange { start: number; end: number }
export interface DiffChangeSummary { added: number; modified: number; removed: number }
export type DiffDirection = -1 | 1;

/** Scan each file at most once, including the current file on wrap-around. */
export async function adjacentDiffFile(fileCount: number, current: number, direction: DiffDirection, countChanges: (index: number) => Promise<number>, signal: AbortSignal): Promise<{ fileIndex: number; changeIndex: number } | undefined> {
  if (current < 0 || current >= fileCount) return;
  for (let step = 1; step <= fileCount; step++) {
    signal.throwIfAborted();
    const fileIndex = (current + direction * step + fileCount) % fileCount;
    const count = await countChanges(fileIndex);
    signal.throwIfAborted();
    if (count > 0) return { fileIndex, changeIndex: direction === 1 ? 0 : count - 1 };
  }
}

export function changedRanges(rows: readonly DiffRow[]): DiffChangeRange[] {
  const ranges: DiffChangeRange[]=[];
  for(let index=0;index<rows.length;index++){
    if(!rows[index].changed)continue;
    const start=index;
    while(index+1<rows.length&&rows[index+1].changed)index++;
    ranges.push({start,end:index});
  }
  return ranges;
}

export function summarizeChanges(rows: readonly DiffRow[], ranges=changedRanges(rows)): DiffChangeSummary {
  const summary:DiffChangeSummary={added:0,modified:0,removed:0};
  for(const range of ranges){
    let before=false,after=false;
    for(let index=range.start;index<=range.end;index++){
      before||=rows[index].before!==undefined;
      after||=rows[index].after!==undefined;
    }
    if(before&&after)summary.modified++;
    else if(after)summary.added++;
    else if(before)summary.removed++;
  }
  return summary;
}

/** Select the block containing the viewport anchor, or its nearest neighbour. */
export function changeAtRow(ranges: readonly DiffChangeRange[], row: number): number {
  let nearest=-1,distance=Infinity;
  for(let index=0;index<ranges.length;index++){
    const range=ranges[index],nextDistance=Math.max(range.start-row,row-range.end,0);
    if(nextDistance<distance){nearest=index;distance=nextDistance;}
  }
  return nearest;
}

/** Keep a selected block across a same-file refresh without moving the viewport. */
export function remapChange(rowsBefore: readonly DiffRow[], rowsAfter: readonly DiffRow[], selected: number): number {
  const before=changedRanges(rowsBefore),after=changedRanges(rowsAfter);
  if(!after.length)return -1;
  const previous=before[selected];
  if(!previous)return Math.max(0,Math.min(selected,after.length-1));
  const anchor=rowsBefore[previous.start];
  let matchedRow=-1,matchedDistance=Infinity;
  for(let index=0;index<rowsAfter.length;index++){
    const row=rowsAfter[index];
    if(!row.changed||row.before!==anchor.before||row.after!==anchor.after)continue;
    const distance=Math.abs((row.beforeLine??row.afterLine??index)-(anchor.beforeLine??anchor.afterLine??previous.start));
    if(distance<matchedDistance){matchedRow=index;matchedDistance=distance;}
  }
  if(matchedRow>=0)return changeAtRow(after,matchedRow);
  // If the selected edit disappeared, choose the closest surviving source line.
  const side=anchor.beforeLine!==undefined?'beforeLine':'afterLine';
  const line=anchor[side];
  if(line===undefined)return Math.min(selected,after.length-1);
  let nearest=0,distance=Infinity;
  for(let index=0;index<after.length;index++){
    const range=after[index];
    for(let rowIndex=range.start;rowIndex<=range.end;rowIndex++){
      const rowLine=rowsAfter[rowIndex][side];
      if(rowLine!==undefined&&Math.abs(rowLine-line)<distance){nearest=index;distance=Math.abs(rowLine-line);}
    }
  }
  return distance===Infinity?Math.min(selected,after.length-1):nearest;
}
export interface ChangedParts { prefix: string; before: string; after: string; suffix: string }
export function changedParts(before: string, after: string): ChangedParts {
  const beforePoints=Array.from(before),afterPoints=Array.from(after);
  let start=0,endBefore=beforePoints.length,endAfter=afterPoints.length;
  while(start<endBefore&&start<endAfter&&beforePoints[start]===afterPoints[start])start++;
  while(endBefore>start&&endAfter>start&&beforePoints[endBefore-1]===afterPoints[endAfter-1]){endBefore--;endAfter--;}
  return {
    prefix:beforePoints.slice(0,start).join(''),
    before:beforePoints.slice(start,endBefore).join(''),
    after:afterPoints.slice(start,endAfter).join(''),
    suffix:beforePoints.slice(endBefore).join(''),
  };
}
// A bounded look-ahead aligns context without an unbounded quadratic matrix.
// Every input line is emitted once; ambiguous blocks remain conservative replacements.
export function alignDiff(before: string, after: string): DiffRow[] {
  const left=before?before.split('\n'):[],right=after?after.split('\n'):[],rows:DiffRow[]=[];let a=0,b=0;
  const replace=(endA:number,endB:number)=>{while(a<endA||b<endB){const hasA=a<endA,hasB=b<endB;rows.push({before:hasA?left[a]:undefined,after:hasB?right[b]:undefined,beforeLine:hasA?a+1:undefined,afterLine:hasB?b+1:undefined,changed:true});if(hasA)a++;if(hasB)b++;}};
  while(a<left.length&&b<right.length){
    if(left[a]===right[b]){rows.push({before:left[a],after:right[b],beforeLine:++a,afterLine:++b,changed:false});continue;}
    let da=-1,db=-1,best=Infinity;
    for(let i=0;i<64&&a+i<left.length;i++)for(let j=0;j<64&&b+j<right.length&&i+j<best;j++)if(left[a+i]===right[b+j]){da=i;db=j;best=i+j;}
    if(da<0){replace(Math.min(a+64,left.length),Math.min(b+64,right.length));}else replace(a+da,b+db);
  }
  replace(left.length,right.length);return rows;
}
