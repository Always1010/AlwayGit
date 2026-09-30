export interface DiffRow { before?: string; after?: string; beforeLine?: number; afterLine?: number; changed: boolean }
export interface DiffChangeRange { start: number; end: number }

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
  let start=0,endBefore=before.length,endAfter=after.length;
  while(start<endBefore&&start<endAfter&&before[start]===after[start])start++;
  while(endBefore>start&&endAfter>start&&before[endBefore-1]===after[endAfter-1]){endBefore--;endAfter--;}
  return {prefix:before.slice(0,start),before:before.slice(start,endBefore),after:after.slice(start,endAfter),suffix:before.slice(endBefore)};
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
