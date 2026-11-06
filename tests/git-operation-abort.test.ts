import { afterEach, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GitService } from '../src/git/service';
import { actionSchema } from '../src/protocol/validation';
import { commitFile, git, gitFixtures } from './support/git-fixture';

const fixtures = gitFixtures('alwaygit-abort-');
afterEach(fixtures.cleanup);

async function pausedMerge() {
  const fixture = await fixtures.setup(),
    { root } = fixture;
  const base = await commitFile(root, 'file.txt', 'base\n');
  await git(root, 'switch', '-c', 'topic');
  await commitFile(root, 'file.txt', 'incoming\n');
  await git(root, 'switch', '-c', 'other', base);
  await commitFile(root, 'file.txt', 'other incoming\n');
  await git(root, 'switch', 'main');
  const original = await commitFile(root, 'file.txt', 'ours\n');
  await expect(git(root, 'merge', 'topic')).rejects.toThrow();
  return { ...fixture, original };
}
async function workingState(root: string) {
  return {
    head: await git(root, 'rev-parse', 'HEAD'),
    index: await git(root, 'ls-files', '--stage'),
    content: await readFile(path.join(root, 'file.txt'), 'utf8'),
    mergeHead: await git(root, 'rev-parse', 'MERGE_HEAD'),
  };
}

it.each(['topic', 'other'])(
  'rejects an old Merge confirmation after starting a new merge of %s',
  async (target) => {
    const { root, repo, service } = await pausedMerge();
    const action = await service.prepareAction(repo, { type: 'operation.abort', kind: 'merge' });
    await git(root, 'merge', '--abort');
    await expect(git(root, 'merge', target)).rejects.toThrow();
    await writeFile(path.join(root, 'file.txt'), 'new operation resolution\n');
    const before = await workingState(root);
    await expect(service.execute(repo, action)).rejects.toMatchObject({
      code: 'OPERATION_CHANGED',
    });
    expect(await workingState(root)).toEqual(before);
  },
);

it.each(['unstaged', 'staged'])(
  'rejects %s resolution changes after native confirmation was prepared, then accepts fresh confirmation',
  async (area) => {
    const { root, repo, service, original } = await pausedMerge();
    await writeFile(path.join(root, 'file.txt'), 'first resolution\n');
    await git(root, 'add', 'file.txt');
    const action = await service.prepareAction(repo, { type: 'operation.abort', kind: 'merge' });
    await writeFile(path.join(root, 'file.txt'), 'new resolution\n');
    if (area === 'staged') await git(root, 'add', 'file.txt');
    const before = await workingState(root);
    await expect(service.execute(repo, action)).rejects.toMatchObject({
      code: 'OPERATION_CHANGED',
    });
    expect(await workingState(root)).toEqual(before);
    // Git merge --abort itself refuses a staged result with additional unstaged edits.
    // Stage the preserved resolution before capturing a new, executable confirmation.
    if (area === 'unstaged') await git(root, 'add', 'file.txt');
    const fresh = await service.prepareAction(repo, { type: 'operation.abort', kind: 'merge' });
    await service.execute(repo, fresh);
    expect((await service.snapshot(repo)).operation.kind).toBeUndefined();
    expect(await git(root, 'rev-parse', 'HEAD')).toBe(original);
    expect(await git(root, 'status', '--porcelain')).toBe('');
    await expect(service.execute(repo, fresh)).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
  },
);

it('rejects missing, fabricated and cross-repository Abort tokens', async () => {
  const first = await pausedMerge(),
    second = await pausedMerge();
  const prepared = await first.service.prepareAction(first.repo, {
    type: 'operation.abort',
    kind: 'merge',
  });
  const before = await workingState(second.root);
  for (const action of [
    { type: 'operation.abort' as const, kind: 'merge' as const },
    { type: 'operation.abort' as const, kind: 'merge' as const, abortToken: 'fabricated' },
    prepared,
  ])
    await expect(second.service.execute(second.repo, action)).rejects.toMatchObject({
      code: 'OPERATION_CHANGED',
    });
  expect(await workingState(second.root)).toEqual(before);
  expect(actionSchema.parse(prepared)).toEqual(prepared);
});

it('revalidates Abort inside the shared write queue after another write', async () => {
  const { root, repo } = await pausedMerge();
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((resolve) => (started = resolve)),
    waiting = new Promise<void>((resolve) => (release = resolve));
  const service = new GitService({
    environment: async (_repo, args) => {
      if (args[0] === 'add') {
        started();
        await waiting;
      }
      return {};
    },
  });
  const action = await service.prepareAction(repo, { type: 'operation.abort', kind: 'merge' });
  await writeFile(path.join(root, 'file.txt'), 'queued resolution\n');
  const stage = service.execute(repo, { type: 'stage', paths: ['file.txt'] });
  await ready;
  const rejected = expect(service.execute(repo, action)).rejects.toMatchObject({
    code: 'OPERATION_CHANGED',
  });
  release();
  await stage;
  await rejected;
  expect((await service.snapshot(repo)).operation.kind).toBe('merge');
  expect(await git(root, 'show', ':file.txt')).toBe('queued resolution');
});

