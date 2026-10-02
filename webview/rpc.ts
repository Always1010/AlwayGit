import type { HostMessage, RpcRequest } from '../src/protocol/types';
import { createDemoRequest } from './demo';
import { RpcError } from './rpc-error';
export { RpcError } from './rpc-error';
import type { SessionState } from '../src/protocol/session';
export type { LayoutState, SessionState } from '../src/protocol/session';
import { SessionPersistence } from './session-persistence';
import { readQueryCategory, type ReadQueryCategory } from '../src/protocol/queries';

declare global { interface Window { __ALWAYGIT_SESSION__?: SessionState; acquireVsCodeApi?: () => { postMessage(message: unknown): void; getState?(): SessionState | undefined; setState?(state: SessionState): void }; } }
const vscode = typeof window.acquireVsCodeApi === 'function' ? window.acquireVsCodeApi() : undefined;
export const demoMode = !vscode && new URLSearchParams(location.search).get('demo') === '1';
export const connected = !!vscode || demoMode;
export function readSession(): SessionState {
  if (vscode) return vscode.getState?.() ?? window.__ALWAYGIT_SESSION__ ?? {};
  if (demoMode) try { return JSON.parse(localStorage.getItem('alwaygit.demo-session') || '{}'); } catch { return {}; }
  return {};
}
const sessions = new SessionPersistence<SessionState>(
  state => { if (vscode) vscode.setState?.(state); else if (demoMode) localStorage.setItem('alwaygit.demo-session', JSON.stringify(state)); },
  async state => { if (vscode) await rpc('saveSession', undefined, state); },
);
export function saveSession(state: SessionState, onError?: (error: Error) => void) {
  sessions.save(state, onError);
}
const listeners = new Set<(event: HostMessage) => void>();
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout>; category?: ReadQueryCategory; repoId?: string; cleanup?(): void }>();
let sequence = 0;
let demoRequest: ReturnType<typeof createDemoRequest> | undefined;
function cancelRead(id:string,error:Error=new RpcError('The read request was cancelled.','ABORTED')):void{
  const request=pending.get(id);if(!request?.category)return;
  pending.delete(id);clearTimeout(request.timer);request.cleanup?.();request.reject(error);
  vscode?.postMessage({id:`webview-${++sequence}`,method:'cancelQuery',payload:{requestId:id}} satisfies RpcRequest);
}
window.addEventListener('message', event => {
  const message = event.data as HostMessage;
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'response') {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);request.cleanup?.();
    if (message.error) request.reject(new RpcError(message.error.message, message.error.code, message.error.details)); else request.resolve(message.result);
  } else listeners.forEach(listener => listener(message));
});
export function subscribe(listener: (event: HostMessage) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export async function rpc<T>(method: RpcRequest['method'], repoId?: string, payload?: unknown, options?:{signal?:AbortSignal}): Promise<T> {
  const category=readQueryCategory(method),signal=category?options?.signal:undefined;
  if(signal?.aborted)throw new RpcError('The read request was cancelled.','ABORTED');
  if (demoMode) {demoRequest ??= createDemoRequest(event=>listeners.forEach(listener=>listener(event)));const result=await demoRequest(method,payload,repoId);if(signal?.aborted)throw new RpcError('The read request was cancelled.','ABORTED');return result as T;}
  if (!vscode) throw new Error('Open AlwayGit in VS Code to connect to your repositories.');
  for(const [previousId,request] of [...pending])if(category&&request.category===category||method==='snapshot'&&request.category&&request.repoId!==repoId)cancelRead(previousId);
  const id = `webview-${++sequence}`;
  return new Promise<T>((resolve, reject) => {
    // The host owns mutation deadlines, including time spent in native confirmation.
    const timer = ['action','pickRepositoryDirectory','discoverRepositories','addRepository'].includes(method) ? undefined : setTimeout(() => { if(category)cancelRead(id,new RpcError('The read request timed out.','TIMEOUT'));else{pending.delete(id);reject(new Error('The Git operation timed out. Refresh to check its result before retrying.'));} }, method === 'saveSession' ? 10_000 : 180_000);
    const abort=()=>cancelRead(id);
    pending.set(id, { resolve: value => resolve(value as T), reject, timer, category, repoId, cleanup:signal?()=>signal.removeEventListener('abort',abort):undefined });
    signal?.addEventListener('abort',abort,{once:true});
    vscode.postMessage({ id, method, repoId, payload } satisfies RpcRequest);
  });
}
