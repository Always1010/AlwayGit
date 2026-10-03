import { describe, expect, it } from 'vitest';
import { terminalMinimumContrastRatio, terminalTheme } from '../webview/terminal-theme';
import type { ResolvedTheme } from '../webview/appearance';

function contrast(first: string, second: string): number {
  const luminance = (hex: string) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}
describe('terminal theme readability', () => {
  it('provides readable normal and bright ANSI colors for every light preset', () => {
    for (const [theme, background] of [['light', '#ffffff'], ['paper', '#fff9ed'], ['mist', '#f3f8fc'], ['hc-light', '#ffffff']] as const) {
      const colors = terminalTheme(theme, background, '#292929');
      const ansi = Object.entries(colors).filter(([key]) => /^(?:bright)?(?:Black|Red|Green|Yellow|Blue|Magenta|Cyan|White)$/i.test(key));
      expect(ansi).toHaveLength(16);
      for (const [key, color] of ansi) expect(contrast(color!, background), `${theme}: ${key}`).toBeGreaterThanOrEqual(4.5);
      expect(colors.foreground).toBe('#292929'); expect(colors.cursorAccent).toBe(background);
    }
  });
  it('uses a dark palette without overriding resolved host colors, with contrast protection', () => {
    for (const theme of ['dark', 'midnight', 'graphite', 'forest', 'berry', 'hc-dark'] as ResolvedTheme[]) {
      const colors = terminalTheme(theme, '#171b22', '#e7edf6');
      expect(colors.background).toBe('#171b22'); expect(colors.foreground).toBe('#e7edf6');
      for (const key of ['yellow', 'brightYellow', 'green', 'cyan'] as const) expect(contrast(colors[key]!, '#171b22')).toBeGreaterThanOrEqual(4.5);
      expect(colors.yellow).not.toBe(terminalTheme('light', '', '').yellow);
    }
    expect(terminalMinimumContrastRatio).toBe(4.5);
    expect(terminalTheme('hc-light', '', '').selectionForeground).toBe('#ffffff');
    expect(terminalTheme('hc-dark', '', '').selectionForeground).toBe('#000000');
  });
});
