import { translate, type Language } from '../i18n/index';
import type { WorkbenchPresence } from './workbench';

export interface StatusBarPresentation { visible: boolean; tooltip: string }

export function statusBarPresentation(presence: WorkbenchPresence, language: Language = 'en'): StatusBarPresentation {
  return { visible: true, tooltip: presence.open ? translate(language, "workbenchEntry.showAlwayGitWorkbench") : translate(language, "workbenchEntry.openAlwayGitWorkbench") };
}

export function panelSession(saved: Record<string, unknown>, repositoryId?: string, blank = false): Record<string, unknown> {
  const next = { ...saved };
  if (blank) delete next.repoId;
  else if (repositoryId) next.repoId = repositoryId;
  return next;
}
