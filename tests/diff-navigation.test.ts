import { describe, expect, it } from 'vitest';
import { adjacentDiffFile, alignDiff, changeAtRow, changedRanges, remapChange, summarizeChanges, type DiffRow } from '../webview/diff';

describe('Diff change navigation', () => {
  it('wraps across files in both directions and skips files without text blocks', async () => {
    const counts=[2,0,0,3],controller=new AbortController(),count=async(index:number)=>counts[index];
    expect(await adjacentDiffFile(4,0,1,count,controller.signal)).toEqual({fileIndex:3,changeIndex:0});
    expect(await adjacentDiffFile(4,3,-1,count,controller.signal)).toEqual({fileIndex:0,changeIndex:1});
    expect(await adjacentDiffFile(4,0,-1,count,controller.signal)).toEqual({fileIndex:3,changeIndex:2});
    expect(await adjacentDiffFile(4,3,1,count,controller.signal)).toEqual({fileIndex:0,changeIndex:0});
    const visited:number[]=[];
    expect(await adjacentDiffFile(4,0,1,async index=>{visited.push(index);return 0;},controller.signal)).toBeUndefined();
    expect(visited).toEqual([1,2,3,0]);
    expect(await adjacentDiffFile(1,0,-1,async()=>1,controller.signal)).toEqual({fileIndex:0,changeIndex:0});
  });

  it('stops on read failure or cancellation without navigating using a stale response', async () => {
    const controller=new AbortController();
    await expect(adjacentDiffFile(3,0,1,async()=>{throw new Error('read failed');},controller.signal)).rejects.toThrow('read failed');
    const visited:number[]=[];
    await expect(adjacentDiffFile(3,0,1,async index=>{visited.push(index);controller.abort();return 2;},controller.signal)).rejects.toThrow();
    expect(visited).toEqual([1]);
  });
  it('groups adjacent changed rows and keeps separate changes independently navigable', () => {
    const rows=alignDiff('same\nold a\nold b\ncontext\ntail', 'same\nnew a\nnew b\ncontext\nadded\ntail');
    const ranges=changedRanges(rows);

    expect(ranges).toHaveLength(2);
    expect(rows.slice(ranges[0].start,ranges[0].end+1).every(row=>row.changed)).toBe(true);
    expect(rows.slice(ranges[1].start,ranges[1].end+1).every(row=>row.changed)).toBe(true);
    expect(ranges[1].start).toBeGreaterThan(ranges[0].end+1);
  });

  it('counts added, modified and removed blocks using the same navigation ranges', () => {
    const rows:DiffRow[]=[
      {before:'old',after:'new',changed:true},{before:'old 2',after:'new 2',changed:true},
      {before:'context',after:'context',changed:false},
      {after:'added',changed:true},
      {before:'context 2',after:'context 2',changed:false},
      {before:'removed',changed:true},
    ];
    const ranges=changedRanges(rows);
    expect(summarizeChanges(rows,ranges)).toEqual({added:1,modified:1,removed:1});
    expect(Object.values(summarizeChanges(rows,ranges)).reduce((total,count)=>total+count,0)).toBe(ranges.length);
  });

  it('selects the containing block or the nearest block when manually scrolling through context', () => {
    const ranges=[{start:4,end:8},{start:30,end:32},{start:80,end:90}];
    expect(changeAtRow([],12)).toBe(-1);
    expect(changeAtRow(ranges,0)).toBe(0);
    expect(changeAtRow(ranges,7)).toBe(0);
    expect(changeAtRow(ranges,25)).toBe(1);
    expect(changeAtRow(ranges,85)).toBe(2);
    expect(changeAtRow(ranges,120)).toBe(2);
  });

  it('keeps the same selected edit after an earlier block is inserted or removed', () => {
    const left='head\nfirst\ngap\nselected\ntail';
    const before=alignDiff(left,'head\nfirst\ngap\nnew selected\ntail');
    const after=alignDiff(left,'head\nnew first\ngap\nnew selected\ntail');
    expect(remapChange(before,after,0)).toBe(1);
    expect(remapChange(after,before,1)).toBe(0);
  });

  it('uses the nearest matching source location when identical edits occur more than once', () => {
    const left='old\ngap one\nold\ngap two\nold';
    const before=alignDiff(left,'new\ngap one\nnew\ngap two\nold');
    const after=alignDiff(left,'new\ngap one\nnew\ngap two\nnew');
    expect(remapChange(before,after,1)).toBe(1);
  });

  it('selects a surviving nearby block when the current edit disappears and handles empty previews', () => {
    const left='head\nfirst\ngap\nselected\ntail';
    const before=alignDiff(left,'head\nnew first\ngap\nnew selected\ntail');
    const after=alignDiff(left,'head\nnew first\ngap\nselected\ntail');
    expect(remapChange(before,after,1)).toBe(0);
    expect(remapChange(before,alignDiff(left,left),1)).toBe(-1);
    expect(remapChange([],after,-1)).toBe(0);
  });

  it('preserves the selected pure insertion as unchanged context is inserted above it', () => {
    const before=alignDiff('head\ntail','head\ninserted\ntail');
    const after=alignDiff('prefix\nhead\ntail','prefix\nhead\ninserted\ntail');
    expect(remapChange(before,after,0)).toBe(0);
  });
});
