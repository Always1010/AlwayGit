import { describe, expect, it } from 'vitest';
import { groupRepositories } from '../src/protocol/repositories';
import type { Repository } from '../src/protocol/types';

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
});
