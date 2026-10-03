import type { ITheme } from '@xterm/xterm';
import { isLightTheme, type ResolvedTheme } from './appearance';

const lightColors = {
  black: '#1f2328', red: '#a1260d', green: '#26713f', yellow: '#805500',
  blue: '#1f4fa3', magenta: '#8b2f87', cyan: '#006870', white: '#525252',
  brightBlack: '#606060', brightRed: '#b52a1d', brightGreen: '#207132', brightYellow: '#8a6100',
  brightBlue: '#2458b0', brightMagenta: '#923597', brightCyan: '#006e78', brightWhite: '#696969',
};
const darkColors = {
  black: '#20242c', red: '#f08080', green: '#87c59c', yellow: '#e5c07b',
  blue: '#84b4ee', magenta: '#cc9bd8', cyan: '#75c9d1', white: '#d4dbe5',
  brightBlack: '#929eaf', brightRed: '#ff9b9b', brightGreen: '#a1dfad', brightYellow: '#f2d99a',
  brightBlue: '#a2caff', brightMagenta: '#e0b4ed', brightCyan: '#9ae1e5', brightWhite: '#ffffff',
};
export const terminalMinimumContrastRatio = 4.5;

/** ANSI colors are theme-dependent too: changing foreground alone leaves shell colors unreadable. */
export function terminalTheme(theme: ResolvedTheme, background: string, foreground: string): ITheme {
  const light = isLightTheme(theme), highContrast = theme.startsWith('hc-');
  const bg = background || (light ? '#ffffff' : '#171b22'), fg = foreground || (light ? '#292929' : '#e7edf6');
  return {
    ...(light ? lightColors : darkColors), background: bg, foreground: fg, cursor: fg, cursorAccent: bg,
    selectionBackground: highContrast ? light ? '#1f4fa3' : '#ffffff' : light ? '#225fa740' : '#84b4ee55',
    selectionForeground: highContrast ? light ? '#ffffff' : '#000000' : undefined,
  };
}
