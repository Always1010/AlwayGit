import { useEffect, useState } from 'react';
import type { LayoutState } from './rpc';
import type { Language } from './i18n';
import type { DiffNavigationScope } from '../src/protocol/session';
import { getGraphPalette, type GraphPaletteColors, type GraphPaletteId } from './graph/palettes';

export const themePreferences = ['system', 'light', 'paper', 'mist', 'dark', 'midnight', 'graphite', 'forest', 'berry', 'contrast'] as const;
export type ThemePreference = typeof themePreferences[number];
export type ResolvedTheme = Exclude<ThemePreference, 'system' | 'contrast'> | 'hc-light' | 'hc-dark';
export interface Appearance {
  theme: ThemePreference;
  palette: GraphPaletteId;
  codeFont: number;
  codeRowHeight: number;
  fileSpacing: number;
  badgeColor: string;
  currentBranchColor: string;
  currentRepositoryColor: string;
  colors: GraphPaletteColors;
  mainColors: { light: string; dark: string };
}
export interface InterfaceSettings { language: Language; font: number; row: number; appearance: Appearance; diffNavigationScope: DiffNavigationScope; singleKeyShortcuts: boolean }
export type InterfaceSettingsUpdate = Partial<Omit<InterfaceSettings, 'appearance'>> & { appearance?: Partial<Appearance> };
const hexColor = /^#[0-9a-f]{6}$/i;
const defaultMainColors = { light: '#283447', dark: '#EDF3FF' } as const;
export const defaultBadgeColor = '#D61F3C';
export const defaultCurrentBranchColor = '#2463C5';
export const defaultCurrentRepositoryColor = '#2463C5';

export function presetColors(id: GraphPaletteId): GraphPaletteColors {
  const palette = getGraphPalette(id);
  return { light: [...palette.light], dark: [...palette.dark] };
}

export const defaultAppearance: Appearance = {
  theme: 'system', palette: 'vivid', codeFont: 12, codeRowHeight: 18, fileSpacing: 1, badgeColor: defaultBadgeColor, currentBranchColor: defaultCurrentBranchColor, currentRepositoryColor: defaultCurrentRepositoryColor, colors: presetColors('vivid'), mainColors: { ...defaultMainColors },
};

function normalizeColors(value: Partial<GraphPaletteColors> | undefined, palette: GraphPaletteId): GraphPaletteColors {
  const fallback = presetColors(palette), light = value?.light, dark = value?.dark;
  if (!Array.isArray(light) || !Array.isArray(dark) || light.length !== dark.length || light.length < 4 || light.length > 16) return fallback;
  if (![...light, ...dark].every(color => typeof color === 'string' && hexColor.test(color))) return fallback;
  return { light: light.map(color => color.toUpperCase()), dark: dark.map(color => color.toUpperCase()) };
}

export function normalizeAppearance(value: Partial<Appearance> = {}): Appearance {
  const palette = ['vivid', 'distinct', 'extended'].includes(value.palette ?? '') ? value.palette! : 'vivid';
  return {
    theme: themePreferences.includes(value.theme as ThemePreference) ? value.theme! : 'system',
    palette,
    codeFont: Number.isFinite(value.codeFont) ? Math.round(Math.max(11, Math.min(18, value.codeFont!))) : 12,
    codeRowHeight: Number.isFinite(value.codeRowHeight) ? Math.round(Math.max(16, Math.min(36, value.codeRowHeight!))) : 18,
    fileSpacing: Number.isFinite(value.fileSpacing) ? Math.round(Math.max(0, Math.min(8, value.fileSpacing!))) : 1,
    badgeColor: hexColor.test(value.badgeColor ?? '') ? value.badgeColor!.toUpperCase() : defaultBadgeColor,
    currentBranchColor: hexColor.test(value.currentBranchColor ?? '') ? value.currentBranchColor!.toUpperCase() : defaultCurrentBranchColor,
    currentRepositoryColor: hexColor.test(value.currentRepositoryColor ?? '') ? value.currentRepositoryColor!.toUpperCase() : defaultCurrentRepositoryColor,
    colors: normalizeColors(value.colors, palette),
    mainColors: {
      light: hexColor.test(value.mainColors?.light ?? '') ? value.mainColors!.light.toUpperCase() : defaultMainColors.light,
      dark: hexColor.test(value.mainColors?.dark ?? '') ? value.mainColors!.dark.toUpperCase() : defaultMainColors.dark,
    },
  };
}
export const effectiveRowHeight = (layout: Pick<LayoutState, 'font' | 'row'>) => Math.max(layout.row, Math.round(layout.font * 1.35) + 6);
export const diffRowHeight = (font: number, row = 18) => Math.max(row, font + 4);
export const fileRowHeight = (font: number, spacing: number) => Math.ceil((font + 11) * 1.2) + spacing * 2 + 1;
export const isLightTheme = (theme: ResolvedTheme) => ['light', 'paper', 'mist', 'hc-light'].includes(theme);
export function textColorForBackground(hex: string): '#000000' | '#FFFFFF' {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? '#000000' : '#FFFFFF';
}

function hostTheme(): ResolvedTheme {
  const kind = document.body.dataset.vscodeThemeKind;
  if (kind === 'vscode-high-contrast-light' || document.body.classList.contains('vscode-high-contrast-light')) return 'hc-light';
  if (kind === 'vscode-high-contrast' || document.body.classList.contains('vscode-high-contrast')) return 'hc-dark';
  if (kind === 'vscode-light' || document.body.classList.contains('vscode-light')) return 'light';
  if (kind === 'vscode-dark' || document.body.classList.contains('vscode-dark')) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
export function useResolvedTheme(preference: ThemePreference): ResolvedTheme {
  const [host, setHost] = useState(hostTheme);
  useEffect(() => {
    const update = () => setHost(hostTheme());
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-kind'] });
    const media = window.matchMedia('(prefers-color-scheme: light)');
    media.addEventListener('change', update);
    return () => { observer.disconnect(); media.removeEventListener('change', update); };
  }, []);
  if (preference === 'system') return host;
  if (preference === 'contrast') return host.includes('light') ? 'hc-light' : 'hc-dark';
  return preference;
}
