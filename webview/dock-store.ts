import { create } from 'zustand';
import type { TerminalSession, TerminalShell } from '../src/protocol/terminal';
import { rpc, subscribe } from './rpc';

interface DockState {
  sessions: TerminalSession[]; activeId: string; creating: boolean;
  select(id: string): void; load(): Promise<void>; create(repoId: string, shell?: TerminalShell): Promise<void>;
  close(id: string): Promise<void>; restart(id: string): Promise<void>;
}
let loadTask: Promise<void> | undefined;
export const useDock = create<DockState>((set, get) => ({
  sessions: [], activeId: globalThis.window?.__ALWAYGIT_TRANSFER__?.activeTerminal ?? 'diff', creating: false,
  select(activeId) { set({ activeId }); },
  load() {
    if (loadTask) return loadTask;
    const task = (async () => {
      const result = await rpc<TerminalSession[]>('terminalList'), sessions = Array.isArray(result) ? result : [];
      set({ sessions, activeId: get().activeId === 'diff' || sessions.some(s => s.id === get().activeId) ? get().activeId : 'diff' });
    })().catch(error => {
      if (loadTask === task) loadTask = undefined;
      throw error;
    });
    loadTask = task;
    return task;
  },
  async create(repoId, shell = 'default') {
    if (get().creating) return; set({ creating: true });
    try { await loadTask; const session = await rpc<TerminalSession>('terminalCreate', repoId, { shell, cols: 80, rows: 24 }); set(state => ({ sessions: [...state.sessions, session], activeId: session.id })); }
    finally { set({ creating: false }); }
  },
  async close(id) { await rpc('terminalClose', undefined, { sessionId: id }); },
  async restart(id) {
    const session = await rpc<TerminalSession>('terminalRestart', undefined, { sessionId: id });
    set(state => ({ sessions: [...state.sessions.filter(s => s.id !== id), session], activeId: session.id }));
  },
}));
subscribe(event => {
  if (event.type === 'terminalUpdated') useDock.setState(state => ({ sessions: state.sessions.map(s => s.id === event.session.id ? event.session : s) }));
  if (event.type === 'terminalClosed') useDock.setState(state => {
    const index = state.sessions.findIndex(s => s.id === event.sessionId), sessions = state.sessions.filter(s => s.id !== event.sessionId);
    return { sessions, activeId: state.activeId === event.sessionId ? sessions[Math.max(0, index - 1)]?.id ?? 'diff' : state.activeId };
  });
});
