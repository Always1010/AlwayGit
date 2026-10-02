import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GitService } from '../src/git/service';
import { commitFile, git, gitFixtures } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-tag-delete-');
afterEach(fixtures.cleanup);

describe('Tag deletion identity', () => {
  it.each(['annotated', 'lightweight'] as const)('retains a replaced %s Tag until its new raw identity is confirmed', async kind => {
    const { root, service, repo } = await fixtures.setup();
    const head = await commitFile(root, 'base.txt', 'base');
    await git(root, 'tag', ...(kind === 'annotated' ? ['-a', '-m', 'original annotation'] : []), 'v1');
    const original = (await service.snapshot(repo)).refs.find(ref => ref.kind === 'tag' && ref.name === 'v1')!;
    expect(original.oid).toBe(head);
    expect(original.refOid).toBe(await git(root, 'rev-parse', 'refs/tags/v1'));
    if (kind === 'annotated') {
      await git(root, 'tag', '-d', 'v1');
      await git(root, 'tag', '-a', '-m', 'replacement annotation at the same commit', 'v1', head);
      expect(await git(root, 'rev-parse', 'v1^{}')).toBe(head);
    } else {
      const advanced = await commitFile(root, 'base.txt', 'advanced');
      await git(root, 'tag', '-f', 'v1', advanced);
    }
    const replacement = await git(root, 'rev-parse', 'refs/tags/v1');
    expect(replacement).not.toBe(original.refOid);
    await writeFile(path.join(root, 'base.txt'), 'local working');
    const indexBefore = await readFile(path.join(root, '.git', 'index'));
    await expect(service.execute(repo, { type: 'tag.delete', name: 'v1', expectedOid: original.refOid! })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
    expect(await git(root, 'rev-parse', 'refs/tags/v1')).toBe(replacement);
    expect(await readFile(path.join(root, '.git', 'index'))).toEqual(indexBefore);
    expect(await readFile(path.join(root, 'base.txt'), 'utf8')).toBe('local working');
    await service.execute(repo, { type: 'tag.delete', name: 'v1', expectedOid: replacement });
    await expect(git(root, 'show-ref', '--verify', 'refs/tags/v1')).rejects.toThrow();
  });

  it('rejects missing, zero and peeled identities without deleting an annotated Tag', async () => {
    const { root, service, repo } = await fixtures.setup();
    const head = await commitFile(root, 'base.txt', 'base');
    await git(root, 'tag', '-a', '-m', 'annotation', 'v1');
    const raw = await git(root, 'rev-parse', 'refs/tags/v1');
    for (const expectedOid of [undefined, '', '0'.repeat(40), head]) {
      await expect(service.execute(repo, { type: 'tag.delete', name: 'v1', expectedOid: expectedOid as string })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
      expect(await git(root, 'rev-parse', 'refs/tags/v1')).toBe(raw);
    }
  });

  it('keeps a same-commit replacement that races the atomic deletion', async () => {
    const { root, service, repo } = await fixtures.setup();
    const head = await commitFile(root, 'base.txt', 'base');
    await git(root, 'tag', '-a', '-m', 'original annotation', 'v1');
    const original = (await service.snapshot(repo)).refs.find(ref => ref.kind === 'tag' && ref.name === 'v1')!;
    let raced = false;
    const racing = new GitService({ environment: async (_repo, args) => {
      if (args[0] === 'update-ref' && args.includes('-d')) {
        raced = true;
        await git(root, 'tag', '-f', '-a', '-m', 'racing annotation', 'v1', head);
      }
      return {};
    } });
    await expect(racing.execute(repo, { type: 'tag.delete', name: 'v1', expectedOid: original.refOid! })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
    expect(raced).toBe(true);
    expect(await git(root, 'rev-parse', 'refs/tags/v1')).not.toBe(original.refOid);
    expect(await git(root, 'rev-parse', 'v1^{}')).toBe(head);
  });
});
