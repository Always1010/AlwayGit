import * as vscode from 'vscode';
import { preferredLanguage } from '../application/language';
import { translate, translator } from '../i18n/index';
import { readWorkbenchLocations, type DockedWorkbenchLocation, type WorkbenchLocations } from '../protocol/workbench-host';
import type { Workbench } from './workbench';

export const workbenchViewIds = { sidebar: 'alwaygit.workbenchLauncher', auxiliary: 'alwaygit.workbenchAuxiliary', panel: 'alwaygit.workbenchPanel' } as const;

export const workbenchContainerIds = { sidebar: 'workbench.view.extension.alwaygit', auxiliary: 'workbench.view.extension.alwaygit-auxiliary', panel: 'workbench.view.extension.alwaygit-panel' } as const;

export const workbenchLocationSettingsCommands = { sidebar: 'alwaygit.sidebarLocationSettings', auxiliary: 'alwaygit.auxiliaryLocationSettings', panel: 'alwaygit.panelLocationSettings' } as const;

/** Retain the legacy sidebar identity and register independent secondary-sidebar and panel views. */
export function createWorkbenchActivityLauncher(workbench: Workbench): vscode.Disposable {
  const registrations = (['sidebar', 'auxiliary', 'panel'] as const).map(location => vscode.window.registerWebviewViewProvider(workbenchViewIds[location], {
    resolveWebviewView: (view, context) => workbench.resolveDockedView(view, context.state, location),
  }, { webviewOptions: { retainContextWhenHidden: true } }));
  return { dispose() { for (const registration of registrations) registration.dispose(); } };
}

export function workbenchLauncherHtml(resources?: { script: string; stylesheet: string; cspSource: string; nonce: string }, locations: WorkbenchLocations = readWorkbenchLocations(undefined), location: DockedWorkbenchLocation = 'sidebar'): string {
  const language = preferredLanguage();
  const t = translator(language);
  const label = (item: WorkbenchLocations['default']) => t(item === 'editor' ? 'workbenchEntry.editorMode' : item === 'sidebar' ? 'workbenchEntry.sidebarMode' : item === 'auxiliary' ? 'workbenchEntry.auxiliaryMode' : 'workbenchEntry.panelMode');
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  const csp = resources ? `style-src ${resources.cspSource} 'unsafe-inline'; script-src 'nonce-${resources.nonce}';` : "style-src 'unsafe-inline';";
  return `<!DOCTYPE html><html lang="${language}"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${escape(csp)}"><style>
    body{margin:0;padding:20px;box-sizing:border-box;font-family:var(--vscode-font-family,sans-serif);font-size:var(--vscode-font-size,13px);line-height:1.6;color:var(--vscode-foreground);background:var(--vscode-sideBar-background)}
    main{max-width:460px;overflow-wrap:anywhere}h1{margin:0 0 12px;font-size:18px;font-weight:600;line-height:1.4}p{margin:0 0 16px;color:var(--vscode-descriptionForeground)}
    dl{margin:0 0 20px;padding:12px;border:1px solid var(--vscode-widget-border,var(--vscode-contrastBorder,transparent));border-radius:3px;background:var(--vscode-editorWidget-background)}dl div+div{margin-top:8px}dt{color:var(--vscode-descriptionForeground)}dd{margin:0}dl div:first-child dd{font-weight:600}
    a{color:var(--vscode-textLink-foreground);text-decoration:none}a:hover{color:var(--vscode-textLink-activeForeground);text-decoration:underline}a:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}
    .launcher-primary{display:block;padding:6px 10px;text-align:center;border:1px solid var(--vscode-button-border,transparent);border-radius:2px;color:var(--vscode-button-foreground);background:var(--vscode-button-background)}.launcher-primary:hover{color:var(--vscode-button-foreground);background:var(--vscode-button-hoverBackground);text-decoration:none}
    .launcher-destination{margin:6px 0 16px;font-size:.95em}.launcher-settings{display:inline-block}.launcher-window{margin-top:24px;padding-top:16px;border-top:1px solid var(--vscode-widget-border,var(--vscode-contrastBorder,transparent))}.launcher-window p{margin:6px 0 0;font-size:.95em}
  </style>${resources ? `<link rel="stylesheet" href="${escape(resources.stylesheet)}">` : ''}</head><body>
    <main aria-labelledby="launcher-title">
      <h1 id="launcher-title">${escape(t('workbenchEntry.getStarted'))}</h1>
      <p>${escape(t('workbenchEntry.launcherDescription'))}</p>
      <dl><div><dt>${escape(t('workbenchEntry.currentDefault'))}</dt><dd>${escape(label(locations.default))}</dd></div><div><dt>${escape(t('workbenchEntry.enabledLocations'))}</dt><dd>${escape(locations.enabled.map(label).join(language === 'zh-CN' ? '、' : ', '))}</dd></div></dl>
      <a class="launcher-primary" href="command:alwaygit.showWorkbench" aria-describedby="launcher-destination">${escape(t('workbenchEntry.showGitWorkbench'))}</a>
      <p id="launcher-destination" class="launcher-destination">${escape(translate(language, 'workbenchEntry.opensInLocation', { location: label(locations.default) }))}</p>
      <a class="launcher-settings" href="command:${workbenchLocationSettingsCommands[location]}">${escape(t('workbenchEntry.configureLocations'))}</a>
      <div class="launcher-window"><a href="command:alwaygit.openWorkbenchInNewWindow" aria-describedby="launcher-window-help">${escape(t('manifest.contributes.commands.item1.title'))}</a><p id="launcher-window-help">${escape(t('workbenchEntry.newWindowHelp'))}</p></div>
    </main>
    <div id="locations-root"></div>
    ${resources ? `<script nonce="${escape(resources.nonce)}" src="${escape(resources.script)}"></script>` : ''}
  </body></html>`;
}
