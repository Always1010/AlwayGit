import type { GitRef } from '../protocol/types';

export function inferDefaultBranch(refs: readonly GitRef[], remotes: readonly string[], upstream?: string): string | undefined {
  const upstreamRemote=remotes.slice().sort((a,b)=>b.length-a.length).find(remote=>upstream?.startsWith(`${remote}/`));
  const ordered=[upstreamRemote,'origin',...remotes].filter((remote,index,all):remote is string=>!!remote&&all.indexOf(remote)===index);
  for(const remote of ordered){
    const head=refs.find(ref=>ref.kind==='remote'&&ref.name===`${remote}/HEAD`);
    const target=head&&refs.find(ref=>ref.kind==='remote'&&ref.oid===head.oid&&ref.name.startsWith(`${remote}/`)&&ref.name!==head.name);
    if(target)return target.name.slice(remote.length+1);
  }
  return ['main','master'].find(name=>refs.some(ref=>ref.kind==='local'&&ref.name===name));
}
