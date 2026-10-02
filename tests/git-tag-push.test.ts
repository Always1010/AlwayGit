import { afterEach, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { commitFile, git, gitFixtures } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-tag-push-');
afterEach(fixtures.cleanup);

describe('Tag Push', () => {
  it('creates a Tag and pushes only that new Tag when requested', async () => {
    const { root, service, repo } = await fixtures.setup();
    const head = await commitFile(root, 'base.txt', 'base');
    const bare = path.join(root, 'remote.git');
    await mkdir(bare); await git(bare, 'init', '--bare'); await git(root, 'remote', 'add', 'origin', bare);
    await git(root, 'tag', 'unrelated');
    await service.execute(repo, { type: 'tag.create', name: 'v1', target: head, message: 'release', pushRemote: 'origin' });
    expect(await git(bare, 'rev-parse', 'refs/tags/v1')).toBe(await git(root, 'rev-parse', 'refs/tags/v1'));
    await expect(git(bare, 'show-ref', '--verify', 'refs/tags/unrelated')).rejects.toThrow();
  });

  it('retains a newly created local Tag when its remote push is rejected', async () => {
    const { root, service, repo } = await fixtures.setup();
    const original = await commitFile(root, 'base.txt', 'base');
    const bare = path.join(root, 'remote.git');
    await mkdir(bare); await git(bare, 'init', '--bare'); await git(root, 'remote', 'add', 'origin', bare);
    await git(root, 'tag', 'remote-v1', original); await git(root, 'push', 'origin', 'refs/tags/remote-v1:refs/tags/v1');
    const replacement = await commitFile(root, 'next.txt', 'next');
    await expect(service.execute(repo, { type: 'tag.create', name: 'v1', target: replacement, pushRemote: 'origin' })).rejects.toMatchObject({ code: 'PARTIAL_FAILURE' });
    expect(await git(root, 'rev-parse', 'refs/tags/v1')).toBe(replacement);
    expect(await git(bare, 'rev-parse', 'refs/tags/v1')).toBe(original);
  });

  it('pushes only explicitly selected lightweight and annotated Tags', async () => {
    const { root, service, repo } = await fixtures.setup();
    await commitFile(root, 'base.txt', 'base');
    const bare = path.join(root, 'remote.git');
    await mkdir(bare); await git(bare, 'init', '--bare'); await git(root, 'remote', 'add', 'origin', bare);
    await git(root, 'tag', 'light');
    await git(root, 'tag', '-a', '-m', 'release', 'annotated');
    await git(root, 'tag', '-a', '-m', 'private', 'other');
    await git(root, 'config', 'push.followTags', 'true');
    const tags = (await service.snapshot(repo)).refs.filter(ref => ref.kind === 'tag');
    const selected = tags.filter(tag => tag.name !== 'other');
    await service.execute(repo, { type: 'tag.push', remote: 'origin', names: selected.map(tag => tag.name), expectedOids: Object.fromEntries(selected.map(tag => [tag.name, tag.refOid!])) });
    for (const tag of selected) expect(await git(bare, 'rev-parse', `refs/tags/${tag.name}`)).toBe(tag.refOid);
    await expect(git(bare, 'show-ref', '--verify', 'refs/tags/other')).rejects.toThrow();
  });

  it('preflights every raw Tag identity before pushing any selection', async () => {
    const { root, service, repo } = await fixtures.setup();
    await commitFile(root, 'base.txt', 'base');
    const bare = path.join(root, 'remote.git');
    await mkdir(bare); await git(bare, 'init', '--bare'); await git(root, 'remote', 'add', 'origin', bare);
    await git(root, 'tag', 'v1'); await git(root, 'tag', 'v2');
    const tags = (await service.snapshot(repo)).refs.filter(ref => ref.kind === 'tag');
    const expectedOids = Object.fromEntries(tags.map(tag => [tag.name, tag.refOid!]));
    const advanced = await commitFile(root, 'next.txt', 'next'); await git(root, 'tag', '-f', 'v2', advanced);
    await expect(service.execute(repo, { type: 'tag.push', remote: 'origin', names: ['v1', 'v2'], expectedOids })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
    await expect(git(bare, 'show-ref', '--verify', 'refs/tags/v1')).rejects.toThrow();
  });

  it('does not overwrite a different remote Tag', async () => {
    const { root, service, repo } = await fixtures.setup();
    const original = await commitFile(root, 'base.txt', 'base');
    const bare = path.join(root, 'remote.git');
    await mkdir(bare); await git(bare, 'init', '--bare'); await git(root, 'remote', 'add', 'origin', bare);
    await git(root, 'tag', 'v1', original); await git(root, 'push', 'origin', 'refs/tags/v1:refs/tags/v1');
    const replacement = await commitFile(root, 'next.txt', 'next'); await git(root, 'tag', '-f', 'v1', replacement);
    const tag = (await service.snapshot(repo)).refs.find(ref => ref.kind === 'tag' && ref.name === 'v1')!;
    await expect(service.execute(repo, { type: 'tag.push', remote: 'origin', names: ['v1'], expectedOids: { v1: tag.refOid! } })).rejects.toMatchObject({ code: 'PARTIAL_FAILURE' });
    expect(await git(bare, 'rev-parse', 'refs/tags/v1')).toBe(original);
  });
});
