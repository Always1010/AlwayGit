import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { dispatchShortcut, shortcutCommand, shortcutKeys, type ShortcutKeyEvent } from '../webview/shortcutKeys';

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
