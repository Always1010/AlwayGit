import { translate } from '../i18n/index';
import { z } from 'zod';
const text = z.string().min(1).max(4096);
const paths = z.array(text).min(1);
export const discardRequestSchema = z.object({ paths: paths.optional(), scope: z.enum(['unstaged', 'all']).optional() }).refine(value => (value.paths !== undefined) !== (value.scope !== undefined));
const kind = z.enum(['merge', 'rebase', 'cherry-pick', 'revert']);
const actionContext = { expectedHead: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})?$/), expectedBranch: z.string().max(4096) };
export const actionSchema = z.union([
  z.object({ type: z.enum(['stage', 'resolve-and-stage', 'unstage']), paths }),
  z.object({ type: z.literal('discard'), paths: z.array(text).default([]), planToken: text.optional(), mode: z.literal('all').optional() }).refine(value => (value.paths.length > 0 || !!value.planToken) && (!value.mode || !!value.planToken)),
  z.object({ type: z.literal('commit'), message: z.string().min(1).max(100000), amend: z.boolean().optional(), reviewToken: text.optional(), files: z.array(z.object({ path: text, area: z.enum(['staged', 'unstaged']) })).optional(), expectedHead: actionContext.expectedHead.optional(), expectedBranch: actionContext.expectedBranch.optional() }).refine(value => !value.files || (value.files.length > 0 || !!value.amend) && value.expectedHead !== undefined && value.expectedBranch !== undefined),
  z.object({ type: z.literal('fetch'), remote: text.optional() }),
  z.object({ type: z.literal('pull'), strategy: z.enum(['ff-only', 'merge', 'rebase']), remote: text.optional() }),
  z.object({ type: z.literal('push'), remote: text.optional(), branch: text.optional(), remoteBranch: text.optional(), setUpstream: z.boolean().optional(), followTags: z.boolean().optional(), forceWithLease: z.boolean().optional(), expectedOid: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})?$/).optional(), expectedDestination: z.string().regex(/^[a-f0-9]{64}$/).optional() }),
  z.object({ type: z.literal('remote.add'), name: text, url: text }),
  z.object({ type: z.literal('branch.create'), name: text, start: text.optional(), checkout: z.boolean().optional() }),
  z.object({ type: z.literal('branch.track'), branches: z.array(z.object({ source: text, name: text, expectedOid: text.optional() })).min(1).max(1000), checkout: z.boolean().optional(), stashFirst: z.boolean().optional(), includeUntracked: z.boolean().optional() })
    .refine(value => !value.checkout || value.branches.length === 1, translate('en', "validation.checkoutRequiresExactlyOneBranch"))
    .refine(value => !value.stashFirst || !!value.checkout, translate('en', "validation.stashRequiresCheckout")),
  z.object({ type: z.literal('branch.checkout'), name: text }),
  z.object({ type: z.literal('commit.checkout'), target: text }),
  z.object({ type: z.literal('checkout.stash'), target: text, detached: z.boolean().optional(), includeUntracked: z.boolean().optional() }),
  z.object({ type: z.literal('branch.delete'), names: z.array(text).min(1).max(1000), force: z.boolean().optional(), expectedOids:z.record(text,text).optional() }),
  z.object({ type:z.literal('remote.delete'), remote:text, branches:z.array(text).min(1).max(1000), expectedOids:z.record(text,z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})?$/)).optional(), expectedDestination:z.string().regex(/^[a-f0-9]{64}$/).optional() }),
  z.object({ type: z.literal('tag.create'), name: text, target: text.optional(), message: z.string().max(100000).optional(), pushRemote: text.optional() }),
  z.object({ type: z.literal('tag.push'), remote: text, names: z.array(text).min(1).max(1000), expectedOids: z.record(text, z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)).refine(values => Object.values(values).every(oid => !/^0+$/.test(oid))) }),
  z.object({ type: z.literal('tag.delete'), name: text, expectedOid: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).refine(oid => !/^0+$/.test(oid)) }),
  z.object({ type: z.literal('stash.create'), message: z.string().max(10000).optional(), includeUntracked: z.boolean().optional(), paths: paths.optional() }),
  z.object({ type: z.literal('stash.apply'), selector: text, pop: z.boolean().optional(), expectedOid: text.optional() }),
  z.object({ type: z.literal('stash.drop'), selector: text, expectedOid: text.optional() }),
  z.object({ type: z.literal('worktree.add'), path: text, branch: text.optional(), newBranch: text.optional(), start: text.optional(), detach: z.boolean().optional() }),
  z.object({ type: z.literal('worktree.remove'), path: text, force: z.boolean().optional() }),
  z.object({ type: z.enum(['merge', 'rebase']), target: text, ...actionContext }),
  z.object({ type: z.enum(['cherry-pick', 'revert']), commits: z.array(text).min(1).max(1000), mainline: z.number().int().min(1).max(100).optional(), expectedHead: text.optional(), expectedBranch: text.optional(), allowIncluded: z.boolean().optional() }),
  z.object({ type: z.literal('reset'), target: text, mode: z.enum(['soft', 'mixed', 'hard']), ...actionContext }),
  z.object({ type: z.literal('operation.continue'), kind, reviewToken: text.optional() }),
  z.object({ type: z.enum(['operation.abort', 'operation.skip']), kind }),
]);
export const requestSchema = z.object({ id: z.string().min(1).max(128), method: z.enum(['terminalCreate', 'terminalList', 'terminalSync', 'terminalClipboard', 'terminalAck', 'terminalInput', 'terminalResize', 'terminalClose', 'terminalStop', 'terminalRestart', 'terminalRename', 'repositories', 'repositoryCollections', 'repositoryOrder', 'reorderRepository', 'repositoryStatuses', 'pickRepositoryDirectory', 'discoverRepositories', 'cancelRepositoryDiscovery', 'addRepository', 'removeRepositories', 'createRepositoryCollection', 'renameRepositoryCollection', 'deleteRepositoryCollection', 'moveRepositories', 'snapshot', 'operationReview', 'prepareDiscard', 'history', 'details', 'stashDetails', 'compare', 'cherryPickCheck', 'cancelQuery', 'action', 'diff', 'diffPreview', 'copyText', 'openExternal', 'remoteLinks', 'openWorkbench', 'openRepository', 'openProject', 'openFile', 'openWorktree', 'pickWorktree', 'openKeyboardShortcuts', 'showLog', 'saveSession', 'operationSettings', 'saveOperationSettings']), repoId: text.optional(), payload: z.unknown().optional() });
export const cancelQuerySchema = z.object({ requestId: z.string().min(1).max(128) }).strict();
export const operationSettingsSchema = z.object({ allowDetachedHead: z.boolean(), pushFollowTags: z.boolean(), pushTagAfterCreate: z.boolean(), defaultResetMode: z.enum(['soft','mixed','hard']) }).strict();
export { sessionSchema } from './session';
export const copySchema = z.object({ text: z.string().max(1000000) });
export const repositoryKeysSchema = z.object({ keys: z.array(text).min(1).max(10000) });
export const repositoryCollectionSchema = z.object({ id: text });
export const createRepositoryCollectionSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const moveRepositoriesSchema = repositoryKeysSchema.extend({ collectionId: text.optional() });
const repositoryScanId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/);
export const repositoryDiscoverySchema = z.object({ scanId: repositoryScanId, path: text });
export const cancelRepositoryDiscoverySchema = z.object({ scanId: repositoryScanId });
export const addRepositoriesSchema = z.object({ scanId: repositoryScanId, keys: z.array(text).min(1).max(10000), collectionId: text.optional(), newCollectionName: z.string().trim().min(1).max(80).optional() }).refine(value=>!(value.collectionId&&value.newCollectionName),translate('en', "validation.chooseAnExistingGroupOrCreateANewOne"));
export const openRepositorySchema = z.object({ newWindow: z.boolean().optional(), newTab: z.boolean().optional() }).refine(value=>!value.newWindow||!value.newTab,translate('en', "validation.chooseEitherANewTabOrANewWindow"));
export const openWorkbenchSchema = z.object({ newTab: z.boolean().optional(), newWindow: z.boolean().optional() }).refine(value=>Number(!!value.newTab)+Number(!!value.newWindow)===1,translate('en', "validation.chooseOneWorkbenchDestination"));
export const openWorktreeSchema = z.object({ path: text, newWindow: z.boolean().optional() });
export const historySchema = z.object({ offset: z.number().int().min(0).max(10000000).optional(), limit: z.number().int().min(1).max(1000).optional(), tips: z.array(text).max(10000).optional(), ref: text.optional(), search: z.string().max(1000).optional(), head: text.optional() });
export const detailsSchema = z.object({ oid: text, parent: text.optional() });
export const comparisonSchema = z.object({ left: text, right: text, preserveOrder:z.boolean().optional() });
export const cherryPickCheckSchema = z.object({ commits: z.array(text).min(1).max(1000), ...actionContext });
export const fileSchema = z.object({ path: text });
export const diffSchema = z.union([
  z.object({ kind: z.literal('change'), path: text, area: z.enum(['staged', 'unstaged', 'conflict']) }),
  z.object({ kind: z.literal('commit'), oid: text, path: text, parent: text.optional(), previousPath: text.optional() }),
  z.object({ kind: z.literal('comparison'), left: text, right: text, path: text, previousPath: text.optional() }),
  z.object({ kind: z.literal('stash-working'), stashOid: text, path: text }),
]);

export const reorderRepositorySchema = z.object({ key: text, targetKey: text, position: z.enum(['before', 'after']) });

export const externalUrlSchema = z.object({ url: z.string().max(4096).url().refine(value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !/[\u0000-\u0020]/.test(value); } catch { return false; } }) }).strict();
export const remoteLinksSchema = z.object({ remote: text.optional(), branch: text.optional() }).strict();
