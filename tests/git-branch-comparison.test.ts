import { afterEach, expect, it } from 'vitest';
import { gitFixtures, git, commitFile } from './support/git-fixture';
import { branchComparisonSchema } from '../src/protocol/validation';

const fixtures = gitFixtures('alwaygit-branch-comparison-');
afterEach(fixtures.cleanup);

it('compares divergent pinned trees, pages both exclusive histories and preserves the worktree', async () => {
  const { root, repo, service } = await fixtures.setup();
  const ancestor = await commitFile(root, 'shared.txt', 'common\n');
  await git(root, 'checkout', '-b', 'feature');
  await commitFile(root, 'feature.txt', 'one\n');
  await git(root, 'mv', 'shared.txt', 'renamed.txt');
  await git(root, 'commit', '-m', 'rename');
  const targetOid = await commitFile(root, 'binary.dat', Buffer.from([0, 1, 2]));
  await git(root, 'checkout', 'main');
  await commitFile(root, 'main.txt', 'main one\n');
  const baseOid = await commitFile(root, 'main.txt', 'main two\n');
  const before = await git(root, 'status', '--porcelain=v1');
  const query = { baseRef: 'refs/heads/main', targetRef: 'refs/heads/feature', limit: 1 };
  const review = await service.branchComparison(repo, query);
  expect(review).toMatchObject({ baseOid, targetOid, mode: 'review', mergeBases: [ancestor], diffBase: ancestor, base: { total: 2, nextOffset: 1, hasMore: true }, target: { total: 3, nextOffset: 1, hasMore: true } });
  expect(review.files).toContainEqual({ path: 'renamed.txt', previousPath: 'shared.txt', status: 'R100' });
  expect(review.files.map(file => file.path)).toEqual(['binary.dat', 'feature.txt', 'renamed.txt']);
  const pinned = { ...query, baseOid, targetOid };
  const next = await service.branchComparison(repo, { ...pinned, baseOffset: 1, targetOffset: 1 });
  expect(next.base.commits[0].oid).not.toBe(review.base.commits[0].oid);
  expect(next.target.commits[0].oid).not.toBe(review.target.commits[0].oid);
  const snapshot = await service.branchComparison(repo, { ...pinned, mode: 'snapshot' });
  expect(snapshot.diffBase).toBe(baseOid);
  expect(snapshot.files).toContainEqual({ path: 'main.txt', status: 'D' });
  const reverse = await service.branchComparison(repo, { baseRef: query.targetRef, targetRef: query.baseRef, baseOid: targetOid, targetOid: baseOid });
  expect(reverse.base.total).toBe(3);
  expect(reverse.target.total).toBe(2);
  expect(reverse.files.map(file => file.path)).toEqual(['main.txt']);
  expect(await git(root, 'status', '--porcelain=v1')).toBe(before);
  expect(await git(root, 'symbolic-ref', 'HEAD')).toBe('refs/heads/main');
  await commitFile(root, 'later.txt', 'later\n');
  expect((await service.branchComparison(repo, pinned)).baseOid).toBe(baseOid);
  expect((await service.branchComparison(repo, query)).baseOid).not.toBe(baseOid);
});

it('allows unrelated snapshots and reports review unavailable without inventing an ancestor', async () => {
  const { root, repo, service } = await fixtures.setup();
  const base = await commitFile(root, 'base.txt', 'base\n');
  const tree = await git(root, 'rev-parse', 'HEAD^{tree}');
  const other = await git(root, 'commit-tree', tree, '-m', 'unrelated');
  await git(root, 'update-ref', 'refs/heads/unrelated', other);
  const query = { baseRef: 'refs/heads/main', targetRef: 'refs/heads/unrelated' };
  const review = await service.branchComparison(repo, query);
  expect(review.mergeBases).toEqual([]);
  expect(review.diffBase).toBeUndefined();
  expect(review.base.total).toBe(1);
  expect(review.target.total).toBe(1);
  const snapshot = await service.branchComparison(repo, { ...query, mode: 'snapshot' });
  expect(snapshot.diffBase).toBe(base);
  expect(snapshot.files).toEqual([]);
});

it('requires an explicit merge base for criss-cross review and rejects unrelated selections', async () => {
  const { root, repo, service } = await fixtures.setup();
  const common = await commitFile(root, 'file.txt', 'base\n');
  const tree = await git(root, 'rev-parse', 'HEAD^{tree}');
  const a = await git(root, 'commit-tree', tree, '-p', common, '-m', 'a');
  const b = await git(root, 'commit-tree', tree, '-p', common, '-m', 'b');
  const x = await git(root, 'commit-tree', tree, '-p', a, '-p', b, '-m', 'x');
  const y = await git(root, 'commit-tree', tree, '-p', b, '-p', a, '-m', 'y');
  await git(root, 'update-ref', 'refs/heads/x', x);
  await git(root, 'update-ref', 'refs/heads/y', y);
  const query = { baseRef: 'refs/heads/x', targetRef: 'refs/heads/y' };
  const review = await service.branchComparison(repo, query);
  expect(new Set(review.mergeBases)).toEqual(new Set([a, b]));
  expect(review.diffBase).toBeUndefined();
  expect((await service.branchComparison(repo, { ...query, mergeBase: a })).diffBase).toBe(a);
  await expect(service.branchComparison(repo, { ...query, mergeBase: common })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  expect((await service.branchComparison(repo, { ...query, mode: 'snapshot' })).diffBase).toBe(x);
});

it('validates immutable pin pairs, pagination and merge-base object IDs at the RPC boundary', () => {
  const query = { baseRef: 'HEAD', targetRef: 'refs/remotes/origin/main' };
  expect(branchComparisonSchema.safeParse(query).success).toBe(true);
  expect(branchComparisonSchema.safeParse({ ...query, baseOid: 'a'.repeat(40) }).success).toBe(false);
  expect(branchComparisonSchema.safeParse({ ...query, baseOffset: -1 }).success).toBe(false);
  expect(branchComparisonSchema.safeParse({ ...query, limit: 301 }).success).toBe(false);
  expect(branchComparisonSchema.safeParse({ ...query, mergeBase: 'HEAD' }).success).toBe(false);
});
