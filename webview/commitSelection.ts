import type { Commit } from '../src/protocol/types';

export interface SelectionModifiers { toggle: boolean; range: boolean }

export function selectionForClick(order: readonly string[], selected: readonly string[], anchor: string | undefined, oid: string, modifiers: SelectionModifiers): { selected: string[]; anchor: string } {
  if(modifiers.range){
    const from=order.indexOf(anchor??oid),to=order.indexOf(oid);
    const range=from<0||to<0?[oid]:order.slice(Math.min(from,to),Math.max(from,to)+1);
    return {selected:modifiers.toggle?[...new Set([...selected,...range])]:range,anchor:anchor??oid};
  }
  if(modifiers.toggle)return {selected:selected.includes(oid)?selected.filter(item=>item!==oid):[...selected,oid],anchor:oid};
  return {selected:[oid],anchor:oid};
}

export function cherryPickOrder(commits: readonly Commit[], selected: readonly string[]): string[] {
  const wanted=new Set(selected);
  return commits.filter(commit=>wanted.has(commit.oid)).map(commit=>commit.oid).reverse();
}