it('rechecks changed content immediately before Git starts Abort', async () => {
  const { root, repo } = await pausedMerge();
  let raced = false;
  const service = new GitService({
    environment: async (_repo, args) => {
      if (args[0] === 'merge' && args[1] === '--abort') {
        raced = true;
        await writeFile(path.join(root, 'file.txt'), 'last moment resolution\n');
      }
      return {};
    },
  });
  const action = await service.prepareAction(repo, { type: 'operation.abort', kind: 'merge' });
  await expect(service.execute(repo, action)).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
  expect(raced).toBe(true);
  expect((await service.snapshot(repo)).operation.kind).toBe('merge');
  expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('last moment resolution\n');
});

it('preserves managed Rebase helpers when the final Abort check rejects changed content', async () => {
  const { root, repo } = await fixtures.setup();
  let raced = false;
  const service = new GitService({
    environment: async (_repo, args) => {
      if (!raced && args[0] === 'rebase' && args[1] === '--abort') {
        raced = true;
        await writeFile(path.join(root, 'file.txt'), 'managed resolution\n');
      }
      return {};
    },
  });
  await commitFile(root, 'file.txt', 'base\n');
  const first = await commitFile(root, 'file.txt', 'first\n'),
    second = await commitFile(root, 'file.txt', 'second\n');
  const plan = await service.prepareInteractiveRebase(repo, first);
  await expect(
    service.execute(repo, {
      type: 'rebase.interactive',
      token: plan.token,
      steps: [
        { oid: second, action: 'pick' },
        { oid: first, action: 'pick' },
      ],
      acknowledgePublished: false,
    }),
  ).rejects.toThrow();
  const manifestPath = path.join(repo.gitDir!, 'alwaygit-interactive-rebase/manifest.json'),
    manifest = await readFile(manifestPath, 'utf8');
  const action = await service.prepareAction(repo, { type: 'operation.abort', kind: 'rebase' });
  await expect(service.execute(repo, action)).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
  expect(raced).toBe(true);
  expect(await readFile(manifestPath, 'utf8')).toBe(manifest);
  expect((await service.snapshot(repo)).operation.managedRebase?.pause).toBe('conflict');
  await service.execute(
    repo,
    await service.prepareAction(repo, { type: 'operation.abort', kind: 'rebase' }),
  );
  expect(await git(root, 'rev-parse', 'HEAD')).toBe(plan.head);
  expect((await service.snapshot(repo)).operation.kind).toBeUndefined();
  await expect(readFile(manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.skipIf(process.platform === 'win32')(
  'pins ORIG_HEAD in a separate Git directory with trailing whitespace before aborting Merge',
  async () => {
    const { root: parent, service } = await fixtures.setup();
    const root = path.join(parent, 'worktree'),
      gitDir = path.join(parent, 'metadata ');
    await mkdir(root);
    await git(root, 'init', '-b', 'main', `--separate-git-dir=${gitDir}`);
    await git(root, 'config', 'user.name', 'Path Test');
    await git(root, 'config', 'user.email', 'path@example.com');
    await git(root, 'config', 'commit.gpgsign', 'false');
    const repo = await service.discover(root);
    const base = await commitFile(root, 'file.txt', 'base\n');
    await git(root, 'switch', '-c', 'topic');
    await commitFile(root, 'file.txt', 'incoming\n');
    await git(root, 'switch', 'main');
    const original = await commitFile(root, 'file.txt', 'ours\n');
    await expect(git(root, 'merge', 'topic')).rejects.toThrow();
    const action = await service.prepareAction(repo, { type: 'operation.abort', kind: 'merge' });
    await git(root, 'update-ref', 'ORIG_HEAD', base);
    const before = await workingState(root);
    await expect(service.execute(repo, action)).rejects.toMatchObject({
      code: 'OPERATION_CHANGED',
    });
    expect(await workingState(root)).toEqual(before);
    await git(root, 'update-ref', 'ORIG_HEAD', original);
    await service.execute(
      repo,
      await service.prepareAction(repo, { type: 'operation.abort', kind: 'merge' }),
    );
    expect((await service.snapshot(repo)).operation.kind).toBeUndefined();
    expect(await git(root, 'rev-parse', 'HEAD')).toBe(original);
    expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('ours\n');
  },
);
