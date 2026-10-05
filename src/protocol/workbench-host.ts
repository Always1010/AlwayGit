import { z } from 'zod';
import { sessionSchema } from './session';
import { diffSchema } from './validation';

export type WorkbenchLocation = 'editor' | 'sidebar' | 'panel';
/** The old injected docked name remains readable by restored and demo hosts. */
export type WorkbenchOpenMode = WorkbenchLocation | 'docked';
export const workbenchLocationsSchema = z.object({
  enabled: z.array(z.enum(['editor', 'sidebar', 'panel'])).min(1).max(3),
  default: z.enum(['editor', 'sidebar', 'panel']),
});
export type WorkbenchLocations = z.infer<typeof workbenchLocationsSchema>;
/** Writes must be valid as a whole; legacy reads remain tolerant. */
export const saveWorkbenchLocationsSchema = workbenchLocationsSchema.strict()
  .refine(value => new Set(value.enabled).size === value.enabled.length && value.enabled.includes(value.default));
export function readWorkbenchLocations(value: unknown, legacy: unknown = 'editor'): { enabled: WorkbenchLocation[]; default: WorkbenchLocation } {
  const parsed = workbenchLocationsSchema.safeParse(value);
  if (!parsed.success) return legacy === 'docked' ? { enabled: ['editor', 'sidebar'], default: 'sidebar' } : { enabled: ['editor'], default: 'editor' };
  const enabled = [...new Set(parsed.data.enabled)];
  return { enabled, default: enabled.includes(parsed.data.default) ? parsed.data.default : enabled[0] };
}
/** Transient state crosses hosts without changing the saved-session format. */
export const workbenchTransferSchema = z.object({
  session: sessionSchema,
  workingFilters: z.record(z.string().max(128), z.string().max(1000)).optional(),
  activeTerminal: z.union([z.literal('diff'), z.string().uuid()]).optional(),
  selectedOids: z.array(z.string().min(1).max(4096)).max(10000).optional(),
  comparison: z.object({ left: z.string().min(1).max(4096), right: z.string().min(1).max(4096) }).optional(),
  diffTarget: diffSchema.optional(),
});
export const captureWorkbenchSchema = workbenchTransferSchema.extend({ token: z.string().min(1).max(128), busy: z.boolean().optional() }).strict();
export type WorkbenchTransfer = z.infer<typeof workbenchTransferSchema>;
