export interface SelectionKeyModifiers {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type SelectionKeyboardCommand = 'all' | 'clear';

export function selectionKeyboardCommand(key: string, modifiers: SelectionKeyModifiers, editable: boolean): SelectionKeyboardCommand | undefined {
  if (editable) return;
  if (key === 'Escape') return 'clear';
  if (key.toLowerCase() === 'a' && (modifiers.ctrlKey || modifiers.metaKey) && !modifiers.altKey && !modifiers.shiftKey) return 'all';
}

export function selectionTargetIsEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const input = target.closest('input');
  return !!target.closest('textarea,[contenteditable]:not([contenteditable="false"])') || !!input && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(input.type);
}

export function handleSelectionKeyboard(event: SelectionKeyModifiers & { key: string; target: EventTarget | null; preventDefault(): void; stopPropagation(): void }, selectAll: () => void, clear: () => void): boolean {
  const command = selectionKeyboardCommand(event.key, event, selectionTargetIsEditable(event.target));
  if (!command) return false;
  event.preventDefault();
  event.stopPropagation();
  if (command === 'all') selectAll();
  else clear();
  return true;
}
