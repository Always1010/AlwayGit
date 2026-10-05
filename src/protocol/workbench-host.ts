import { z } from 'zod';
import { sessionSchema } from './session';
import { diffSchema } from './validation';

export type WorkbenchOpenMode = 'editor' | 'docked';
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
