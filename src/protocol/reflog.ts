import { z } from 'zod';
export interface ReflogEntry { oid: string; selector: string; description: string; actor: string; email: string; date?: string }
export interface RecoveryRef { ref: string; oid: string }
export interface ReflogPage { token: string; ref: string; entries: ReflogEntry[]; recoveries: RecoveryRef[]; nextOffset: number; hasMore: boolean; truncated: boolean; checkedAt: number }
export const reflogQuerySchema = z.object({ ref: z.string().max(4096).default('HEAD'), token: z.string().uuid().optional(), offset: z.number().int().min(0).max(5000).default(0), limit: z.number().int().min(1).max(200).default(100) }).strict();
export type ReflogQuery = z.input<typeof reflogQuerySchema>;
