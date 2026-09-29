import type { Commit, CommitDetails, GitAction, HistoryPage, HistoryQuery, HostMessage, Repository, RpcRequest, Snapshot } from '../src/protocol/types';

export interface SessionState { repoId?: string; drafts?: Record<string, string>; views?: Record<string, { ref?: string; search: string; selectedOid?: string; selectedStashOid?: string; tab: 'history' | 'changes' }> }
declare global { interface Window { __ALWAYGIT_SESSION__?: SessionState; acquireVsCodeApi?: () => { postMessage(message: unknown): void; getState?(): SessionState | undefined; setState?(state: SessionState): void }; } }
const vscode = typeof window.acquireVsCodeApi === 'function' ? window.acquireVsCodeApi() : undefined;
export const demoMode = !vscode && new URLSearchParams(location.search).get('demo') === '1';
export const connected = !!vscode || demoMode;
export function readSession(): SessionState {
  if (vscode) return vscode.getState?.() ?? window.__ALWAYGIT_SESSION__ ?? {};
  if (demoMode) try { return JSON.parse(localStorage.getItem('alwaygit.demo-session') || '{}'); } catch { return {}; }
  return {};
}
let previousSession = '';
export function saveSession(state: SessionState) {
  if (vscode) {
    const serialized = JSON.stringify(state); if (serialized === previousSession) return;
    previousSession = serialized; vscode.setState?.(state);
    vscode.postMessage({ id: `session-${++sequence}`, method: 'saveSession', payload: state }); return;
  }
  if (demoMode) try { localStorage.setItem('alwaygit.demo-session', JSON.stringify(state)); } catch { /* The live session still keeps drafts. */ }
}
const listeners = new Set<(event: HostMessage) => void>();
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let sequence = 0;
window.addEventListener('message', event => {
  const message = event.data as HostMessage;
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'response') {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  } else listeners.forEach(listener => listener(message));
});
export function subscribe(listener: (event: HostMessage) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export async function rpc<T>(method: RpcRequest['method'], repoId?: string, payload?: unknown): Promise<T> {
  if (demoMode) return demoRequest(method, payload) as Promise<T>;
  if (!vscode) throw new Error('Open AlwayGit in VS Code to connect to your repositories.');
  const id = `webview-${++sequence}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The Git operation timed out. Refresh to check its result before retrying.')); }, 180_000);
    pending.set(id, { resolve: value => resolve(value as T), reject, timer });
    vscode.postMessage({ id, method, repoId, payload } satisfies RpcRequest);
  });
}

const repo: Repository = { id: 'demo-alwaygit', root: 'D:\\Projects\\AlwayGit', commonDir: 'D:\\Projects\\AlwayGit\\.git', name: 'AlwayGit' };
const subjects = ['Polish repository workbench interactions', 'Add native diff integration', 'Merge branch feature/history-graph', 'Render commit graph with stable lanes', 'Keep commit drafts when switching repositories', 'Handle renamed files in changes', 'Improve keyboard navigation', 'Add worktree discovery', 'Show upstream tracking status', 'Update development dependencies', 'Fix status refresh after checkout', 'Introduce Git operation progress'];
const authors = ['Alex Chen', 'Morgan Lee', 'Sam Rivera', 'Jamie Park'];
const oid = (n: number) => (0x9a73ed + n * 98761).toString(16).padStart(8, '0') + 'c42d9918a6bc5e4791033ad7e6f202cc';
const commits: Commit[] = Array.from({ length: 180 }, (_, n) => ({ oid: oid(n), parents: n === 179 ? [] : n % 12 === 2 ? [oid(n + 1), oid(n + 4)] : [oid(n + 1)], author: authors[n % 4], email: `${authors[n % 4].split(' ')[0].toLowerCase()}@example.com`, timestamp: 1790715600 - n * 13800, subject: subjects[n % subjects.length] }));
let demoSnapshot: Snapshot = { repository: repo, branch: 'main', head: commits[0].oid, upstream: 'origin/main', ahead: 2, behind: 0, changes: [
  { path: 'webview/App.tsx', indexStatus: 'M', worktreeStatus: ' ', conflict: false, untracked: false },
  { path: 'webview/styles.css', indexStatus: ' ', worktreeStatus: 'M', conflict: false, untracked: false },
  { path: 'src/git/service.ts', indexStatus: ' ', worktreeStatus: 'M', conflict: false, untracked: false },
  { path: 'docs/workbench-notes.md', indexStatus: '?', worktreeStatus: '?', conflict: false, untracked: true },
], refs: [
  { name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: commits[0].oid, upstream: 'origin/main' },
  { name: 'feature/history-graph', fullName: 'refs/heads/feature/history-graph', kind: 'local', oid: commits[3].oid },
  { name: 'fix/status-refresh', fullName: 'refs/heads/fix/status-refresh', kind: 'local', oid: commits[8].oid },
  { name: 'origin/main', fullName: 'refs/remotes/origin/main', kind: 'remote', oid: commits[2].oid },
  { name: 'origin/develop', fullName: 'refs/remotes/origin/develop', kind: 'remote', oid: commits[6].oid },
  { name: 'v0.1.0', fullName: 'refs/tags/v0.1.0', kind: 'tag', oid: commits[14].oid },
], stashes: [{ selector: 'stash@{0}', oid: commits[9].oid, subject: 'WIP: repository picker styling' }], worktrees: [{ path: repo.root, head: commits[0].oid, branch: 'refs/heads/main', bare: false, detached: false }, { path: 'D:\\Projects\\AlwayGit-graph', head: commits[3].oid, branch: 'refs/heads/feature/history-graph', bare: false, detached: false }], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 1 };
async function demoRequest(method: RpcRequest['method'], payload: unknown): Promise<unknown> {
  await new Promise(resolve => setTimeout(resolve, 110));
  if (method === 'repositories' || method === 'addRepository') return [repo];
  if (method === 'snapshot') return structuredClone(demoSnapshot);
  if (method === 'history') {
    const query = (payload ?? {}) as HistoryQuery;
    let result = commits.filter(c => !query.search || `${c.subject} ${c.author} ${c.oid}`.toLowerCase().includes(query.search.toLowerCase()));
    if (query.ref) { const ref = demoSnapshot.refs.find(r => r.fullName === query.ref || r.name === query.ref); if (ref) result = result.slice(Math.max(0, result.findIndex(c => c.oid === ref.oid))); }
    const offset = query.offset ?? 0, limit = query.limit ?? 100;
    return { commits: result.slice(offset, offset + limit), nextOffset: offset + limit, hasMore: offset + limit < result.length, tips: demoSnapshot.refs.map(r => r.oid) } satisfies HistoryPage;
  }
  if (method === 'details') {
    const request = payload as { oid: string; parent?: string }; const commit = commits.find(c => c.oid === request.oid) ?? commits[0];
    return { commit, body: `${commit.subject}\n\nImprove the repository experience with clear status feedback and consistent navigation.\n\nCloses #24`, parent: request.parent ?? commit.parents[0], files: [{ path: 'webview/App.tsx', status: 'M' }, { path: 'webview/styles.css', status: 'M' }, { path: 'src/git/service.ts', status: 'A' }] } satisfies CommitDetails;
  }
  if (method === 'pickWorktree') return 'D:\\Projects\\AlwayGit-new';
  if (method === 'action') {
    const action = payload as GitAction;
    if (action.type === 'stage' || action.type === 'unstage' || action.type === 'discard') {
      demoSnapshot.changes = demoSnapshot.changes.flatMap(change => {
        if (!action.paths.includes(change.path)) return [change];
        if (action.type === 'discard') return change.indexStatus === ' ' || change.untracked ? [] : [{ ...change, worktreeStatus: ' ' }];
        return [{ ...change, indexStatus: action.type === 'stage' ? 'M' : ' ', worktreeStatus: action.type === 'stage' ? ' ' : 'M', conflict: false, untracked: false }];
      });
    } else if (action.type === 'commit') {
      const commit = { ...commits[0], oid: oid(999 + demoSnapshot.version), parents: action.amend ? commits[0].parents : [commits[0].oid], subject: action.message.split('\n')[0], timestamp: Math.floor(Date.now() / 1000) }; if (action.amend) commits.shift(); commits.unshift(commit);
      demoSnapshot.head = commit.oid; demoSnapshot.changes = demoSnapshot.changes.filter(c => c.worktreeStatus !== ' ' || c.untracked).map(c => ({ ...c, indexStatus: ' ' })); demoSnapshot.ahead++;
    } else if (action.type === 'branch.checkout') demoSnapshot.branch = action.name;
    else if (action.type === 'branch.create') { demoSnapshot.refs.push({ name: action.name, fullName: `refs/heads/${action.name}`, kind: 'local', oid: action.start ?? commits[0].oid }); if (action.checkout) demoSnapshot.branch = action.name; }
    else if (action.type === 'branch.delete') demoSnapshot.refs = demoSnapshot.refs.filter(r => !(r.kind === 'local' && r.name === action.name));
    else if (action.type === 'tag.create') demoSnapshot.refs.push({ name: action.name, fullName: `refs/tags/${action.name}`, kind: 'tag', oid: action.target ?? commits[0].oid });
    else if (action.type === 'tag.delete') demoSnapshot.refs = demoSnapshot.refs.filter(r => !(r.kind === 'tag' && r.name === action.name));
    else if (action.type === 'stash.create') { demoSnapshot.stashes.unshift({ selector: `stash@{${demoSnapshot.stashes.length}}`, oid: commits[0].oid, subject: action.message || 'WIP on main' }); demoSnapshot.changes = []; }
    else if (action.type === 'stash.drop' || action.type === 'stash.apply' && action.pop) demoSnapshot.stashes = demoSnapshot.stashes.filter(s => s.selector !== action.selector);
    else if (action.type === 'worktree.add') demoSnapshot.worktrees.push({ path: action.path, head: commits[0].oid, branch: action.branch || action.newBranch, bare: false, detached: !!action.detach });
    else if (action.type === 'worktree.remove') demoSnapshot.worktrees = demoSnapshot.worktrees.filter(w => w.path !== action.path);
    else if (action.type === 'push') demoSnapshot.ahead = 0;
    else if (action.type === 'pull') demoSnapshot.behind = 0;
    demoSnapshot.version++; return undefined;
  }
  return undefined;
}
