import { branchNameProblem } from './ref-name';

export type RemoteNameProblem = 'empty' | 'leading-hyphen' | 'space' | 'invalid';

export function remoteNameProblem(value:string):RemoteNameProblem|undefined {
  if(!value)return 'empty';
  if(value.startsWith('-'))return 'leading-hyphen';
  if(/\s/.test(value))return 'space';
  return branchNameProblem(value)?'invalid':undefined;
}

export function remoteUrlProblem(value:string):'empty'|'control'|undefined {
  if(!value.trim())return 'empty';
  if(/[\0\r\n]/.test(value))return 'control';
  return undefined;
}
