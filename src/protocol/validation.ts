import { z } from 'zod';
const text = z.string().min(1).max(4096);
const paths = z.array(text).min(1).max(10000);
const kind = z.enum(['merge', 'rebase', 'cherry-pick', 'revert']);
export const actionSchema = z.union([
  z.object({ type: z.enum(['stage', 'unstage', 'discard']), paths }),
  z.object({ type: z.literal('commit'), message: z.string().min(1).max(100000), amend: z.boolean().optional() }),
  z.object({ type: z.literal('fetch'), remote: text.optional() }),
  z.object({ type: z.literal('pull'), strategy: z.enum(['ff-only', 'merge', 'rebase']), remote: text.optional() }),
  z.object({ type: z.literal('push'), remote: text.optional(), branch: text.optional(), forceWithLease: z.boolean().optional() }),
  z.object({ type: z.literal('branch.create'), name: text, start: text.optional(), checkout: z.boolean().optional() }),
  z.object({ type: z.literal('branch.checkout'), name: text }),
  z.object({ type: z.literal('branch.delete'), name: text, force: z.boolean().optional() }),
  z.object({ type: z.literal('tag.create'), name: text, target: text.optional(), message: z.string().max(100000).optional() }),
  z.object({ type: z.literal('tag.delete'), name: text }),
  z.object({ type: z.literal('stash.create'), message: z.string().max(10000).optional(), includeUntracked: z.boolean().optional() }),
  z.object({ type: z.literal('stash.apply'), selector: text, pop: z.boolean().optional() }),
  z.object({ type: z.literal('stash.drop'), selector: text }),
  z.object({ type: z.literal('worktree.add'), path: text, branch: text.optional(), newBranch: text.optional(), start: text.optional(), detach: z.boolean().optional() }),
  z.object({ type: z.literal('worktree.remove'), path: text, force: z.boolean().optional() }),
  z.object({ type: z.enum(['merge', 'rebase']), target: text }),
  z.object({ type: z.enum(['cherry-pick', 'revert']), commits: z.array(text).min(1).max(1000), mainline: z.number().int().min(1).max(100).optional() }),
  z.object({ type: z.literal('reset'), target: text, mode: z.enum(['soft', 'mixed', 'hard']) }),
  z.object({ type: z.enum(['operation.continue', 'operation.abort', 'operation.skip']), kind }),
]);
export const requestSchema = z.object({ id: z.string().min(1).max(128), method: z.enum(['repositories', 'addRepository', 'snapshot', 'history', 'details', 'action', 'diff', 'openFile', 'openWorktree', 'pickWorktree', 'showLog', 'saveSession']), repoId: text.optional(), payload: z.unknown().optional() });
export const sessionSchema = z.object({ repoId: text.optional(), drafts: z.record(z.string().max(128), z.string().max(100000)).optional(), views: z.record(z.string().max(128), z.object({ ref: text.optional(), search: z.string().max(1000), selectedOid: text.optional(), tab: z.enum(['history', 'changes']) })).optional() }).refine(state => JSON.stringify(state).length <= 1000000, 'Session exceeds the storage limit');
export const historySchema = z.object({ offset: z.number().int().min(0).max(10000000).optional(), limit: z.number().int().min(1).max(1000).optional(), tips: z.array(text).max(10000).optional(), ref: text.optional(), search: z.string().max(1000).optional() });
export const detailsSchema = z.object({ oid: text, parent: text.optional() });
export const fileSchema = z.object({ path: text });
export const diffSchema = z.union([
  z.object({ kind: z.literal('change'), path: text, area: z.enum(['staged', 'unstaged', 'conflict']) }),
  z.object({ kind: z.literal('commit'), oid: text, path: text, parent: text.optional(), previousPath: text.optional() }),
]);
