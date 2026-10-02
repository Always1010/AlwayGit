import type { WorkbenchPresence } from './workbench';

export interface StatusBarPresentation { visible: boolean; tooltip: string }

export function statusBarPresentation(presence: WorkbenchPresence): StatusBarPresentation {
  return { visible: true, tooltip: presence.open ? 'Show AlwayGit Workbench' : 'Open AlwayGit Workbench' };
}

export function panelSession(saved: Record<string, unknown>, repositoryId?: string, blank = false): Record<string, unknown> {
  const next = { ...saved };
  if (blank) delete next.repoId;
  else if (repositoryId) next.repoId = repositoryId;
  return next;
}
