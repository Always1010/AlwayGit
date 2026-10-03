import { z } from 'zod';
import { sessionSchema, type SessionState, type LayoutState } from './session';

export const defaultLayout: LayoutState = { preset: 'workbench', sidebar: 210, details: 300, diff: 220, diffCollapsed: false, graph: 64, author: 100, date: 120, font: 13, row: 24 };
export const interfaceSettingsSchema = z.object({
  language: z.enum(['en', 'zh-CN']).optional(),
  font: sessionSchema.shape.layout.unwrap().shape.font.optional(),
  row: sessionSchema.shape.layout.unwrap().shape.row.optional(),
  appearance: sessionSchema.shape.appearance,
  changeListMode: sessionSchema.shape.changeListMode,
  diffNavigationScope: sessionSchema.shape.diffNavigationScope,
  singleKeyShortcuts: sessionSchema.shape.singleKeyShortcuts,
  shortcutOverrides: sessionSchema.shape.shortcutOverrides,
}).strict();
export const interfaceSettingsUpdateSchema = interfaceSettingsSchema.extend({ appearance: sessionSchema.shape.appearance.unwrap().partial().optional() });
export type InterfacePreferences = z.infer<typeof interfaceSettingsSchema>;
export type InterfacePreferencesUpdate = z.infer<typeof interfaceSettingsUpdateSchema>;

/** Read only preference fields from a legacy session, without migrating browsing state. */
export function legacyInterfaceSettings(session: SessionState): InterfacePreferences {
  const values: Record<string, unknown> = { ...session, font: session.layout?.font, row: session.layout?.row };
  if (!session.appearance && values.row === 26) values.row = 24;
  const result: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(interfaceSettingsSchema.shape)) {
    if (values[key] === undefined) continue;
    const parsed = schema.safeParse(values[key]);
    if (parsed.success) result[key] = parsed.data;
  }
  return interfaceSettingsSchema.parse(result);
}

/** A restored panel keeps its geometry and drafts, but never overrides user preferences. */
export function overlayInterfaceSettings(session: SessionState, settings: InterfacePreferences): SessionState {
  return { ...session, language: settings.language ?? 'en', appearance: settings.appearance,
    changeListMode: settings.changeListMode ?? 'split', diffNavigationScope: settings.diffNavigationScope ?? 'commit',
    singleKeyShortcuts: settings.singleKeyShortcuts ?? true, shortcutOverrides: settings.shortcutOverrides ?? {},
    layout: { ...defaultLayout, ...session.layout, font: settings.font ?? 13, row: settings.row ?? 24 } };
}

export function mergeInterfaceSettings(current: InterfacePreferences, update: InterfacePreferencesUpdate): InterfacePreferences {
  return interfaceSettingsSchema.parse({ ...current, ...update,
    ...(update.appearance ? { appearance: { theme: 'system', palette: 'vivid', codeFont: 12, ...current.appearance, ...update.appearance } } : {}) });
}
