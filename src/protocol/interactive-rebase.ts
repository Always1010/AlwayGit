import { z } from 'zod';
export const rebaseStepSchema = z.object({ oid: z.string().regex(/^[a-f0-9]{40,64}$/), action: z.enum(['pick','reword','squash','fixup','drop']), message: z.string().max(100000).refine(value=>!value.includes('\0')).optional() }).strict();
export type RebaseStep = z.infer<typeof rebaseStepSchema>;
export const interactiveRebaseSchema = z.object({ type: z.literal('rebase.interactive'), token: z.string().uuid(), steps: z.array(rebaseStepSchema).min(1).max(500), acknowledgePublished: z.boolean().default(false) }).strict();
export type InteractiveRebaseAction = z.infer<typeof interactiveRebaseSchema>;
export const prepareRebaseSchema = z.object({ start: z.string().regex(/^[a-f0-9]{40,64}$/).optional() }).strict();
export interface RebasePlan { token: string; branch: string; head: string; base: string; expires: number; commits: { oid: string; subject: string; message: string }[]; published: string[] }
export interface ManagedRebaseState { backupRef: string; step: number; total: number; stoppedOid?: string; applied?: boolean; pause: 'conflict' | 'empty' | 'review' | 'unavailable'; }
