import { describe, expect, it } from 'vitest';
import { actionSchema, requestSchema, sessionSchema } from '../src/protocol/validation';

describe('Workbench protocol validation', () => {
  it('retains v2 layout, multi-reference views and drafts while accepting legacy sessions', () => {
    const state = { version: 2, language: 'zh-CN', layout: { preset: 'workbench', sidebar: 230, details: 360, diff: 240, graph: 72, author: 120, date: 150, font: 13, row: 26 }, repoId: 'fixture', drafts: { fixture: 'Commit draft' }, views: { fixture: { checkedRefs: [],expandedRefGroups:['local:feature'],collapsedSidebarGroups:['tag'], search: '', selectedOid: 'abc', selectedParent: 'parent-2', selectedStashOid: 'def', selectedFile: 'a.txt', tab: 'history' } } };
    expect(sessionSchema.parse(state)).toEqual(state);
    expect(sessionSchema.parse({ views: { fixture: { ref: 'refs/heads/main', search: '', tab: 'changes' } } })).toEqual({ views: { fixture: { ref: 'refs/heads/main', search: '', tab: 'changes' } } });
    expect(() => sessionSchema.parse({ ...state, layout: { ...state.layout, sidebar: -100 } })).toThrow();
    expect(() => sessionSchema.parse({ ...state, language: 'invalid' })).toThrow();
  });

  it('accepts captured Stash IDs and requires validated Checkout targets', () => {
    expect(actionSchema.parse({ type: 'stash.apply', selector: 'stash@{0}', expectedOid: 'a'.repeat(40), pop: true })).toEqual({ type: 'stash.apply', selector: 'stash@{0}', expectedOid: 'a'.repeat(40), pop: true });
    expect(() => actionSchema.parse({ type: 'commit.checkout', target: '' })).toThrow();
    expect(actionSchema.parse({ type: 'checkout.stash', target: 'topic', includeUntracked: true })).toEqual({ type: 'checkout.stash', target: 'topic', includeUntracked: true });
    expect(requestSchema.parse({ id: 'preview', method: 'diffPreview', repoId: 'fixture', payload: { kind: 'change', path: 'a.txt', area: 'staged' } }).method).toBe('diffPreview');
    expect(requestSchema.parse({id:'compare',method:'compare',repoId:'fixture',payload:{left:'abc',right:'def'}}).method).toBe('compare');
    expect(requestSchema.parse({id:'statuses',method:'repositoryStatuses'}).method).toBe('repositoryStatuses');
    expect(actionSchema.parse({ type: 'push', remote: 'origin', branch: 'main', remoteBranch: 'release/main', setUpstream: true })).toMatchObject({ remoteBranch: 'release/main', setUpstream: true });
    expect(actionSchema.parse({type:'cherry-pick',commits:['abc'],expectedHead:'def',expectedBranch:'main'})).toMatchObject({expectedBranch:'main'});
  });
});
