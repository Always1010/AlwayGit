import { z } from 'zod';
export interface ConflictVersion { oid: string; mode: string; size: number }
export interface ConflictDetails {
  token: string; path: string; status: string; operation?: string; head?: string; incoming?: string;
  base?: ConflictVersion; ours?: ConflictVersion; theirs?: ConflictVersion;
  canMerge: boolean; canChoose: boolean; canEdit: boolean;
}
export const conflictPathSchema = z.object({path:z.string().min(1).max(4096)}).strict();
export const conflictChoiceSchema = z.object({type:z.literal('conflict.choose'),token:z.string().uuid(),side:z.enum(['ours','theirs'])}).strict();
