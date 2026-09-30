import { describe,expect,it } from 'vitest';
import { alignDiff } from '../webview/diff';
import { samePath } from '../webview/pathIdentity';

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
});
