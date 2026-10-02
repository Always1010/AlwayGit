import { it, expect, afterEach } from 'vitest';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { gitFixtures, git, commitFile } from './support/git-fixture';
import { captureRemoteLease, updateRemoteLease } from '../webview/remoteLease';
import { actionSchema } from '../src/protocol/validation';
const fixtures = gitFixtures('alwaygit-lease-test-');
afterEach(fixtures.cleanup);
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
