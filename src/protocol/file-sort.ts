import { z } from 'zod';

export const fileSortSchema = z
  .object({
    key: z.enum(['name', 'path', 'extension', 'status']),
    direction: z.enum(['asc', 'desc']),
  })
  .strict();

export type FileSort = z.infer<typeof fileSortSchema>;

export const defaultFileSort: FileSort = { key: 'name', direction: 'asc' };
