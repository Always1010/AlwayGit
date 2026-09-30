import type { GitRef } from '../src/protocol/types';

export interface RefTreeNode { key:string; label:string; ref?:GitRef; children:RefTreeNode[] }

export function buildRefTree(refs:GitRef[],keyPrefix:string,stripPrefix=''):RefTreeNode[] {
  const roots:RefTreeNode[]=[],children=(nodes:RefTreeNode[],label:string,key:string)=>{
    let node=nodes.find(item=>item.label===label);
    if(!node){node={key,label,children:[]};nodes.push(node);}
    return node;
  };
  for(const ref of refs){
    const relative=stripPrefix&&ref.name.startsWith(stripPrefix+'/')?ref.name.slice(stripPrefix.length+1):ref.name;
    const segments=relative.split('/').filter(Boolean);let nodes=roots,path='';
    for(const [index,label] of segments.entries()){path=path?`${path}/${label}`:label;const node=children(nodes,label,`${keyPrefix}:${path}`);if(index===segments.length-1)node.ref=ref;nodes=node.children;}
  }
  const sort=(nodes:RefTreeNode[])=>{nodes.sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true,sensitivity:'base'}));nodes.forEach(node=>sort(node.children));};sort(roots);return roots;
}

export function refsUnder(node:RefTreeNode):GitRef[] { return [...(node.ref?[node.ref]:[]),...node.children.flatMap(refsUnder)]; }
export function folderKeys(name:string,keyPrefix:string,stripPrefix=''):string[] {
  const relative=stripPrefix&&name.startsWith(stripPrefix+'/')?name.slice(stripPrefix.length+1):name,segments=relative.split('/').filter(Boolean),keys:string[]=[];
  for(let index=1;index<segments.length;index++)keys.push(`${keyPrefix}:${segments.slice(0,index).join('/')}`);
  return keys;
}
