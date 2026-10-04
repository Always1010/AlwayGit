import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { DiffPreview } from './DiffPreview';
import { useDock } from './dock-store';
import { useWorkbench } from './store';
import { useWorkbenchFields } from './subscriptions';
import { rpc, subscribe } from './rpc';
import { useTranslation } from './i18n';
import { Button, hasOpenInteractionLayer, Icon, Modal } from './ui';
import { useShortcuts } from './shortcuts';
import { ContextMenu, type MenuItem } from './ContextMenu';
import type { TerminalShell } from '../src/protocol/terminal';
import './dock.css';
const TerminalView = lazy(() => import('./TerminalView').then(module => ({ default: module.TerminalView })));

export function BottomDock({ native, edit }: { native(): void; edit(): void }) {
  const dock = useDock(), state = useWorkbenchFields('repoId', 'selectedFile', 'layout', 'setLayout'), t = useTranslation();
  const [maximized, setMaximized] = useState(false), [menu, setMenu] = useState<{ kind: 'shell' | 'tabs'; anchor: HTMLButtonElement; x: number; y: number }>(), [rename, setRename] = useState<{ id: string; title: string }>();
  const tabs = useRef<HTMLDivElement>(null), active = dock.sessions.find(s => s.id === dock.activeId);
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const openMenu = (kind: 'shell' | 'tabs', anchor: HTMLButtonElement) => {
    const rect = anchor.getBoundingClientRect(); setMenu({ kind, anchor, x: rect.left, y: rect.top });
  };
  const menuKey = (event: ReactKeyboardEvent<HTMLButtonElement>, kind: 'shell' | 'tabs') => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); openMenu(kind, event.currentTarget);
  };
  const run = useCallback((task: Promise<unknown>) => { void task.catch(error => useWorkbench.getState().report(error)); }, []);
  const create = useCallback((shell: TerminalShell = 'default') => {
    const repoId = useWorkbench.getState().repoId; if (!repoId) return;
    setMenu(undefined); useWorkbench.getState().setLayout({ diffCollapsed: false }); run(useDock.getState().create(repoId, shell));
  }, [run]);
  const select = useCallback((id: string) => { dock.select(id); state.setLayout({ diffCollapsed: false }); setMenu(undefined); }, [dock, state.setLayout]);
  const focusTerminal = useCallback(() => {
    const current = useDock.getState(), id = current.activeId === 'diff' ? current.sessions.at(-1)?.id : current.activeId;
    if (!id) { create(); return; }
    select(id);
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('alwaygit-terminal-focus', { detail: id })), 0);
  }, [create, select]);
  useShortcuts({
    terminalNew: { enabled: !!state.repoId && !dock.creating, run: () => create() },
    terminalFocus: { enabled: !!state.repoId, run: focusTerminal },
  });
  useEffect(() => { run(useDock.getState().load()); return subscribe(event => { if (event.type === 'terminalRequested') create(); }); }, [create, run]);
  useEffect(() => { tabs.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [dock.activeId]);
  useEffect(() => { if (state.layout.diffCollapsed) setMaximized(false); }, [state.layout.diffCollapsed]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && !hasOpenInteractionLayer()) { setMenu(undefined); setMaximized(false); } };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, []);
  const diffTitle = state.selectedFile ? `${t('diff.diff')}${state.selectedFile}` : 'Diff';
  const menuItems: MenuItem[] = menu?.kind === 'shell'
    ? (['default', 'powershell', 'cmd', 'bash'] as const).map(shell => ({ label: shell === 'default' ? t('dock.defaultShell') : shell === 'powershell' ? 'PowerShell' : shell === 'cmd' ? 'cmd' : 'Bash', icon: 'terminal', run: () => create(shell) }))
    : [{ label: diffTitle, reason: diffTitle, icon: 'diff', run: () => select('diff') }, ...dock.sessions.map(session => ({ label: session.title, reason: `${session.title}\n${session.cwd}`, icon: 'terminal', run: () => select(session.id) }))];
  return <section className={`bottom-dock${maximized ? ' dock-maximized' : ''}`} data-testid="bottom-dock" aria-label={t('dock.panel')}>
    <div className="dock-heading">
      <div ref={tabs} className="dock-tabs" role="tablist" aria-label={t('dock.tabs')} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const ids = ['diff', ...dock.sessions.map(s => s.id)], index = ids.indexOf(dock.activeId);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
        event.preventDefault(); dock.select(ids[next]); tabs.current?.querySelector<HTMLElement>(`[data-tab-id="${ids[next]}"]`)?.focus();
      }}>
        <div className="dock-tab-wrap" data-active={dock.activeId === 'diff'}>
          <button id="dock-tab-diff" role="tab" data-tab-id="diff" aria-selected={dock.activeId === 'diff'} aria-controls="dock-content-diff" tabIndex={dock.activeId === 'diff' ? 0 : -1} className="dock-tab" title={diffTitle} onClick={() => select('diff')}><Icon name="diff"/><span>{diffTitle}</span></button>
        </div>
        {dock.sessions.map(session => <div className="dock-tab-wrap" data-active={dock.activeId === session.id} key={session.id}>
          <button id={`dock-tab-${session.id}`} role="tab" data-tab-id={session.id} aria-controls={`dock-content-${session.id}`} aria-selected={dock.activeId === session.id} tabIndex={dock.activeId === session.id ? 0 : -1} className="dock-tab" title={`${session.title}\n${session.cwd}`} onClick={() => select(session.id)} onDoubleClick={() => setRename({ id: session.id, title: session.title })}><Icon name="terminal"/><span>{session.title}</span>{session.status === 'exited' && <Icon name={session.exitCode ? 'error' : 'debug-stop'}/>}</button>
          <Button className="icon-only dock-tab-close" icon="close" title={t('dock.close')} aria-label={t('dock.close')} onClick={() => run(dock.close(session.id))}/>
        </div>)}
      </div>
      <div className="dock-common-actions">
        <Button className="icon-only" icon="add" shortcut="terminalNew" title={t('dock.newTerminal')} aria-label={t('dock.newTerminal')} disabled={!state.repoId || dock.creating} onClick={() => create()}/>
        <Button className="icon-only" icon="chevron-down" title={t('dock.chooseShell')} aria-label={t('dock.chooseShell')} aria-haspopup="menu" aria-expanded={menu?.kind === 'shell'} disabled={!state.repoId} onKeyDown={event => menuKey(event, 'shell')} onClick={event => menu?.kind === 'shell' ? closeMenu() : openMenu('shell', event.currentTarget)}/>
        <Button className="icon-only" icon="list-selection" title={t('dock.allTabs')} aria-label={t('dock.allTabs')} aria-haspopup="menu" aria-expanded={menu?.kind === 'tabs'} onKeyDown={event => menuKey(event, 'tabs')} onClick={event => menu?.kind === 'tabs' ? closeMenu() : openMenu('tabs', event.currentTarget)}/>
        <Button className="icon-only" icon={maximized ? 'screen-normal' : 'screen-full'} title={t(maximized ? 'dock.restore' : 'dock.maximize')} aria-label={t(maximized ? 'dock.restore' : 'dock.maximize')} disabled={state.layout.diffCollapsed} onClick={() => setMaximized(!maximized)}/>
        <Button className="icon-only" icon={state.layout.diffCollapsed ? 'chevron-up' : 'chevron-down'} title={t(state.layout.diffCollapsed ? 'dock.expand' : 'dock.collapse')} aria-label={t(state.layout.diffCollapsed ? 'dock.expand' : 'dock.collapse')} onClick={() => state.setLayout({ diffCollapsed: !state.layout.diffCollapsed })}/>
      </div>
    </div>
    <div id="dock-content-diff" role="tabpanel" aria-labelledby="dock-tab-diff" className="dock-content" hidden={dock.activeId !== 'diff' || state.layout.diffCollapsed}><DiffPreview native={native} edit={edit} active={dock.activeId === 'diff'}/></div>
    {dock.sessions.map(session => <div id={`dock-content-${session.id}`} role="tabpanel" aria-labelledby={`dock-tab-${session.id}`} key={session.id} className="dock-content terminal-content" hidden={dock.activeId !== session.id || state.layout.diffCollapsed}>
      <div className="pane-heading"><span className="truncate" title={session.cwd}>{session.cwd}</span><div className="inline-actions">
        {session.status === 'exited' && <span role="status">{t('dock.exited', { code: session.exitCode ?? 0 })}</span>}
        <Button className="icon-only" icon="clear-all" title={t('dock.clear')} aria-label={t('dock.clear')} onClick={() => window.dispatchEvent(new CustomEvent('alwaygit-terminal-clear', { detail: session.id }))}/>
        <Button className="icon-only" icon="edit" title={t('dock.rename')} aria-label={t('dock.rename')} onClick={() => setRename({ id: session.id, title: session.title })}/>
        {session.status === 'exited' && <Button className="icon-only" icon="debug-restart" title={t('dock.restart')} aria-label={t('dock.restart')} onClick={() => run(dock.restart(session.id))}/>}
      </div></div>
      <Suspense fallback={null}><TerminalView session={session} active={active?.id === session.id && !state.layout.diffCollapsed}/></Suspense>
    </div>)}
    {rename && <Modal title={t('dock.rename')} onClose={() => setRename(undefined)} footer={<><Button onClick={() => setRename(undefined)}>{t('common.cancel')}</Button><Button className="primary" disabled={!rename.title.trim()} onClick={() => run(rpc('terminalRename', undefined, { sessionId: rename.id, title: rename.title.trim() }).then(() => setRename(undefined)))}>{t('common.apply')}</Button></>}><input aria-label={t('dock.rename')} data-autofocus="true" maxLength={80} value={rename.title} onChange={event => setRename({ ...rename, title: event.target.value })}/></Modal>}
    {menu && <ContextMenu x={menu.x} y={menu.y} anchor={menu.anchor} caption={t(menu.kind === 'shell' ? 'dock.chooseShell' : 'dock.allTabs')} items={menuItems} close={closeMenu} className="dock-context-menu" placement="above"/>}
  </section>;
}
