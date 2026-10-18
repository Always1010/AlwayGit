import { expect, it } from 'vitest';
import { selectPatchLine } from '../webview/lineSelection';
const lines = [1,2,3,4].flatMap(line => (['before','after'] as const).map(side=>({id:`${side}${line}`,hunkId:'h',side,line})));
it('keeps logical selection across virtual rows and limits Shift ranges to their side',()=>{
  let selection=selectPatchLine(lines,{ids:[]},'before1',{shift:false,additive:false});
  selection=selectPatchLine(lines,selection,'before3',{shift:true,additive:false});
  expect(selection.ids).toEqual(['before1','before2','before3']);
  selection=selectPatchLine(lines,selection,'after2',{shift:false,additive:true});
  expect(selection.ids).toEqual(['before1','before2','before3','after2']);
  selection=selectPatchLine(lines,selection,'after2',{shift:false,additive:true});
  expect(selection.ids).toEqual(['before1','before2','before3']);
  expect(selectPatchLine(lines,selection,'after4',{shift:true,additive:false}).ids).toEqual(['after2','after3','after4']);
});
