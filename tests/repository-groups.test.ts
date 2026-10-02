import { describe, expect, it } from 'vitest';
import { groupRepositories } from '../src/protocol/repositories';
import type { Repository, RepositoryCollection } from '../src/protocol/types';
import { repositoryOrderKey } from '../src/protocol/repository-order';
import { repositoryDisplayEntries, visibleRepositoryKeys } from '../webview/repositoryOrder';

const main: Repository = { id: 'main', root: 'D:/Projects/App', commonDir: 'D:/Projects/App/.git', name: 'App', mainRoot: 'D:/Projects/App' };
const linked: Repository = { ...main, id: 'linked', root: 'D:/Projects/App-feature', name: 'App-feature' };
describe('logical repository display groups', () => {
  it('prefers the main directory regardless of discovery order while retaining every operation ID', () => {
    const groups = groupRepositories([linked, main]);
    expect(groups).toHaveLength(1); expect(groups[0]).toMatchObject({ name: 'App', repository: main, members: [linked, main] });
    expect(groupRepositories([linked, main], linked.id)[0].repository).toBe(linked);
    expect(main.name).toBe('App'); expect(linked.name).toBe('App-feature');
  });
  it('keeps the repository name when only a linked Worktree was selected', () => {
    expect(groupRepositories([linked])[0]).toMatchObject({ name: 'App', repository: linked });
  });
  it('normalizes Windows storage paths but keeps separate clones and POSIX case distinct', () => {
    const differentlySpelled = { ...linked, commonDir: 'd:\\projects\\APP\\.git\\' };
    const clone = { ...main, id: 'clone', root: 'D:/Other/App', commonDir: 'D:/Other/App/.git', mainRoot: 'D:/Other/App' };
    expect(groupRepositories([main, differentlySpelled, clone])).toHaveLength(2);
    expect(groupRepositories([{ ...main, commonDir: '/repo/.git' }, { ...linked, commonDir: '/Repo/.git' }])).toHaveLength(2);
  });
  it('accepts legacy repository metadata without changing working-directory identities', () => {
    const { mainRoot: _mainRoot, ...legacy } = main;
    const { mainRoot: _linkedRoot, ...legacyLinked } = linked;
    const group = groupRepositories([legacy, legacyLinked], legacyLinked.id)[0];
    expect(group.members.map(repo => repo.id)).toEqual(['main', 'linked']);
    expect(group.name).toBe('App'); expect(group.repository.root).toBe(linked.root);
  });
  it('carries a user collection across the logical repository without changing operation targets', () => {
    const group=groupRepositories([{...linked,collectionId:'client-project'},main])[0];
    expect(group.collectionId).toBe('client-project');
    expect(group.repository.id).toBe(main.id);
  });
  it('uses rendered repository order when registration order differs', () => {
    const repo = (name:string, collectionId?:string):Repository => ({ id:name, root:`D:/Projects/${name}`, commonDir:`D:/Projects/${name}/.git`, name, ...(collectionId?{collectionId}:{}) });
    const groups=groupRepositories([repo('llvm-project'),repo('MySkill'),repo('SchedulePin'),repo('BreakReminder'),repo('CaptionRoll'),repo('NotesAnywhere'),repo('LibreCAD'),repo('SwiftResume')]);
    const entries=repositoryDisplayEntries(groups,[]);
    expect(entries.map(entry=>entry.label)).toEqual(['BreakReminder','CaptionRoll','LibreCAD','llvm-project','MySkill','NotesAnywhere','SchedulePin','SwiftResume']);
    expect(visibleRepositoryKeys(entries,groups,[]).map(key=>groups.find(group=>group.key===key)?.name)).toEqual(entries.map(entry=>entry.label));
  });
  it('uses saved mixed root and member order for rendering and visible selection', () => {
    const clone={...main,id:'clone',root:'D:/Clone',commonDir:'D:/Clone/.git',mainRoot:'D:/Clone',name:'Clone'},other={...linked,id:'other',commonDir:'D:/Other/.git',collectionId:'client'};
    const groups=groupRepositories([{...main,collectionId:'client'},other,clone]),keys=groups.map(group=>repositoryOrderKey(group.key));
    const collections=[{id:'client',name:'Client'},{id:'other',name:'Other'}],order={root:['collection:other',keys[2],'collection:client'],collections:{client:[keys[1],keys[0]],other:[]}};
    const entries=repositoryDisplayEntries(groups,collections,order);
    expect(entries.map(entry=>entry.label)).toEqual(['Other','Clone','Client']);
    expect(visibleRepositoryKeys(entries,groups,[],order)).toEqual([groups[2].key,groups[1].key,groups[0].key]);
    expect(visibleRepositoryKeys(entries,groups,['client'],order)).toEqual([groups[2].key]);
  });
  it('excludes collapsed collection members from the visible repository range', () => {
    const collections:RepositoryCollection[]=[{id:'client',name:'Client'}];
    const groups=groupRepositories([{...main,collectionId:'client'},linked]);
    const entries=repositoryDisplayEntries(groups,collections);
    expect(visibleRepositoryKeys(entries,groups,[])).toEqual([groups[0].key]);
    expect(visibleRepositoryKeys(entries,groups,['client'])).toEqual([]);
  });
});
