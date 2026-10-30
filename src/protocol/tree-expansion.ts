import { z } from 'zod';

export type TreeExpansionMode = 'auto' | 'expanded' | 'collapsed';
export interface TreeExpansionPreferences {
  mode: TreeExpansionMode;
  overrides: Record<string, boolean>;
}
const mode = z.enum(['auto', 'expanded', 'collapsed']);
// Git paths are relative and use forward slashes. Do not normalize distinct Git names.
const directoryPath = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (path) =>
      !path.includes('\0') &&
      !path.startsWith('/') &&
      !path.split('/').some((part) => !part || part === '.' || part === '..'),
  );
export const treeExpansionPreferencesSchema = z
  .object({ mode, overrides: z.record(directoryPath, z.boolean()) })
  .strict();
export const treeExpansionPatchSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('directory'), path: directoryPath, expanded: z.boolean().nullable() })
    .strict(),
  z.object({ kind: z.literal('mode'), mode }).strict(),
]);
export type TreeExpansionPatch = z.infer<typeof treeExpansionPatchSchema>;
export const defaultTreeExpansion = (): TreeExpansionPreferences => ({
  mode: 'auto',
  overrides: {},
});
export function patchTreeExpansion(
  current: TreeExpansionPreferences,
  patch: TreeExpansionPatch,
): TreeExpansionPreferences {
  if (patch.kind === 'mode') return { mode: patch.mode, overrides: {} };
  const overrides = { ...current.overrides };
  if (patch.expanded === null) delete overrides[patch.path];
  else
    Object.defineProperty(overrides, patch.path, {
      value: patch.expanded,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  return { mode: current.mode, overrides };
}

/** Apply preferences only to directories. Historic virtual nodes share the real Git path. */
export function treeDirectoryExpanded(
  preferences: TreeExpansionPreferences,
  path: string,
  entryCount: number,
): boolean {
  if (Object.hasOwn(preferences.overrides, path)) return preferences.overrides[path];
  return (
    preferences.mode === 'expanded' ||
    (preferences.mode === 'auto' && (entryCount <= 5000 || !path.includes('/')))
  );
}
