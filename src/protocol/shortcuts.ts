import { z } from 'zod';

export const shortcutKeys = {
  refresh: 'r', fetch: 'f', pull: 'l', push: 'p', commit: 'c', stash: 's',
  working: 'w', head: 'h', repository: 'o', diff: 'd', edit: 'e',
  previousChange: '[', nextChange: ']', toggleDiff: '\\', search: '/',
  settings: ',', help: '?', stageAll: 'a', unstageAll: 'u',
  terminalNew: 'n', terminalFocus: 't',
} as const;
export type WorkbenchShortcut = keyof typeof shortcutKeys;
export const shortcutCommands = Object.keys(shortcutKeys) as WorkbenchShortcut[];
export const shortcutModifiers = ['primary', 'control', 'meta', 'alt', 'shift'] as const;
export type ShortcutModifier = typeof shortcutModifiers[number];
export interface ShortcutBinding { key: string; modifiers: ShortcutModifier[] }
export type ShortcutOverrides = Partial<Record<WorkbenchShortcut, ShortcutBinding[]>>;

export function defaultBindings(command: WorkbenchShortcut): ShortcutBinding[] {
  if (command === 'refresh') return [{ key: 'r', modifiers: [] }, { key: 'r', modifiers: ['primary'] }];
  if (command === 'help') return [{ key: '/', modifiers: ['shift'] }];
  return [{ key: shortcutKeys[command], modifiers: [] }];
}
export function effectiveBindings(command: WorkbenchShortcut, overrides: ShortcutOverrides = {}): ShortcutBinding[] {
  return overrides[command] ?? defaultBindings(command);
}
export function singleKey(binding: ShortcutBinding): boolean {
  return !binding.modifiers.length || binding.key.length === 1 && binding.modifiers.every(modifier => modifier === 'shift');
}
export function bindingSignature(binding: ShortcutBinding, mac: boolean): string {
  const modifiers = binding.modifiers.map(modifier => modifier === 'primary' ? mac ? 'meta' : 'control' : modifier);
  return `${[...new Set(modifiers)].sort().join('+')}:${binding.key}`;
}
export function bindingsOverlap(left: ShortcutBinding, right: ShortcutBinding): boolean {
  return [false, true].some(mac => bindingSignature(left, mac) === bindingSignature(right, mac));
}
export function bindingConflicts(binding: ShortcutBinding, overrides: ShortcutOverrides, except?: WorkbenchShortcut): WorkbenchShortcut[] {
  return shortcutCommands.filter(command => command !== except && effectiveBindings(command, overrides).some(other => bindingsOverlap(binding, other)));
}
export function reservedBinding(binding: ShortcutBinding): boolean {
  // Basic navigation/editing remains owned by the focused control and selection layer.
  if (!/^(?:[a-z0-9]|[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]|f(?:[1-9]|1[0-2]))$/.test(binding.key)) return true;
  if (binding.key === 'f10' && binding.modifiers.includes('shift')) return true;
  return [false, true].some(mac => {
    const signature = bindingSignature(binding, mac);
    return ['control', 'meta'].some(modifier =>
      ['a', 'c', 'v', 'x', 'z', 'y'].some(key => signature === `${modifier}:${key}`) ||
      ['c', 'v', 'z', 'y'].some(key => signature === `${modifier}+shift:${key}`));
  });
}
const bindingSchema = z.object({
  key: z.string().max(3), modifiers: z.array(z.enum(shortcutModifiers)).max(4),
}).strict().refine(binding => new Set(binding.modifiers).size === binding.modifiers.length &&
  !(binding.modifiers.includes('primary') && (binding.modifiers.includes('control') || binding.modifiers.includes('meta'))) &&
  !reservedBinding(binding));
export const shortcutOverridesSchema = z.partialRecord(z.enum(shortcutCommands as [WorkbenchShortcut, ...WorkbenchShortcut[]]), z.array(bindingSchema).max(2))
  .refine(overrides => shortcutCommands.every(command => {
    const bindings = effectiveBindings(command, overrides);
    return bindings.every((binding, index) => !bindings.slice(index + 1).some(other => bindingsOverlap(binding, other)) && !bindingConflicts(binding, overrides, command).length);
  }));
export function normalizeShortcutOverrides(value: unknown): ShortcutOverrides {
  const parsed = shortcutOverridesSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}
