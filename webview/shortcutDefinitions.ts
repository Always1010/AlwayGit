import type { StaticMessageKey } from './i18n';
import type { WorkbenchShortcut } from './shortcutKeys';
export const shortcutCategories = ['git', 'navigation', 'diff', 'terminal', 'general'] as const;
export type ShortcutCategory = typeof shortcutCategories[number];
export const shortcutCategoryLabels: Record<ShortcutCategory, StaticMessageKey> = {
  git: 'settings.shortcutGit', navigation: 'settings.shortcutNavigation', diff: 'settings.shortcutDiff', terminal: 'settings.shortcutTerminal', general: 'settings.shortcutGeneral',
};
export const shortcutDefinitions: Record<WorkbenchShortcut, { label: StaticMessageKey; category: ShortcutCategory; scope: StaticMessageKey }> = {
  refresh: { label: 'settings.shortcutRefresh', category: 'git', scope: 'settings.shortcutWorkbenchScope' },
  fetch: { label: 'settings.shortcutFetch', category: 'git', scope: 'settings.shortcutWorkbenchScope' },
  pull: { label: 'settings.shortcutPull', category: 'git', scope: 'settings.shortcutWorkbenchScope' },
  push: { label: 'settings.shortcutPush', category: 'git', scope: 'settings.shortcutWorkbenchScope' },
  commit: { label: 'settings.shortcutCommit', category: 'git', scope: 'settings.shortcutWorkbenchScope' },
  stash: { label: 'settings.shortcutStash', category: 'git', scope: 'settings.shortcutWorkbenchScope' },
  working: { label: 'settings.shortcutWorking', category: 'navigation', scope: 'settings.shortcutWorkbenchScope' },
  head: { label: 'settings.shortcutHead', category: 'navigation', scope: 'settings.shortcutWorkbenchScope' },
  repository: { label: 'settings.shortcutRepository', category: 'navigation', scope: 'settings.shortcutWorkbenchScope' },
  diff: { label: 'settings.shortcutOpenDiff', category: 'diff', scope: 'settings.shortcutDiffScope' },
  edit: { label: 'settings.shortcutEditFile', category: 'diff', scope: 'settings.shortcutDiffScope' },
  previousChange: { label: 'settings.shortcutPreviousChange', category: 'diff', scope: 'settings.shortcutDiffScope' },
  nextChange: { label: 'settings.shortcutNextChange', category: 'diff', scope: 'settings.shortcutDiffScope' },
  toggleDiff: { label: 'settings.shortcutToggleDiff', category: 'diff', scope: 'settings.shortcutDiffScope' },
  search: { label: 'settings.shortcutSearchHistory', category: 'navigation', scope: 'settings.shortcutWorkbenchScope' },
  settings: { label: 'settings.shortcutSettings', category: 'general', scope: 'settings.shortcutWorkbenchScope' },
  help: { label: 'settings.shortcutHelp', category: 'general', scope: 'settings.shortcutWorkbenchScope' },
  stageAll: { label: 'settings.shortcutStageAll', category: 'git', scope: 'settings.shortcutWorkingScope' },
  unstageAll: { label: 'settings.shortcutUnstageAll', category: 'git', scope: 'settings.shortcutWorkingScope' },
  terminalNew: { label: 'settings.shortcutTerminalNew', category: 'terminal', scope: 'settings.shortcutWorkbenchScope' },
  terminalFocus: { label: 'settings.shortcutTerminalFocus', category: 'terminal', scope: 'settings.shortcutWorkbenchScope' },
};
