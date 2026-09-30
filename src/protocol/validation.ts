import { z } from 'zod';
const text = z.string().min(1).max(4096);
const paths = z.array(text).min(1).max(10000);
const kind = z.enum(['merge', 'rebase', 'cherry-pick', 'revert']);
export const actionSchema = z.union([
  z.object({ type: z.enum(['stage', 'unstage', 'discard']), paths }),
  z.object({ type: z.literal('commit'), message: z.string().min(1).max(100000), amend: z.boolean().optional() }),
  z.object({ type: z.literal('fetch'), remote: text.optional() }),
  z.object({ type: z.literal('pull'), strategy: z.enum(['ff-only', 'merge', 'rebase']), remote: text.optional() }),
  z.object({ type: z.literal('push'), remote: text.optional(), branch: text.optional(), remoteBranch: text.optional(), setUpstream: z.boolean().optional(), forceWithLease: z.boolean().optional() }),
  z.object({ type: z.literal('branch.create'), name: text, start: text.optional(), checkout: z.boolean().optional() }),
  z.object({ type: z.literal('branch.checkout'), name: text }),
  z.object({ type: z.literal('commit.checkout'), target: text }),
  z.object({ type: z.literal('checkout.stash'), target: text, detached: z.boolean().optional(), includeUntracked: z.boolean().optional() }),
  z.object({ type: z.literal('branch.delete'), name: text, force: z.boolean().optional() }),
  z.object({ type: z.literal('tag.create'), name: text, target: text.optional(), message: z.string().max(100000).optional() }),
  z.object({ type: z.literal('tag.delete'), name: text }),
  z.object({ type: z.literal('stash.create'), message: z.string().max(10000).optional(), includeUntracked: z.boolean().optional() }),
  z.object({ type: z.literal('stash.apply'), selector: text, pop: z.boolean().optional(), expectedOid: text.optional() }),
  z.object({ type: z.literal('stash.drop'), selector: text, expectedOid: text.optional() }),
  z.object({ type: z.literal('worktree.add'), path: text, branch: text.optional(), newBranch: text.optional(), start: text.optional(), detach: z.boolean().optional() }),
  z.object({ type: z.literal('worktree.remove'), path: text, force: z.boolean().optional() }),
  z.object({ type: z.enum(['merge', 'rebase']), target: text }),
  z.object({ type: z.enum(['cherry-pick', 'revert']), commits: z.array(text).min(1).max(1000), mainline: z.number().int().min(1).max(100).optional(), expectedHead: text.optional(), expectedBranch: text.optional() }),
  z.object({ type: z.literal('reset'), target: text, mode: z.enum(['soft', 'mixed', 'hard']) }),
  z.object({ type: z.enum(['operation.continue', 'operation.abort', 'operation.skip']), kind }),
]);
export const requestSchema = z.object({ id: z.string().min(1).max(128), method: z.enum(['repositories', 'addRepository', 'snapshot', 'history', 'details', 'compare', 'action', 'diff', 'diffPreview', 'copyText', 'openRepository', 'openProject', 'openFile', 'openWorktree', 'pickWorktree', 'showLog', 'saveSession']), repoId: text.optional(), payload: z.unknown().optional() });
const graphColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const graphColors = z.object({ light: z.array(graphColor).min(4).max(16), dark: z.array(graphColor).min(4).max(16) })
  .refine(colors => colors.light.length === colors.dark.length, 'Light and dark graph palettes must have the same size');
export const sessionSchema = z.object({ version: z.literal(2).optional(), appearance: z.object({ theme: z.enum(['system', 'light', 'dark', 'contrast']), palette: z.enum(['vivid', 'distinct', 'extended']), codeFont: z.number().int().min(11).max(18), colors: graphColors.optional(), mainColors: z.object({ light: graphColor, dark: graphColor }).optional() }).optional(), language: z.enum(['en', 'zh-CN']).optional(), layout: z.object({ preset: z.enum(['workbench', 'editor']), sidebar: z.number().min(140).max(1200), details: z.number().min(200).max(1600), diff: z.number().min(80).max(1400), author: z.number().min(60).max(800), date: z.number().min(60).max(800), font: z.number().min(10).max(22), row: z.number().min(20).max(48) }).optional(), repoId: text.optional(), drafts: z.record(z.string().max(128), z.string().max(100000)).optional(), views: z.record(z.string().max(128), z.object({ ref: text.optional(), checkedRefs: z.array(text).max(10000).optional(), expandedRefGroups:z.array(text).max(10000).optional(),collapsedSidebarGroups:z.array(text).max(100).optional(), search: z.string().max(1000), selectedOid: text.optional(), selectedParent: text.optional(), selectedStashOid: text.optional(), selectedFile: text.optional(), tab: z.enum(['history', 'changes']) })).optional() }).refine(state => JSON.stringify(state).length <= 1000000, 'Session exceeds the storage limit');
export const copySchema = z.object({ text: z.string().max(1000000) });
export const openRepositorySchema = z.object({ newWindow: z.boolean().optional() });
export const openWorktreeSchema = z.object({ path: text, newWindow: z.boolean().optional() });
export const historySchema = z.object({ offset: z.number().int().min(0).max(10000000).optional(), limit: z.number().int().min(1).max(1000).optional(), tips: z.array(text).max(10000).optional(), ref: text.optional(), search: z.string().max(1000).optional() });
export const detailsSchema = z.object({ oid: text, parent: text.optional() });
export const comparisonSchema = z.object({ left: text, right: text, preserveOrder:z.boolean().optional() });
export const fileSchema = z.object({ path: text });
export const diffSchema = z.union([
  z.object({ kind: z.literal('change'), path: text, area: z.enum(['staged', 'unstaged', 'conflict']) }),
  z.object({ kind: z.literal('commit'), oid: text, path: text, parent: text.optional(), previousPath: text.optional() }),
  z.object({ kind: z.literal('comparison'), left: text, right: text, path: text, previousPath: text.optional() }),
]);
