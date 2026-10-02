import type { WorkbenchPresence } from './workbench';

export interface StatusBarPresentation { visible: boolean; tooltip: string }

export function statusBarPresentation(presence: WorkbenchPresence): StatusBarPresentation {
  return { visible: !presence.active, tooltip: presence.open ? 'Show AlwayGit Workbench' : 'Open AlwayGit Workbench' };
}
