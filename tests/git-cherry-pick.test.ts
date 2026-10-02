import { afterEach, describe, expect, it } from 'vitest';
import { gitFixtures, commitFile, git } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-cherry-pick-');
afterEach(fixtures.cleanup);

describe('cherry-pick ancestry protection', () => {
  it('rejects HEAD and historical ancestors without creating an operation or applying a batch prefix', async () => {
    const { root, repo, service } = await fixtures.setup();
    const first = await commitFile(root, 'base.txt', 'base');
    const head = await commitFile(root, 'main.txt', 'main');
    await git(root, 'switch', '-c', 'topic');
    const topic = await commitFile(root, 'topic.txt', 'topic');
    await git(root, 'switch', 'main');
    expect(await service.cherryPickCheck(repo, [head, first, topic])).toEqual({ head, branch: 'main', included: [head, first] });
    for (const action of [
      { commits: [head] },
      { commits: [head], allowIncluded: true, expectedHead: head, expectedBranch: 'main' },
      { commits: [topic, first] },
    ]) await expect(service.execute(repo, { type: 'cherry-pick', ...action })).rejects.toMatchObject({ code: 'COMMIT_ALREADY_INCLUDED' });
    expect((await service.snapshot(repo)).operation.kind).toBeUndefined();
    expect(await git(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(await git(root, 'status', '--porcelain')).toBe('');
    await service.execute(repo, { type: 'cherry-pick', commits: [topic], expectedHead: head, expectedBranch: 'main' });
    expect(await git(root, 'show', 'HEAD:topic.txt')).toBe('topic');
  });

  it('recognizes merged side-branch commits even when no graph data is loaded', async () => {
    const { root, repo, service } = await fixtures.setup();
    await commitFile(root, 'base.txt', 'base');
    await git(root, 'switch', '-c', 'topic');
    const topic = await commitFile(root, 'topic.txt', 'topic');
    await git(root, 'switch', 'main');
    await commitFile(root, 'main.txt', 'main');
    await git(root, 'merge', '--no-ff', 'topic', '-m', 'merge topic');
    const head = await git(root, 'rev-parse', 'HEAD');
    expect((await service.cherryPickCheck(repo, [topic, head])).included).toEqual([topic, head]);
    await expect(service.execute(repo, { type: 'cherry-pick', commits: [topic] })).rejects.toMatchObject({ code: 'COMMIT_ALREADY_INCLUDED' });
    await expect(service.execute(repo, { type: 'cherry-pick', commits: [head], mainline: 1 })).rejects.toMatchObject({ code: 'COMMIT_ALREADY_INCLUDED' });
  });

  it('keeps Revert available and reapplies reverted changes only with explicit confirmation bound to HEAD', async () => {
    const { root, repo, service } = await fixtures.setup();
    await commitFile(root, 'base.txt', 'base');
    const feature = await commitFile(root, 'feature.txt', 'feature');
    await service.execute(repo, { type: 'revert', commits: [feature] });
    const head = await git(root, 'rev-parse', 'HEAD');
    expect((await service.cherryPickCheck(repo, [feature])).included).toEqual([feature]);
    await expect(service.execute(repo, { type: 'cherry-pick', commits: [feature] })).rejects.toMatchObject({ code: 'COMMIT_ALREADY_INCLUDED' });
    await expect(service.execute(repo, { type: 'cherry-pick', commits: [feature], allowIncluded: true })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
    await expect(service.execute(repo, { type: 'cherry-pick', commits: [feature], allowIncluded: true, expectedHead: feature, expectedBranch: 'main' })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
    await service.execute(repo, { type: 'cherry-pick', commits: [feature], allowIncluded: true, expectedHead: head, expectedBranch: 'main' });
    expect(await git(root, 'show', 'HEAD:feature.txt')).toBe('feature');
  });

  it('rejects stale ancestry checks and detached HEAD execution', async () => {
    const { root, repo, service } = await fixtures.setup();
    const first = await commitFile(root, 'base.txt', 'base');
    const head = await commitFile(root, 'main.txt', 'main');
    await expect(service.cherryPickCheck(repo, [first], { expectedHead: first, expectedBranch: 'main' })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
    await git(root, 'switch', '-c', 'other');
    await expect(service.cherryPickCheck(repo, [first], { expectedHead: head, expectedBranch: 'main' })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
    await expect(service.execute(repo, { type: 'cherry-pick', commits: [first], allowIncluded: true, expectedHead: head, expectedBranch: 'main' })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
    await git(root, 'switch', '--detach', head);
    await expect(service.execute(repo, { type: 'cherry-pick', commits: [first] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect((await service.snapshot(repo)).operation.kind).toBeUndefined();
  });
});
