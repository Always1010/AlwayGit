export interface DiffRow { before?: string; after?: string; beforeLine?: number; afterLine?: number; changed: boolean }
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
