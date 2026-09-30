import { useEffect, useState } from 'react';
import type { LayoutState } from './rpc';
import type { Language } from './i18n';
import type { GraphPaletteId } from './graph/palettes';

export type ThemePreference = 'system' | 'light' | 'dark' | 'contrast';
export type ResolvedTheme = 'light' | 'dark' | 'hc-light' | 'hc-dark';
export interface Appearance { theme: ThemePreference; palette: GraphPaletteId; codeFont: number }
export interface InterfaceSettings { language: Language; font: number; row: number; appearance: Appearance }
export const defaultAppearance: Appearance = { theme: 'system', palette: 'vivid', codeFont: 12 };
export function normalizeAppearance(value: Partial<Appearance> = {}): Appearance {
  return {
    theme: ['system', 'light', 'dark', 'contrast'].includes(value.theme ?? '') ? value.theme! : 'system',
    palette: ['vivid', 'distinct', 'extended'].includes(value.palette ?? '') ? value.palette! : 'vivid',
    codeFont: Number.isFinite(value.codeFont) ? Math.round(Math.max(11, Math.min(18, value.codeFont!))) : 12,
  };
}
export const effectiveRowHeight = (layout: Pick<LayoutState, 'font' | 'row'>) => Math.max(layout.row, Math.round(layout.font * 1.35) + 6);
export const diffRowHeight = (font: number) => Math.max(22, Math.round(font * 1.6) + 3);

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
