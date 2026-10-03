import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { translator } from '../src/i18n';
import { BottomDock } from '../webview/BottomDock';

const fixture = vi.hoisted(() => ({
  workbench: { repoId: 'repo', selectedFile: 'file.ts', layout: { diffCollapsed: false }, setLayout: vi.fn(), singleKeyShortcuts: true },
  dock: { activeId: 'terminal-a', sessions: [{ id: 'terminal-a', title: 'PowerShell', cwd: '/repo', repoId: 'repo', shell: 'default', status: 'running' }], creating: false, select: vi.fn(), close: vi.fn() },
}));
vi.mock('../webview/store', () => ({ useWorkbench: Object.assign((selector: (state: unknown) => unknown) => selector(fixture.workbench), { getState: () => fixture.workbench }) }));
vi.mock('../webview/subscriptions', () => ({ useWorkbenchFields: () => fixture.workbench }));
vi.mock('../webview/dock-store', () => ({ useDock: Object.assign(() => fixture.dock, { getState: () => fixture.dock }) }));
vi.mock('../webview/rpc', () => ({ rpc: vi.fn(), subscribe: vi.fn(() => () => {}) }));
vi.mock('../webview/i18n', () => ({ useTranslation: () => translator('en') }));
vi.mock('../webview/DiffPreview', () => ({ DiffPreview: () => <div/> }));
vi.mock('../webview/TerminalView', () => ({ TerminalView: () => <div/> }));
afterEach(() => { fixture.dock.sessions[0].status = 'running'; });

describe('bottom dock tab presentation', () => {
  it('gives Diff the same bounded container and spans selected state across title and close', () => {
    const html = renderToStaticMarkup(<BottomDock native={() => {}} edit={() => {}}/>);
    expect(html).toMatch(/class="dock-tab-wrap" data-active="false"><button id="dock-tab-diff"/);
    const terminalTab = html.match(/class="dock-tab-wrap" data-active="true">([\s\S]*?)<\/div>/)?.[1];
    expect(terminalTab).toContain('aria-selected="true"');
    expect(terminalTab).toContain('dock-tab-close');
    expect(terminalTab).toContain('Close terminal and end its shell');
    expect(terminalTab).toMatch(/<\/button><button/); // Siblings, never nested interactive buttons.
    const css = readFileSync('webview/dock.css', 'utf8');
    expect(css).toMatch(/\.dock-tab-wrap \{[^}]*border-right:[^}]*border-bottom:/);
    expect(css).toMatch(/\.dock-tab-wrap\[data-active=true\] \{[^}]*border-bottom-color:var\(--accent\)/);
    expect(css).toContain('.dock-tab-wrap:hover');
    expect(css).not.toContain('.dock-tab[aria-selected=true]');
  });
  it('offers restart only after shell exit and never shows a running stop action', () => {
    const running = renderToStaticMarkup(<BottomDock native={() => {}} edit={() => {}}/>);
    expect(running).not.toContain('End shell process');
    expect(running).not.toContain('Restart terminal');
    expect(running).toContain('Close terminal and end its shell');
    fixture.dock.sessions[0].status = 'exited';
    const exited = renderToStaticMarkup(<BottomDock native={() => {}} edit={() => {}}/>);
    expect(exited).toContain('Restart terminal');
    expect(exited).toContain('Exited (0)');
    expect(exited).not.toContain('End shell process');
    expect(exited.match(/aria-label="Collapse bottom panel"/g)).toHaveLength(1);
  });
});
