export const shortcutKeys = {
  refresh: 'r', fetch: 'f', pull: 'l', push: 'p', commit: 'c', stash: 's',
  working: 'w', head: 'h', repository: 'o', diff: 'd', edit: 'e',
  previousChange: '[', nextChange: ']', toggleDiff: '\\', search: '/',
  settings: ',', help: '?', stageAll: 'a', unstageAll: 'u',
} as const;
export type WorkbenchShortcut = keyof typeof shortcutKeys;
export interface ShortcutAction { enabled: boolean; run(): void }
export type ShortcutActions = Partial<Record<WorkbenchShortcut, ShortcutAction>>;
export interface ShortcutKeyEvent {
  key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean;
  repeat: boolean; isComposing: boolean; keyCode: number; defaultPrevented: boolean;
  preventDefault(): void; stopPropagation(): void;
}

export function shortcutCommand(event: Pick<ShortcutKeyEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, singleKeys: boolean): WorkbenchShortcut | undefined {
  if (event.altKey) return;
  if (event.ctrlKey || event.metaKey) return !event.shiftKey && event.key.toLowerCase() === 'r' ? 'refresh' : undefined;
  if (!singleKeys || event.shiftKey && event.key !== '?') return;
  return (Object.keys(shortcutKeys) as WorkbenchShortcut[]).find(command => shortcutKeys[command] === event.key.toLowerCase());
}

export function dispatchShortcut(event: ShortcutKeyEvent, actions: ShortcutActions, context: { singleKeys: boolean; blocked: boolean; editable: boolean; composing: boolean }): void {
  if (event.defaultPrevented || context.blocked || context.editable || context.composing || event.isComposing || event.keyCode === 229) return;
  const command = shortcutCommand(event, context.singleKeys), action = command && actions[command];
  if (!action) return;
  // Consume a recognized key even while disabled or held, especially Ctrl/Cmd+R.
  event.preventDefault(); event.stopPropagation();
  if (!event.repeat && action.enabled) action.run();
}

export function shortcutHint(command: WorkbenchShortcut, singleKeys: boolean): string | undefined {
  if (command === 'refresh') return singleKeys ? 'R · Ctrl/Cmd+R' : 'Ctrl/Cmd+R';
  if (!singleKeys) return;
  return command === 'help' ? '? (Shift+/)' : shortcutKeys[command].toUpperCase();
}
export function shortcutAria(command: WorkbenchShortcut, singleKeys: boolean): string | undefined {
  const key = command === 'help' ? 'Shift+/' : shortcutKeys[command];
  return command === 'refresh' ? `${singleKeys ? 'r ' : ''}Control+r Meta+r` : singleKeys ? key : undefined;
}
export function shortcutTitle(title: string | undefined, command: WorkbenchShortcut, singleKeys: boolean): string | undefined {
  const hint = shortcutHint(command, singleKeys);
  return hint ? `${title ? `${title} · ` : ''}${hint}` : title;
}
