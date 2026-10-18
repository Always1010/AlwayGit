import { z } from 'zod';

const text = z.string().min(1).max(1000).refine(value => !value.includes('\0'));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
/** Separate from the author timestamp displayed in history rows. Dates are inclusive UTC calendar days. */
export const historySearchSchema = z.object({
  author: text.optional(), committerAfter: day.optional(), committerBefore: day.optional(),
  path: z.string().min(1).max(4096).refine(value => !value.includes('\0')).optional(),
  code: text.refine(value => !/[\r\n]/.test(value)).optional(), codeRegex: z.boolean().optional(),
  commitId: z.string().regex(/^[a-f\d]{4,64}$/i).optional(),
}).strict().refine(value => !value.committerAfter || !value.committerBefore || value.committerAfter <= value.committerBefore);
export type HistorySearchFilters = z.infer<typeof historySearchSchema>;
export const historySearchKey = (value?: HistorySearchFilters) => JSON.stringify([
  value?.author ?? '', value?.committerAfter ?? '', value?.committerBefore ?? '', value?.path ?? '',
  value?.code ?? '', value?.code ? !!value.codeRegex : false, value?.commitId ?? '',
]);
export const hasHistorySearch = (value?: HistorySearchFilters) => !!(value?.author || value?.committerAfter || value?.committerBefore || value?.path || value?.code || value?.commitId);

/** Fixed option names only; user values never become command text or revision arguments. */
export function historySearchArguments(search?: string, filters?: HistorySearchFilters): string[] {
  const args = ['--fixed-strings', '--regexp-ignore-case'];
  if (search) args.push(`--grep=${search}`);
  if (filters?.path) args.push('--full-history');
  if (filters?.author) args.push(`--author=${filters.author}`);
  // --since-as-filter walks through old committer timestamps instead of stopping early.
  if (filters?.committerAfter) args.push(`--since-as-filter=${filters.committerAfter}T00:00:00+00:00`);
  if (filters?.committerBefore) args.push(`--until=${filters.committerBefore}T23:59:59+00:00`);
  if (filters?.code) {
    const pattern = filters.codeRegex ? filters.code : filters.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    args.push('--diff-merges=separate', '--full-history', `-G${pattern}`);
  }
  return args;
}
