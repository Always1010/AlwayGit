import { describe, expect, it } from 'vitest';
import type { Commit } from '../src/protocol/types';
import { cherryPickOrder, selectionForClick } from '../webview/commitSelection';

const order=['new','middle','old','root'];
const commit=(oid:string,parents:string[]=[]):Commit=>({oid,parents,author:'A',email:'a@example.com',timestamp:0,subject:oid});

describe('commit multi-selection',()=>{
  it('supports toggle, range, and additive range selection',()=>{
    expect(selectionForClick(order,['new'],'new','old',{toggle:false,range:true}).selected).toEqual(['new','middle','old']);
    expect(selectionForClick(order,['new'],'new','old',{toggle:true,range:true}).selected).toEqual(['new','middle','old']);
    expect(selectionForClick(order,['new','old'],'old','new',{toggle:true,range:false}).selected).toEqual(['old']);
  });

  it('orders selected commits from oldest to newest for cherry-pick',()=>{
    const commits=[commit('new',['middle']),commit('middle',['old']),commit('old',['root']),commit('root')];
    expect(cherryPickOrder(commits,['new','old','middle'])).toEqual(['old','middle','new']);
  });
});
