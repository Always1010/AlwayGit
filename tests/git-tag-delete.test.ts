import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GitService } from '../src/git/service';
import { commitFile, git, gitFixtures } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-tag-delete-');
afterEach(fixtures.cleanup);

describe('Tag deletion identity', () => {
  async function publishedTag(root: string, service: GitService, repo: Awaited<ReturnType<GitService['discover']>>, name = 'v1') {
    const snapshot = await service.snapshot(repo);
    const remote = await service.remoteTags(repo, 'origin', snapshot.remoteReadDestinations!.origin);
    return {
      localOid: snapshot.refs.find(ref => ref.kind === 'tag' && ref.name === name)!.refOid!,
      remoteOid: remote.refs[`refs/tags/${name}`],
      destination: snapshot.remoteDestinations!.origin,
    };
  }

  async function addOrigin(root: string) {
    const bare = path.join(root, 'remote.git');
    await git(root, 'init', '--bare', bare);
    await git(root, 'remote', 'add', 'origin', bare);
    return bare;
  }

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

  it('deletes a confirmed Tag from the remote before deleting the local Tag', async () => {
    const { root, service, repo } = await fixtures.setup();
    await commitFile(root, 'base.txt', 'base');
    await addOrigin(root);
    await git(root, 'tag', '-a', '-m', 'release', 'v1');
    await git(root, 'push', 'origin', 'refs/tags/v1:refs/tags/v1');
    const identity = await publishedTag(root, service, repo);
    const result = await service.execute(repo, { type:'tag.delete', name:'v1', expectedOid:identity.localOid, remote:'origin', expectedRemoteOid:identity.remoteOid, expectedDestination:identity.destination });
    expect(result).toMatchObject({outcome:'success',remote:'origin',destinations:[{refs:[{kind:'tag',name:'v1',status:'deleted'}]}]});
    await expect(git(root, 'show-ref', '--verify', 'refs/tags/v1')).rejects.toThrow();
    await expect(git(root, '--git-dir', path.join(root, 'remote.git'), 'show-ref', '--verify', 'refs/tags/v1')).rejects.toThrow();
  });

  it('can delete a remote-only Tag without creating or deleting a local Tag', async () => {
    const { root, service, repo } = await fixtures.setup();
    await commitFile(root, 'base.txt', 'base');
    await addOrigin(root);
    await git(root, 'tag', 'v1');
    await git(root, 'push', 'origin', 'refs/tags/v1:refs/tags/v1');
    const identity = await publishedTag(root, service, repo);
    await git(root, 'tag', '-d', 'v1');
    await service.execute(repo, { type:'tag.delete', name:'v1', remote:'origin', expectedRemoteOid:identity.remoteOid, expectedDestination:identity.destination });
    await expect(git(root, 'show-ref', '--verify', 'refs/tags/v1')).rejects.toThrow();
    await expect(git(root, '--git-dir', path.join(root, 'remote.git'), 'show-ref', '--verify', 'refs/tags/v1')).rejects.toThrow();
  });

  it('retains the local Tag when the confirmed remote Tag has changed', async () => {
    const { root, service, repo } = await fixtures.setup();
    await commitFile(root, 'base.txt', 'base');
    await addOrigin(root);
    await git(root, 'tag', 'v1');
    await git(root, 'push', 'origin', 'refs/tags/v1:refs/tags/v1');
    const identity = await publishedTag(root, service, repo);
    const replacement = await commitFile(root, 'base.txt', 'replacement');
    await git(root, 'tag', 'replacement', replacement);
    await git(root, 'push', '--force', 'origin', 'refs/tags/replacement:refs/tags/v1');
    await expect(service.execute(repo, { type:'tag.delete', name:'v1', expectedOid:identity.localOid, remote:'origin', expectedRemoteOid:identity.remoteOid, expectedDestination:identity.destination })).rejects.toMatchObject({code:'GIT_FAILED'});
    expect(await git(root, 'rev-parse', 'refs/tags/v1')).toBe(identity.localOid);
    expect(await git(root, '--git-dir', path.join(root, 'remote.git'), 'rev-parse', 'refs/tags/v1')).toBe(replacement);
  });

  it('reports partial failure when the local Tag changes after remote deletion', async () => {
    const { root, service, repo } = await fixtures.setup();
    const head = await commitFile(root, 'base.txt', 'base');
    await addOrigin(root);
    await git(root, 'tag', '-a', '-m', 'original', 'v1');
    await git(root, 'push', 'origin', 'refs/tags/v1:refs/tags/v1');
    const identity = await publishedTag(root, service, repo);
    const racing = new GitService({ environment: async (_repo, args) => {
      if (args[0] === 'update-ref' && args.includes('-d')) await git(root, 'tag', '-f', '-a', '-m', 'replacement', 'v1', head);
      return {};
    } });
    await expect(racing.execute(repo, { type:'tag.delete', name:'v1', expectedOid:identity.localOid, remote:'origin', expectedRemoteOid:identity.remoteOid, expectedDestination:identity.destination })).rejects.toMatchObject({code:'PARTIAL_FAILURE',pushResult:{outcome:'success'}});
    expect(await git(root, 'rev-parse', 'v1^{}')).toBe(head);
    expect(await git(root, 'rev-parse', 'refs/tags/v1')).not.toBe(identity.localOid);
    await expect(git(root, '--git-dir', path.join(root, 'remote.git'), 'show-ref', '--verify', 'refs/tags/v1')).rejects.toThrow();
  });

  it('refuses remote Tag deletion when fetch and push use different addresses', async () => {
    const { root, service, repo } = await fixtures.setup();
    await commitFile(root, 'base.txt', 'base');
    const readBare = await addOrigin(root), pushBare = path.join(root, 'push.git');
    await git(root, 'init', '--bare', pushBare);
    await git(root, 'tag', 'v1');
    await git(root, 'push', 'origin', 'refs/tags/v1:refs/tags/v1');
    const identity = await publishedTag(root, service, repo);
    await git(root, 'config', 'remote.origin.pushurl', pushBare);
    const snapshot = await service.snapshot(repo);
    await expect(service.execute(repo, { type:'tag.delete', name:'v1', expectedOid:identity.localOid, remote:'origin', expectedRemoteOid:identity.remoteOid, expectedDestination:snapshot.remoteDestinations!.origin })).rejects.toMatchObject({code:'SEPARATE_PUSH_DESTINATION'});
    expect(await git(root, 'rev-parse', 'refs/tags/v1')).toBe(identity.localOid);
    expect(await git(root, '--git-dir', readBare, 'rev-parse', 'refs/tags/v1')).toBe(identity.remoteOid);
  });
});
