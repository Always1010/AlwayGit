import { z } from 'zod';
import type { FileHistoryFilter } from './types';

const path = z.string().min(1).max(4096).refine(value => !value.includes('\0'));
export const fileHistorySchema = z.object({ path, revision: path.optional(), anchorPath: path.optional() }).strict();
export const fileHistoryKey = (file?: FileHistoryFilter) => JSON.stringify(file ? [file.path, file.revision, file.anchorPath] : null);
