import * as vscode from 'vscode';
import { preferredLanguage } from '../application/language';
import { translate } from '../i18n/index';
import type { Workbench } from './workbench';

export const workbenchViewIds = { sidebar: 'alwaygit.workbenchLauncher', auxiliary: 'alwaygit.workbenchAuxiliary', panel: 'alwaygit.workbenchPanel' } as const;

export const workbenchContainerIds = { sidebar: 'workbench.view.extension.alwaygit', auxiliary: 'workbench.view.extension.alwaygit-auxiliary', panel: 'workbench.view.extension.alwaygit-panel' } as const;

/** Retain the legacy sidebar identity and register independent secondary-sidebar and panel views. */
export function createWorkbenchActivityLauncher(workbench: Workbench): vscode.Disposable {
  const registrations = (['sidebar', 'auxiliary', 'panel'] as const).map(location => vscode.window.registerWebviewViewProvider(workbenchViewIds[location], {
    resolveWebviewView: (view, context) => workbench.resolveDockedView(view, context.state, location),
  }, { webviewOptions: { retainContextWhenHidden: true } }));
  return { dispose() { for (const registration of registrations) registration.dispose(); } };
}

export function workbenchLauncherHtml(resources?: { script: string; stylesheet: string; cspSource: string; nonce: string }): string {
  const language = preferredLanguage();
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  const csp = resources ? `style-src ${resources.cspSource} 'unsafe-inline'; script-src 'nonce-${resources.nonce}';` : "style-src 'unsafe-inline';";
  return `<!DOCTYPE html><html lang="${language}"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${escape(csp)}"><style>
    body{margin:0;padding:20px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-sideBar-background)}
    a{display:block;margin:0 0 16px;padding:5px 8px;text-align:center;text-decoration:none;border-radius:2px;color:var(--vscode-button-foreground);background:var(--vscode-button-background)}
    a:hover{background:var(--vscode-button-hoverBackground)}a:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}
  </style>${resources ? `<link rel="stylesheet" href="${escape(resources.stylesheet)}">` : ''}</head><body>
    <a href="command:alwaygit.showWorkbench">${escape(translate(language, 'workbenchEntry.showGitWorkbench'))}</a>
    <a href="command:alwaygit.openWorkbenchInNewWindow">${escape(translate(language, 'manifest.contributes.commands.item1.title'))}</a>
    <div id="locations-root"></div>
    ${resources ? `<script nonce="${escape(resources.nonce)}" src="${escape(resources.script)}"></script>` : ''}
  </body></html>`;
}
