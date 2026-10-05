import { message, MessageError } from '../src/i18n';
import type { HostMessage, RpcRequest } from '../src/protocol/types';
import { createDemoRequest } from './demo';
import { RpcError } from './rpc-error';
export { RpcError } from './rpc-error';
import type { SessionState } from '../src/protocol/session';
import { overlayInterfaceSettings, type InterfacePreferences } from '../src/protocol/interface-settings';
export type { LayoutState, SessionState } from '../src/protocol/session';
import { SessionPersistence } from './session-persistence';
import { readQueryCategory, type ReadQueryCategory } from '../src/protocol/queries';
import type { WorkbenchTransfer, WorkbenchOpenMode } from '../src/protocol/workbench-host';

declare global { interface Window { __ALWAYGIT_SESSION__?: SessionState; __ALWAYGIT_PREFERENCES__?: InterfacePreferences; __ALWAYGIT_HOST__?: WorkbenchOpenMode; __ALWAYGIT_TRANSFER__?: WorkbenchTransfer; acquireVsCodeApi?: () => { postMessage(message: unknown): void; getState?(): SessionState | undefined; setState?(state: SessionState): void }; } }
const vscode = typeof window.acquireVsCodeApi === 'function' ? window.acquireVsCodeApi() : undefined;
export const demoMode = !vscode && new URLSearchParams(location.search).get('demo') === '1';
export const connected = !!vscode || demoMode;
export function readSession(): SessionState {
  if (vscode) return overlayInterfaceSettings(window.__ALWAYGIT_TRANSFER__?.session ?? vscode.getState?.() ?? window.__ALWAYGIT_SESSION__ ?? {}, window.__ALWAYGIT_PREFERENCES__ ?? {});
  if (demoMode) try {
    const session = JSON.parse(localStorage.getItem('alwaygit.demo-session') || '{}');
    const preferences = localStorage.getItem('alwaygit.demo-interfaceSettings');
    return preferences ? overlayInterfaceSettings(session, JSON.parse(preferences)) : session;
  } catch { return {}; }
  return {};
}
const sessions = new SessionPersistence<SessionState>(
  state => { if (vscode) vscode.setState?.(state); else if (demoMode) localStorage.setItem('alwaygit.demo-session', JSON.stringify(state)); },
  async state => { if (vscode) await rpc('saveSession', undefined, state); },
);
export function saveSession(state: SessionState, onError?: (error: Error) => void) {
  sessions.save(state, onError);
}
export function flushSession(): void { sessions.flushNow(); }
const listeners = new Set<(event: HostMessage) => void>();
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout>; category?: ReadQueryCategory; repoId?: string; cleanup?(): void }>();
let sequence = 0;
let demoRequest: ReturnType<typeof createDemoRequest> | undefined;
function cancelRead(id:string,error:Error=new RpcError(message("rpc.theReadRequestWasCancelled"),'ABORTED')):void{
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
    if (message.error) request.reject(new RpcError(message.error.message, message.error.code, message.error.details, message.error.localizedMessage, message.error.pushResult)); else request.resolve(message.result);
  } else listeners.forEach(listener => listener(message));
});
export function subscribe(listener: (event: HostMessage) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export async function rpc<T>(method: RpcRequest['method'], repoId?: string, payload?: unknown, options?:{signal?:AbortSignal}): Promise<T> {
  const category=readQueryCategory(method),signal=category?options?.signal:undefined;
  if(signal?.aborted)throw new RpcError(message("rpc.theReadRequestWasCancelled"),'ABORTED');
  if (demoMode) {demoRequest ??= createDemoRequest(event=>listeners.forEach(listener=>listener(event)));const result=await demoRequest(method,payload,repoId);if(signal?.aborted)throw new RpcError(message("rpc.theReadRequestWasCancelled"),'ABORTED');return result as T;}
  if (!vscode) throw new MessageError(message("rpc.openAlwayGitInVSCodeToConnectToYour"));
  for(const [previousId,request] of [...pending])if(category&&request.category===category||method==='snapshot'&&request.category&&request.repoId!==repoId)cancelRead(previousId);
  const id = `webview-${++sequence}`;
  return new Promise<T>((resolve, reject) => {
    // The host owns mutation deadlines, including time spent in native confirmation.
    const timer = ['action','pickRepositoryDirectory','discoverRepositories','addRepository'].includes(method) ? undefined : setTimeout(() => { if(category)cancelRead(id,new RpcError(message("rpc.theReadRequestTimedOut"),'TIMEOUT'));else{pending.delete(id);reject(new MessageError(message("rpc.theGitOperationTimedOutRefreshToCheckIts")));} }, method === 'saveSession' ? 10_000 : 180_000);
    const abort=()=>cancelRead(id);
    pending.set(id, { resolve: value => resolve(value as T), reject, timer, category, repoId, cleanup:signal?()=>signal.removeEventListener('abort',abort):undefined });
    signal?.addEventListener('abort',abort,{once:true});
    vscode.postMessage({ id, method, repoId, payload } satisfies RpcRequest);
  });
}
