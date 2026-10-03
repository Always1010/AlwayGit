import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { dispatchShortcut, shortcutCommand, shortcutKeys, bindingFromEvent, bindingConflicts, normalizeShortcutOverrides, shortcutOverridesSchema, shortcutHint, shortcutAria, type ShortcutKeyEvent } from '../webview/shortcutKeys';

const event = (override: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({ key: 'f', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, keyCode: 70, defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...override });
const context = { singleKeys: true, blocked: false, editable: false, composing: false };

describe('workbench shortcut safety', () => {
  it('provides a non-conflicting VS Code shortcut for creating an embedded terminal', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { contributes: { keybindings: Array<{ command: string; key: string; mac?: string }> } };
    expect(manifest.contributes.keybindings).toContainEqual({ command: 'alwaygit.newTerminal', key: 'ctrl+alt+shift+t', mac: 'cmd+alt+shift+t' });
  });

  it('does not execute Git actions during editing, composition, overlays, repeats or disabled states', () => {
    for (const blocked of [{editable:true},{blocked:true},{composing:true},{singleKeys:false}]) {
      const run=vi.fn(),key=event();dispatchShortcut(key,{fetch:{enabled:true,run}},{...context,...blocked});
      expect(run).not.toHaveBeenCalled();expect(key.preventDefault).not.toHaveBeenCalled();
    }
    for (const override of [{isComposing:true},{keyCode:229},{repeat:true},{defaultPrevented:true}]) {
      const run=vi.fn();dispatchShortcut(event(override),{fetch:{enabled:true,run}},context);expect(run).not.toHaveBeenCalled();
    }
    const run=vi.fn(),key=event({key:'r',ctrlKey:true});dispatchShortcut(key,{refresh:{enabled:false,run}},context);
    expect(run).not.toHaveBeenCalled();expect(key.preventDefault).toHaveBeenCalledOnce();
  });

  it('resolves single keys without stealing selection shortcuts or modified keys', () => {
    expect(new Set(Object.values(shortcutKeys)).size).toBe(Object.keys(shortcutKeys).length);
    expect(shortcutCommand(event({key:'F'}),true)).toBe('fetch');
    expect(shortcutCommand(event({key:'N'}),true)).toBe('terminalNew');
    expect(shortcutCommand(event({key:'T'}),true)).toBe('terminalFocus');
    expect(shortcutCommand(event({key:'?',shiftKey:true}),true)).toBe('help');
    for(const modifiers of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{ctrlKey:true,altKey:true}]) {
      expect(shortcutCommand(event({key:'a',...modifiers}),true)).toBeUndefined();
    }
    for(const modifiers of [{ctrlKey:true},{metaKey:true}])expect(shortcutCommand(event({key:'r',...modifiers}),false)).toBe('refresh');
    expect(shortcutCommand(event({key:'r',ctrlKey:true,shiftKey:true}),true)).toBeUndefined();
    const run=vi.fn(),key=event();dispatchShortcut(key,{fetch:{enabled:true,run}},context);
    expect(run).toHaveBeenCalledOnce();expect(key.preventDefault).toHaveBeenCalledOnce();expect(key.stopPropagation).toHaveBeenCalledOnce();
  });
});


describe('custom workbench bindings', () => {
  it('replaces defaults, supports a portable combination and disables an action', () => {
    const overrides = shortcutOverridesSchema.parse({ fetch: [{ key: 'f', modifiers: ['primary', 'shift'] }], push: [] });
    expect(shortcutCommand(event(), true, overrides)).toBeUndefined();
    expect(shortcutCommand(event({ key: 'F', ctrlKey: true, shiftKey: true }), false, overrides, false)).toBe('fetch');
    expect(shortcutCommand(event({ key: 'F', metaKey: true, shiftKey: true }), false, overrides, true)).toBe('fetch');
    expect(shortcutCommand(event({ key: 'p' }), true, overrides)).toBeUndefined();
    expect(shortcutHint('fetch', false, overrides)).toBe('Ctrl/Cmd+Shift+F');
    expect(shortcutAria('fetch', false, overrides)).toMatch(/^(Control|Meta)\+Shift\+f$/);
    expect(shortcutHint('push', true, overrides)).toBeUndefined();
    expect(shortcutCommand(event(), true, {})).toBe('fetch');
  });
  it('rejects collisions with defaults, platform aliases, duplicate keys and reserved interactions', () => {
    expect(bindingConflicts({ key: 'p', modifiers: [] }, {}, 'fetch')).toEqual(['push']);
    for (const overrides of [
      { fetch: [{ key: 'p', modifiers: [] }] },
      { fetch: [{ key: 'r', modifiers: ['control'] }] },
      { fetch: [{ key: 'f', modifiers: [] }, { key: 'f', modifiers: [] }] },
      { fetch: [{ key: 'a', modifiers: ['primary'] }] },
      { fetch: [{ key: 'c', modifiers: ['primary'] }] },
      { fetch: [{ key: 'v', modifiers: ['control', 'shift'] }] },
      { fetch: [{ key: 'enter', modifiers: ['primary'] }] },
      { fetch: [{ key: 'f10', modifiers: ['shift'] }] },
      { fetch: [{ key: 'f', modifiers: ['primary', 'control'] }] },
      { unknown: [] },
    ]) expect(shortcutOverridesSchema.safeParse(overrides).success).toBe(false);
    expect(normalizeShortcutOverrides({ fetch: [{ key: 'Escape', modifiers: [] }] })).toEqual({});
  });
  it('normalizes shifted punctuation and preserves input, IME and unavailable-action protection', () => {
    expect(bindingFromEvent(event({ key: '?', shiftKey: true }))).toEqual({ key: '/', modifiers: ['shift'] });
    expect(shortcutCommand(event({ key: '?' }), true)).toBe('help');
    expect(bindingFromEvent(event({ ctrlKey: true, metaKey: true }), true, false)).toEqual({ key: 'f', modifiers: ['control', 'meta'] });
    expect(bindingFromEvent(event({ key: '|', shiftKey: true }))).toEqual({ key: '\\', modifiers: ['shift'] });
    expect(bindingFromEvent(event({ key: 'Dead' }))).toBeUndefined();
    expect(bindingFromEvent(event({ getModifierState: key => key === 'AltGraph' }))).toBeUndefined();
    const overrides = { fetch: [{ key: 'f', modifiers: ['primary' as const, 'shift' as const] }] };
    for (const protection of [{ editable: true }, { blocked: true }, { composing: true }]) {
      const run = vi.fn(), key = event({ ctrlKey: true, shiftKey: true });
      dispatchShortcut(key, { fetch: { enabled: true, run } }, { ...context, ...protection, overrides, mac: false });
      expect(run).not.toHaveBeenCalled(); expect(key.preventDefault).not.toHaveBeenCalled();
    }
    const run = vi.fn(), key = event({ ctrlKey: true, shiftKey: true });
    dispatchShortcut(key, { fetch: { enabled: false, run } }, { ...context, overrides, mac: false });
    expect(run).not.toHaveBeenCalled(); expect(key.preventDefault).toHaveBeenCalledOnce();
  });
});
