import { afterEach, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { commitFile, git, gitFixtures } from './support/git-fixture';
import { tagState, tagStatusTtl } from '../webview/tagStatus';

const fixtures = gitFixtures('alwaygit-tag-status-');
afterEach(fixtures.cleanup);

describe('remote Tag status', () => {
  it('compares raw lightweight and annotated Tag objects, including differing annotations on the same commit', async () => {
    const { root, service, repo } = await fixtures.setup();
    await commitFile(root, 'base.txt', 'base');
    const bare = path.join(root, 'remote.git');
    await mkdir(bare); await git(bare, 'init', '--bare'); await git(root, 'remote', 'add', 'origin', bare);
    await git(root, 'tag', 'light'); await git(root, 'tag', '-a', 'annotated', '-m', 'published');
    await git(root, 'push', 'origin', '--tags'); await git(root, 'tag', 'local');
    await git(root, 'tag', '-f', '-a', 'annotated', '-m', 'changed annotation');
    const snapshot = await service.snapshot(repo);
    const result = await service.withReadSignal(new AbortController().signal, () => service.remoteTags(repo, 'origin', snapshot.remoteReadDestinations!.origin));
    const query = { result, loading: false, attemptedAt: result.checkedAt };
    const states = Object.fromEntries(snapshot.refs.filter(ref => ref.kind === 'tag').map(ref => [ref.name, tagState(ref, 'origin', query)]));
    expect(states).toEqual({ annotated: 'different', light: 'synced', local: 'local' });
    expect(Object.keys(result.refs)).toEqual(expect.arrayContaining(['refs/tags/light', 'refs/tags/annotated']));
    expect(Object.keys(result.refs).some(ref => ref.endsWith('^{}'))).toBe(false);
    const light = snapshot.refs.find(ref => ref.name === 'light')!;
    expect(tagState(light, 'origin', { ...query, error: 'offline' })).toBe('unknown');
    expect(tagState(light, 'origin', query, result.checkedAt + tagStatusTtl)).toBe('stale');
    expect(await git(root, 'rev-parse', 'annotated^{}')).toBe(await git(bare, 'rev-parse', 'annotated^{}'));
  });

  it('handles empty remotes, separate push addresses, address changes and failed queries without changing local Tags', async () => {
    const { root, service, repo } = await fixtures.setup();
    await commitFile(root, 'base.txt', 'base'); await git(root, 'tag', 'v1');
    const bare = path.join(root, 'remote.git'); await mkdir(bare); await git(bare, 'init', '--bare');
    await git(root, 'remote', 'add', 'origin', bare);
    await git(root, 'remote', 'set-url', '--push', 'origin', path.join(root, 'publish.git'));
    const snapshot = await service.snapshot(repo), before = await git(root, 'show-ref', '--tags');
    const empty = await service.remoteTags(repo, 'origin', snapshot.remoteReadDestinations!.origin);
    expect(empty.refs).toEqual({}); expect(empty.separatePush).toBe(true);
    expect(JSON.stringify(empty)).not.toContain(bare.replace(/\\/g, '/'));
    await git(root, 'remote', 'set-url', 'origin', path.join(root, 'missing.git'));
    await expect(service.remoteTags(repo, 'origin', snapshot.remoteReadDestinations!.origin)).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
    const moved = await service.snapshot(repo);
    await expect(service.remoteTags(repo, 'origin', moved.remoteReadDestinations!.origin)).rejects.toThrow();
    expect(await git(root, 'show-ref', '--tags')).toBe(before);
  });
});
