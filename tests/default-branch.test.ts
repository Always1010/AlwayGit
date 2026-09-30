import { describe, expect, it } from 'vitest';
import { inferDefaultBranch } from '../src/git/default-branch';
import type { GitRef } from '../src/protocol/types';

const ref=(name:string,oid:string,kind:GitRef['kind']='remote'):GitRef=>({name,fullName:`refs/${kind==='remote'?'remotes':'heads'}/${name}`,kind,oid,targetType:'commit'});

describe('default branch inference',()=>{
  it('prefers the upstream remote symbolic HEAD over other remotes',()=>{
    const refs=[ref('origin/HEAD','one'),ref('origin/main','one'),{...ref('team/HEAD','two'),symbolicTarget:'refs/remotes/team/trunk'},ref('team/other','two'),ref('team/trunk','two')];
    expect(inferDefaultBranch(refs,['origin','team'],'team/trunk')).toBe('trunk');
  });

  it('falls back to conventional local branch names',()=>{
    expect(inferDefaultBranch([ref('main','one','local')],[])).toBe('main');
  });
});
