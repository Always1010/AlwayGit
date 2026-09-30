// Git for Windows emits '/' while VS Code commonly reports '\\'.
export function pathIdentity(path: string): string {
  const normalized=path.replace(/\\/g,'/').replace(/\/+$/,'');
  return /^[a-z]:\//i.test(normalized)||normalized.startsWith('//')?normalized.toLowerCase():normalized;
}
export const samePath=(left:string,right:string)=>pathIdentity(left)===pathIdentity(right);
