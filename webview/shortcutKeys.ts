import { bindingSignature, effectiveBindings, shortcutCommands, singleKey, type ShortcutBinding, type ShortcutModifier, type ShortcutOverrides, type WorkbenchShortcut } from '../src/protocol/shortcuts';
export * from '../src/protocol/shortcuts';
export interface ShortcutAction { enabled: boolean; run(): void }
export type ShortcutActions = Partial<Record<WorkbenchShortcut, ShortcutAction>>;
export interface ShortcutKeyEvent {
  key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean;
  repeat: boolean; isComposing: boolean; keyCode: number; defaultPrevented: boolean;
  getModifierState?(key: string): boolean;
  preventDefault(): void; stopPropagation(): void;
}
type KeyInput = Pick<ShortcutKeyEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'getModifierState'>;
export function isMac(): boolean { return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform); }
const shiftedSymbols = '~!@#$%^&*()_+{}|:"<>?';
const baseSymbols = '`1234567890-=[]\\;\',./';
export function bindingFromEvent(event: KeyInput, portable = false, mac = isMac()): ShortcutBinding | undefined {
  if (event.getModifierState?.('AltGraph') || ['Control', 'Meta', 'Alt', 'Shift', 'Dead', 'Process', 'Unidentified'].includes(event.key)) return;
  let key = event.key.toLowerCase();
  const index = key.length === 1 ? shiftedSymbols.indexOf(key) : -1;
  if (index >= 0) key = baseSymbols[index];
  const modifiers: ShortcutModifier[] = [];
  if (event.ctrlKey) modifiers.push(portable && !mac && !event.metaKey ? 'primary' : 'control');
  if (event.metaKey) modifiers.push(portable && mac && !event.ctrlKey ? 'primary' : 'meta');
  if (event.altKey) modifiers.push('alt');
  if (event.shiftKey || index >= 0) modifiers.push('shift');
  return { key, modifiers };
}
export function shortcutCommand(event: KeyInput, singleKeys: boolean, overrides: ShortcutOverrides = {}, mac = isMac()): WorkbenchShortcut | undefined {
  const binding = bindingFromEvent(event, false, mac);
  if (!binding) return;
  return shortcutCommands.find(command => effectiveBindings(command, overrides).some(candidate =>
    (singleKeys || !singleKey(candidate)) && (bindingSignature(candidate, mac) === bindingSignature(binding, mac) ||
      command === 'refresh' && overrides.refresh === undefined && candidate.modifiers.includes('primary') && ['control:r', 'meta:r'].includes(bindingSignature(binding, mac)))));
}
export function dispatchShortcut(event: ShortcutKeyEvent, actions: ShortcutActions, context: { singleKeys: boolean; blocked: boolean; editable: boolean; composing: boolean; overrides?: ShortcutOverrides; mac?: boolean }): void {
  if (event.defaultPrevented || context.blocked || context.editable || context.composing || event.isComposing || event.keyCode === 229) return;
  const command = shortcutCommand(event, context.singleKeys, context.overrides, context.mac), action = command && actions[command];
  if (!action) return;
  event.preventDefault(); event.stopPropagation();
  if (!event.repeat && action.enabled) action.run();
}
export function bindingLabel(binding: ShortcutBinding): string {
  const names: Record<ShortcutModifier, string> = { primary: 'Ctrl/Cmd', control: 'Ctrl', meta: 'Cmd', alt: 'Alt', shift: 'Shift' };
  return [...binding.modifiers.map(modifier => names[modifier]), binding.key.toUpperCase()].join('+');
}
export function shortcutHint(command: WorkbenchShortcut, singleKeys: boolean, overrides: ShortcutOverrides = {}): string | undefined {
  const hints = effectiveBindings(command, overrides).filter(binding => singleKeys || !singleKey(binding)).map(bindingLabel);
  return hints.length ? hints.join(' · ') : undefined;
}
export function shortcutAria(command: WorkbenchShortcut, singleKeys: boolean, overrides: ShortcutOverrides = {}): string | undefined {
  const names: Record<ShortcutModifier, string> = { primary: isMac() ? 'Meta' : 'Control', control: 'Control', meta: 'Meta', alt: 'Alt', shift: 'Shift' };
  const hints = effectiveBindings(command, overrides).filter(binding => singleKeys || !singleKey(binding)).map(binding => [...binding.modifiers.map(modifier => names[modifier]), binding.key].join('+'));
  return hints.length ? hints.join(' ') : undefined;
}
export function shortcutTitle(title: string | undefined, command: WorkbenchShortcut, singleKeys: boolean, overrides: ShortcutOverrides = {}): string | undefined {
  const hint = shortcutHint(command, singleKeys, overrides);
  return hint ? `${title ? `${title} · ` : ''}${hint}` : title;
}
