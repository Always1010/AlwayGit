import { it, expect, afterEach, vi } from 'vitest';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { gitFixtures, git, commitFile } from './support/git-fixture';
import { captureRemoteLease, updateRemoteLease } from '../webview/remoteLease';
import { actionSchema } from '../src/protocol/validation';
import { GitService } from '../src/git/service';
import type { GitResult } from '../src/git/runner';
import type { Repository } from '../src/protocol/types';
const fixtures = gitFixtures('alwaygit-lease-test-');
afterEach(async () => { vi.restoreAllMocks(); await fixtures.cleanup(); });
it('deletes only selected remote branches even when push.followTags is enabled', async () => {
  const { root, service, repo } = await fixtures.setup();
  const head = await commitFile(root, 'base.txt', 'base'), bare = path.join(root, 'remote.git');
  await mkdir(bare); await git(bare, 'init', '--bare'); await git(root, 'remote', 'add', 'origin', bare);
  await git(root, 'push', 'origin', 'main', 'HEAD:refs/heads/first', 'HEAD:refs/heads/second');
  // The tag is reachable from a retained remote branch, but has never been selected or pushed.
  await git(root, '-c', 'tag.gpgsign=false', 'tag', '-a', 'private-release', '-m', 'private annotation');
  await git(root, 'config', 'push.followTags', 'true');
  const localTag = await git(root, 'rev-parse', 'refs/tags/private-release');
  const snapshot = await service.snapshot(repo);
  await service.execute(repo, { type: 'remote.delete', remote: 'origin', branches: ['first', 'second'], expectedOids: { first: head, second: head }, expectedDestination: snapshot.remoteDestinations!.origin });
  expect(await git(bare, 'for-each-ref', '--format=%(refname):%(objectname)')).toBe(`refs/heads/main:${head}`);
  expect(await git(root, 'rev-parse', 'refs/tags/private-release')).toBe(localTag);
});
it('protects a remotely advanced branch without fetching while reporting partial batch deletion', async () => {
  const { root, service, repo } = await fixtures.setup();
  await commitFile(root, 'base.txt', 'base');
  const bare = path.join(root, 'remote.git'), second = path.join(root, 'second');
  await mkdir(bare); await git(bare, 'init', '--bare'); await git(root, 'remote', 'add', 'origin', bare);
  await git(root, 'push', '-u', 'origin', 'main'); await git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  await git(root, 'push', 'origin', 'HEAD:refs/heads/feature');
  await git(root, 'push', 'origin', 'HEAD:refs/heads/stable');
  await git(root, 'clone', bare, second); await git(second, 'config', 'user.name', 'Test'); await git(second, 'config', 'user.email', 'test@example.com'); await git(second, 'config', 'commit.gpgsign', 'false');
  await git(second, 'switch', 'feature');
  const expected = await git(root, 'rev-parse', 'refs/remotes/origin/feature');
  const snapshot = await service.snapshot(repo), destination = snapshot.remoteDestinations!.origin;
  const advanced = await commitFile(second, 'remote.txt', 'advanced'); await git(second, 'push');
  expect(await git(root, 'rev-parse', 'refs/remotes/origin/feature')).toBe(expected); expect(advanced).not.toBe(expected);
  await expect(service.execute(repo, { type: 'remote.delete', remote: 'origin', branches: ['stable', 'feature'], expectedOids: { stable: expected, feature: expected }, expectedDestination: destination })).rejects.toMatchObject({ code: 'PARTIAL_FAILURE', message: expect.stringContaining('1 remote branch(es) deleted; 1 failed') });
  expect(await git(bare, 'rev-parse', 'refs/heads/feature')).toBe(advanced);
  expect(await git(bare, 'for-each-ref', '--format=%(refname)', 'refs/heads/stable')).toBe('');
  // A background Fetch cannot silently move the lease the user already confirmed.
  await git(root, 'fetch');
  await expect(service.execute(repo, { type: 'push', remote: 'origin', branch: 'main', remoteBranch: 'feature', forceWithLease: true, expectedOid: expected, expectedDestination: destination })).rejects.toMatchObject({ code: 'GIT_FAILED' });
  expect(await git(bare, 'rev-parse', 'refs/heads/feature')).toBe(advanced);
  await expect(service.execute(repo, { type: 'remote.delete', remote: 'origin', branches: ['feature'] })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
  await expect(service.execute(repo, { type: 'push', remote: 'origin', branch: 'main', remoteBranch: 'feature', forceWithLease: true })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
});

it('binds absent refs and destination configuration to the original confirmation', async () => {
  const { root, service, repo } = await fixtures.setup();
  const head = await commitFile(root, 'base.txt', 'base'), bare = path.join(root, 'remote.git');
  await mkdir(bare); await git(bare, 'init', '--bare'); await git(root, 'remote', 'add', 'origin', bare);
  await service.execute(repo, { type: 'push', remote: 'origin', branch: 'main', setUpstream: true });
  const snapshot = await service.snapshot(repo), lease = captureRemoteLease(snapshot, 'origin', 'new');
  expect(lease.expectedOid).toBe('');
  const desired = await commitFile(root, 'next.txt', 'local work');
  const action = actionSchema.parse({ type: 'push', branch: 'main', forceWithLease: true, ...lease });
  // Another client creates the target after the dialog captured its absence.
  await git(root, 'push', 'origin', `${head}:refs/heads/new`);
  // Even a freshly fetched snapshot must not rewrite the captured empty expectation.
  const newer = await service.snapshot(repo); expect(captureRemoteLease(newer, 'origin', 'new').expectedOid).toBe(head); expect(lease.expectedOid).toBe('');
  await expect(service.execute(repo, action)).rejects.toMatchObject({ code: 'GIT_FAILED' });
  expect(await git(bare, 'rev-parse', 'refs/heads/new')).toBe(head);
  await service.execute(repo, { type: 'push', remote: 'origin', branch: 'main', remoteBranch: 'fresh', forceWithLease: true, expectedOid: '', expectedDestination: lease.expectedDestination });
  expect(await git(bare, 'rev-parse', 'refs/heads/fresh')).toBe(desired);
  // URLs are fingerprinted, and changing pushurl requires a new confirmation.
  expect(lease.expectedDestination).toMatch(/^[a-f0-9]{64}$/);
  await git(root, 'config', 'remote.origin.pushurl', `${bare}-changed`);
  await expect(service.execute(repo, { type: 'push', remote: 'origin', branch: 'main', remoteBranch: 'new', forceWithLease: true, expectedOid: head, expectedDestination: lease.expectedDestination })).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
  await git(root, 'config', 'remote.origin.pushurl', bare); await git(root, 'config', '--add', 'remote.origin.pushurl', bare);
  await expect(service.execute(repo, { type: 'remote.delete', remote: 'origin', branches: ['new'], expectedOids: { new: head }, expectedDestination: lease.expectedDestination })).rejects.toMatchObject({ code: 'MULTIPLE_PUSH_DESTINATIONS' });
});

it('retains confirmation when editing whitespace or selecting the same normalized destination', () => {
  const previous = { remote: 'origin', remoteBranch: 'main', expectedOid: 'old', expectedDestination: 'original' };
  const snapshot = { refs: [{ fullName: 'refs/remotes/origin/main', oid: 'new' }], remoteDestinations: { origin: 'changed' } } as unknown as import('../src/protocol/types').Snapshot;
  expect(updateRemoteLease(previous, snapshot, ' origin ', 'main ')).toBe(previous);
  expect(updateRemoteLease(previous, snapshot, 'origin', 'main')).toBe(previous);
  expect(updateRemoteLease(previous, snapshot, 'origin', 'new-branch')).toMatchObject({ remoteBranch: 'new-branch', expectedOid: '', expectedDestination: 'changed' });
});

it.each((['remote.delete', 'push', 'tag.delete'] as const).flatMap(type => (['pushurl', 'insteadOf'] as const).map(change => ({ type, change }))))('pins the confirmed destination when $change changes immediately before $type sends', async ({ type, change }) => {
  const { root, service: observer, repo } = await fixtures.setup();
  const head = await commitFile(root, 'base.txt', 'base'), first = path.join(root, 'first.git'), second = path.join(root, 'second.git');
  for (const bare of [first, second]) { await mkdir(bare); await git(bare, 'init', '--bare'); }
  await git(root, 'tag', 'release');
  for (const bare of [first, second]) await git(root, 'push', bare, 'main', 'refs/tags/release');
  await git(root, 'remote', 'add', 'origin', first);
  await git(root, 'config', 'remote.origin.pushurl', first);
  const snapshot = await observer.snapshot(repo), expectedDestination = snapshot.remoteDestinations!.origin;
  const desired = type === 'push' ? await commitFile(root, 'next.txt', 'next') : head;
  let pushes = 0;
  const service = new GitService({ environment: async (_repo, args) => {
    if (args[0] === 'push') {
      pushes++;
      if (change === 'pushurl') await git(root, 'config', 'remote.origin.pushurl', second);
      else await git(root, 'config', `url.${second}.insteadOf`, first);
    }
    return {};
  } });
  if (type === 'remote.delete') await service.execute(repo, { type, remote: 'origin', branches: ['main'], expectedOids: { main: head }, expectedDestination });
  else if (type === 'push') await service.execute(repo, { type, remote: 'origin', branch: 'main', remoteBranch: 'main', forceWithLease: true, setUpstream: true, expectedOid: head, expectedDestination });
  else await service.execute(repo, { type, name: 'release', remote: 'origin', expectedRemoteOid: head, expectedDestination });
  expect(pushes).toBe(1);
  expect(await git(root, 'config', '--get-all', 'remote.origin.pushurl')).toBe(change === 'pushurl' ? second : first);
  if (change === 'insteadOf') expect(await git(root, 'config', '--get-all', `url.${second}.insteadOf`)).toBe(first);
  expect(await git(second, 'rev-parse', 'refs/heads/main')).toBe(head);
  expect(await git(second, 'rev-parse', 'refs/tags/release')).toBe(head);
  const selected = type === 'tag.delete' ? 'refs/tags/release' : 'refs/heads/main';
  expect(await git(first, 'for-each-ref', '--format=%(objectname)', selected)).toBe(type === 'push' ? desired : '');
  if (type === 'push') {
    expect(await git(root, 'config', '--get', 'branch.main.remote')).toBe('origin');
    expect(await git(root, 'config', '--get', 'branch.main.merge')).toBe('refs/heads/main');
    expect(await git(root, 'rev-parse', 'refs/remotes/origin/main')).toBe(desired);
  }
});

it('rejects unsupported pushurl resetting before sending any push', async () => {
  const { root, service, repo } = await fixtures.setup();
  const head = await commitFile(root, 'base.txt', 'base'), bare = path.join(root, 'remote.git');
  await mkdir(bare); await git(bare, 'init', '--bare'); await git(root, 'remote', 'add', 'origin', bare);
  await git(root, 'push', 'origin', 'main');
  const snapshot = await service.snapshot(repo);
  const internal = service as unknown as { run: (repo: Repository, args: string[], allowFailure?: boolean, captureBytes?: number, execution?: { configOverrides?: [string, string][] }) => Promise<GitResult> };
  const original = internal.run.bind(service);
  const run = vi.spyOn(internal, 'run').mockImplementation(async (repository, args, allowFailure, captureBytes, execution) => {
    // Older Git appends the empty value and captured URL instead of clearing previous values.
    if (args[0] === 'remote' && args[1] === 'get-url' && execution?.configOverrides) return { stdout: Buffer.from(`${bare}\n\n${bare}\n`), stderr: Buffer.alloc(0), code: 0 };
    return original(repository, args, allowFailure, captureBytes, execution);
  });
  await expect(service.execute(repo, { type: 'push', remote: 'origin', branch: 'main', remoteBranch: 'main', forceWithLease: true, expectedOid: head, expectedDestination: snapshot.remoteDestinations!.origin })).rejects.toMatchObject({ code: 'REMOTE_BINDING_UNSUPPORTED' });
  expect(run.mock.calls.some(([, args]) => args[0] === 'push')).toBe(false);
  expect(await git(bare, 'rev-parse', 'refs/heads/main')).toBe(head);
});

it('preserves supplied system configuration while pinning a force Push destination', async () => {
  const { root, service: observer, repo } = await fixtures.setup();
  const head = await commitFile(root, 'base.txt', 'base'), bare = path.join(root, 'remote.git'), system = path.join(root, 'system.gitconfig');
  await mkdir(bare); await git(bare, 'init', '--bare'); await git(root, 'remote', 'add', 'origin', bare);
  await git(root, 'push', 'origin', 'main');
  const snapshot = await observer.snapshot(repo);
  await commitFile(root, 'next.txt', 'next');
  await git(root, 'config', '--file', system, 'protocol.file.allow', 'never');
  const service = new GitService({ environment: { GIT_CONFIG_SYSTEM: system, GIT_CONFIG_NOSYSTEM: '0' } });
  await expect(service.execute(repo, { type: 'push', remote: 'origin', branch: 'main', remoteBranch: 'main', forceWithLease: true, expectedOid: head, expectedDestination: snapshot.remoteDestinations!.origin })).rejects.toMatchObject({ code: 'GIT_FAILED', message: expect.stringContaining("transport 'file' not allowed") });
  expect(await git(bare, 'rev-parse', 'refs/heads/main')).toBe(head);
});
