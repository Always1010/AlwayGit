import { describe, expect, it } from 'vitest';
import type { Commit } from '../src/protocol/types';
import { buildHistoryItems, WORKING_TREE_OID } from '../webview/historyItems';

const commit = (oid: string, parents: string[] = []): Commit => ({
  oid, parents, author: 'Test', email: 'test@example.com', timestamp: 0, subject: oid,
});

describe('history display items', () => {
  it('places the Working Tree immediately before a visible HEAD', () => {
    const newest=commit('newest',['head']),head=commit('head',['older']),older=commit('older');
    const items=buildHistoryItems([newest,head,older],head);
    expect(items.map(item=>item.oid)).toEqual(['newest',WORKING_TREE_OID,'head','older']);
    expect(items[1]).toMatchObject({kind:'working',parents:['head']});
    expect(items[2]).toMatchObject({kind:'commit',commit:head});
  });

  it('keeps only a standalone Working Tree when filters omit HEAD', () => {
    const head=commit('head',['parent']),match=commit('match',['parent']);
    const items=buildHistoryItems([match],head);
    expect(items.map(item=>item.oid)).toEqual([WORKING_TREE_OID,'match']);
    expect(items[0]).toMatchObject({kind:'working',parents:[]});
  });

  it('renders a standalone mutable root before the first commit exists', () => {
    expect(buildHistoryItems([],undefined)).toEqual([{kind:'working',key:WORKING_TREE_OID,oid:WORKING_TREE_OID,parents:[]}]);
  });
});
