import { describe, expect, it } from 'vitest';
import { actionSchema, diffSchema, openRepositorySchema, openWorkbenchSchema, requestSchema, sessionSchema } from '../src/protocol/validation';

describe('Workbench protocol validation', () => {
  it('preserves operation review tokens and the explicit conflict staging action',()=>{
    expect(actionSchema.parse({type:'resolve-and-stage',paths:['same.txt']})).toEqual({type:'resolve-and-stage',paths:['same.txt']});
    expect(actionSchema.parse({type:'operation.continue',kind:'merge',reviewToken:'reviewed'})).toEqual({type:'operation.continue',kind:'merge',reviewToken:'reviewed'});
    expect(actionSchema.parse({type:'commit',message:'Reviewed',reviewToken:'reviewed'})).toMatchObject({reviewToken:'reviewed'});
    expect(requestSchema.parse({id:'review',method:'operationReview',repoId:'fixture'}).method).toBe('operationReview');
  });
  it('retains v2 layout, multi-reference views and drafts while accepting legacy sessions', () => {
    const state = { version: 2, language: 'zh-CN', layout: { preset: 'workbench', sidebar: 230, details: 360, diff: 720, diffCollapsed: true, graph: 72, author: 120, date: 150, font: 13, row: 26 }, repoId: 'fixture', drafts: { fixture: 'Commit draft' }, views: { fixture: { checkedRefs: [],expandedRefGroups:['local:feature'],collapsedSidebarGroups:['tag'], search: '', selectedOid: 'abc', selectedParent: 'parent-2', selectedStashOid: 'def', selectedFile: 'a.txt', tab: 'history' } } };
    expect(sessionSchema.parse(state)).toEqual(state);
    expect(sessionSchema.parse({ views: { fixture: { ref: 'refs/heads/main', search: '', tab: 'changes' } } })).toEqual({ views: { fixture: { ref: 'refs/heads/main', search: '', tab: 'changes' } } });
    expect(() => sessionSchema.parse({ ...state, layout: { ...state.layout, sidebar: -100 } })).toThrow();
    expect(() => sessionSchema.parse({ ...state, language: 'invalid' })).toThrow();
  });

  it('accepts captured Stash IDs and requires validated Checkout targets', () => {
    expect(actionSchema.parse({ type: 'stash.apply', selector: 'stash@{0}', expectedOid: 'a'.repeat(40), pop: true })).toEqual({ type: 'stash.apply', selector: 'stash@{0}', expectedOid: 'a'.repeat(40), pop: true });
    expect(() => actionSchema.parse({ type: 'commit.checkout', target: '' })).toThrow();
    expect(actionSchema.parse({ type: 'checkout.stash', target: 'topic', includeUntracked: true })).toEqual({ type: 'checkout.stash', target: 'topic', includeUntracked: true });
    expect(requestSchema.parse({id:'stash-details',method:'stashDetails',repoId:'fixture',payload:{oid:'a'.repeat(40)}}).method).toBe('stashDetails');
    expect(requestSchema.parse({ id: 'preview', method: 'diffPreview', repoId: 'fixture', payload: { kind: 'change', path: 'a.txt', area: 'staged' } }).method).toBe('diffPreview');
    expect(diffSchema.parse({kind:'stash-working',stashOid:'a'.repeat(40),path:'notes.txt'})).toEqual({kind:'stash-working',stashOid:'a'.repeat(40),path:'notes.txt'});
    expect(requestSchema.parse({id:'compare',method:'compare',repoId:'fixture',payload:{left:'abc',right:'def'}}).method).toBe('compare');
    expect(requestSchema.parse({id:'statuses',method:'repositoryStatuses'}).method).toBe('repositoryStatuses');
    expect(openRepositorySchema.parse({newTab:true})).toEqual({newTab:true});
    expect(openWorkbenchSchema.parse({newTab:true})).toEqual({newTab:true});
    expect(()=>openWorkbenchSchema.parse({})).toThrow();
    expect(()=>openRepositorySchema.parse({newTab:true,newWindow:true})).toThrow();
    expect(actionSchema.parse({ type: 'push', remote: 'origin', branch: 'main', remoteBranch: 'release/main', setUpstream: true })).toMatchObject({ remoteBranch: 'release/main', setUpstream: true });
    expect(actionSchema.parse({type:'remote.add',name:'origin',url:'https://example.com/acme/repo.git'})).toEqual({type:'remote.add',name:'origin',url:'https://example.com/acme/repo.git'});
    expect(actionSchema.parse({type:'cherry-pick',commits:['abc'],expectedHead:'def',expectedBranch:'main'})).toMatchObject({expectedBranch:'main'});
    expect(actionSchema.parse({type:'branch.delete',names:['topic','fix/a'],expectedOids:{topic:'a'.repeat(40)}})).toMatchObject({names:['topic','fix/a']});
    expect(()=>actionSchema.parse({type:'branch.delete',names:[]})).toThrow();
    expect(actionSchema.parse({type:'remote.delete',remote:'origin',branches:['feature/a'],expectedOids:{'feature/a':'b'.repeat(40)}})).toMatchObject({remote:'origin',branches:['feature/a']});
    const branches = [{ source: 'refs/remotes/origin/feature/a', name: 'feature/a', expectedOid: 'c'.repeat(40) }];
    expect(actionSchema.parse({ type: 'branch.track', branches, checkout: true, stashFirst: true, includeUntracked: true })).toEqual({ type: 'branch.track', branches, checkout: true, stashFirst: true, includeUntracked: true });
    expect(() => actionSchema.parse({ type: 'branch.track', branches: [] })).toThrow();
    expect(() => actionSchema.parse({ type: 'branch.track', branches: [...branches, { source: 'refs/remotes/origin/feature/b', name: 'feature/b' }], checkout: true })).toThrow();
    expect(() => actionSchema.parse({ type: 'branch.track', branches, stashFirst: true })).toThrow();
  });
});
