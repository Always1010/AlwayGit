import { useEffect, useLayoutEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalSession, TerminalSnapshot } from '../src/protocol/terminal';
import { rpc, subscribe } from './rpc';
import { useWorkbench } from './store';
import { translate } from './text';
import { useDock } from './dock-store';

export function TerminalView({ session, active }: { session: TerminalSession; active: boolean }) {
  const element = useRef<HTMLDivElement>(null), terminal = useRef<Terminal>(undefined), fit = useRef<FitAddon>(undefined);
  const status = useRef(session.status); status.current = session.status;
  const appearance = useWorkbench(state => state.appearance), language = useWorkbench(state => state.language);
  useLayoutEffect(() => {
    const container = element.current!;
    const term = new Terminal({ cursorBlink: true, fontSize: useWorkbench.getState().appearance.codeFont, scrollback: 5000,
      fontFamily: String.raw`Consolas, "Cascadia Mono", monospace`, allowProposedApi: false });
    const fitter = new FitAddon(); term.loadAddon(fitter); term.open(container); terminal.current = term; fit.current = fitter;
    let disposed = false, ready = false, sequence = 0, queued: { sequence: number; data: string }[] = [];
    let input = '', timer: ReturnType<typeof setTimeout> | undefined, sending = Promise.resolve();
    const report = (error: unknown) => { if (!disposed) useWorkbench.getState().report(error); };
    const write = (data: string, index: number) => term.write(data, () => {
      if (!disposed) void rpc('terminalAck', undefined, { sessionId: session.id, sequence: index }).catch(report);
    });
    const flushInput = () => {
      clearTimeout(timer); timer = undefined; if (!input) return;
      const data = input; input = '';
      sending = sending.then(async () => { if (!disposed && status.current === 'running') await rpc('terminalInput', undefined, { sessionId: session.id, data }); }).catch(report);
    };
    const unsubscribe = subscribe(event => {
      if (event.type !== 'terminalOutput' || event.sessionId !== session.id) return;
      if (!ready) queued.push(event);
      else if (event.sequence > sequence) { sequence = event.sequence; write(event.data, event.sequence); }
    });
    void rpc<TerminalSnapshot>('terminalSync', undefined, { sessionId: session.id }).then(snapshot => {
      if (disposed) return;
      useDock.setState(state => ({ sessions: state.sessions.map(s => s.id === session.id ? { ...s, status: snapshot.status, exitCode: snapshot.exitCode } : s) }));
      sequence = snapshot.sequence; write(snapshot.output, snapshot.sequence); ready = true;
      for (const event of queued) if (event.sequence > sequence) { sequence = event.sequence; write(event.data, event.sequence); }
      queued = [];
    }).catch(report);
    const dataSubscription = term.onData(data => {
      if (status.current !== 'running') return;
      // Preserve ordering and cap IPC messages, including large pasted text.
      for (let offset = 0; offset < data.length; offset += 32768) {
        input += data.slice(offset, offset + 32768); if (input.length >= 32768) flushInput();
      }
      timer ??= setTimeout(flushInput, 4);
    });
    term.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown' || !event.ctrlKey || event.altKey || event.metaKey) return true;
      if (event.key.toLowerCase() === 'c' && (event.shiftKey || term.hasSelection())) {
        event.preventDefault(); const text = term.getSelection(); if (text) void rpc('copyText', undefined, { text }).catch(report); return false;
      }
      if (event.key.toLowerCase() === 'v' && event.shiftKey) {
        event.preventDefault(); void rpc<string>('terminalClipboard', undefined, { sessionId: session.id }).then(text => { if (!disposed) term.paste(text); }).catch(report); return false;
      }
      return true;
    });
    const resizeSubscription = term.onResize(({ cols, rows }) => {
      if (cols >= 2 && rows >= 1 && cols <= 500 && rows <= 300 && status.current === 'running') void rpc('terminalResize', undefined, { sessionId: session.id, cols, rows }).catch(report);
    });
    const resize = new ResizeObserver(() => { if (container.clientWidth && container.clientHeight) fitter.fit(); }); resize.observe(container);
    return () => { disposed = true; clearTimeout(timer); unsubscribe(); resize.disconnect(); dataSubscription.dispose(); resizeSubscription.dispose(); term.dispose(); terminal.current = undefined; fit.current = undefined; };
  }, [session.id]);
  useLayoutEffect(() => {
    const term = terminal.current, container = element.current; if (!term || !container) return;
    const css = getComputedStyle(container);
    term.options.fontSize = appearance.codeFont;
    term.options.theme = { background: css.getPropertyValue('--bg').trim(), foreground: css.getPropertyValue('--fg').trim(), cursor: css.getPropertyValue('--fg').trim(), selectionBackground: '#507cc766' };
    term.textarea?.setAttribute('aria-label', translate(language, 'dock.terminalLabel', { title: session.title }));
    if (active) { fit.current?.fit(); if (!document.querySelector('[aria-modal="true"]')) term.focus(); }
  }, [active, appearance, language, session.title]);
  useEffect(() => {
    const clear = (event: Event) => { if ((event as CustomEvent<string>).detail === session.id) terminal.current?.clear(); };
    window.addEventListener('alwaygit-terminal-clear', clear); return () => window.removeEventListener('alwaygit-terminal-clear', clear);
  }, [session.id]);
  return <div ref={element} className="terminal-view" data-terminal-input="true" onContextMenu={event => event.stopPropagation()}/>;
}
