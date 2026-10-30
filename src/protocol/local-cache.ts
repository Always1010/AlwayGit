import { z } from 'zod';
import type { TreeExpansionMode } from './tree-expansion';

/** Actual local records; missing metadata is displayed using repoId, never guessed. */
export interface LocalCacheEntry {
  repoId: string;
  name?: string;
  root?: string;
  registered: boolean;
  /** Repository discovery has not completed; false registered is not evidence of removal. */
  registrationUnknown?: boolean;
  directories: number;
  mode: TreeExpansionMode;
  invalid?: boolean;
}
export const localCacheClearSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('repositories'), repoIds: z.array(z.string().min(1).max(4096)).min(1).max(10000) }).strict(),
  z.object({ kind: z.literal('all') }).strict(),
]);
export type LocalCacheClear = z.infer<typeof localCacheClearSchema>;
