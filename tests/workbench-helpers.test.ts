import { describe,expect,it } from 'vitest';
import { alignDiff, changedParts } from '../webview/diff';
import { samePath } from '../webview/pathIdentity';
import { buildRefTree, folderKeys, refsUnder } from '../webview/refTree';
import type { GitRef } from '../src/protocol/types';

describe('workbench path identities',()=>{
  it('matches Windows Git paths and VS Code paths without conflating POSIX case',()=>{
    expect(samePath('D:\\Projects\\AlwayGit','d:/projects/alwaygit/')).toBe(true);
    expect(samePath('\\\\Server\\Share\\Repo','//server/share/repo')).toBe(true);
    expect(samePath('/projects/AlwayGit','/projects/alwaygit')).toBe(false);
  });
});
describe('readonly Diff alignment',()=>{
  it('aligns insertions and deletions while retaining context line numbers',()=>{
    const rows=alignDiff('a\nb\nc','a\nx\nb\nc');expect(rows[1]).toMatchObject({before:undefined,after:'x',afterLine:2,changed:true});expect(rows[2]).toMatchObject({before:'b',beforeLine:2,afterLine:3,changed:false});
    expect(alignDiff('a\nx\nb','a\nb')[1]).toMatchObject({before:'x',after:undefined,changed:true});
  });
  it('preserves every line for repeated context and wholly different blocks',()=>{
    for(const [a,b] of [['x\nx\ny','x\ny\nx'],['a\nb','c\nd'],['','a'],['a','']]){const rows=alignDiff(a,b);expect(rows.filter(r=>r.before!==undefined).map(r=>r.before).join('\n')).toBe(a);expect(rows.filter(r=>r.after!==undefined).map(r=>r.after).join('\n')).toBe(b);}
  });
  it('bounds work for long unrelated previews and does not classify repeated removed lines as unchanged',()=>{
    const left=Array.from({length:4000},(_,i)=>'left '+i).join('\n'),right=Array.from({length:4000},(_,i)=>'right '+i).join('\n');expect(alignDiff(left,right)).toHaveLength(4000);
    expect(alignDiff('a\na','a').filter(r=>r.changed)).toHaveLength(1);
  });
  it('isolates changed text while preserving shared prefixes and suffixes',()=>{
    expect(changedParts('const version = "0.2.0";','const version = "0.3.0";')).toEqual({prefix:'const version = "0.',before:'2',after:'3',suffix:'.0";'});
    expect(changedParts('old','new')).toEqual({prefix:'',before:'old',after:'new',suffix:''});
  });
});
describe('branch reference tree',()=>{
  const ref=(name:string):GitRef=>({name,fullName:`refs/heads/${name}`,kind:'local',oid:name});
  it('groups slash-separated branches into recursively sorted folders',()=>{
    const tree=buildRefTree([ref('feature/test2'),ref('main'),ref('feature/login/api'),ref('feature/test')],'local');
    expect(tree.map(node=>node.label)).toEqual(['feature','main']);
    expect(tree[0].children.map(node=>node.label)).toEqual(['login','test','test2']);
    expect(tree[0].children[0].children[0].ref?.name).toBe('feature/login/api');
    expect(refsUnder(tree[0]).map(item=>item.name)).toEqual(['feature/login/api','feature/test','feature/test2']);
  });
  it('strips the remote name and returns every folder needed to reveal a branch',()=>{
    const tree=buildRefTree([{...ref('origin/feature/login'),kind:'remote',fullName:'refs/remotes/origin/feature/login'}],'remote:origin','origin');
    expect(tree[0].label).toBe('feature');
    expect(tree[0].children[0].ref?.name).toBe('origin/feature/login');
    expect(folderKeys('feature/login/api','local')).toEqual(['local:feature','local:feature/login']);
  });
});
