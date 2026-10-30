import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LfsManager } from '../src/git/lfs';
import type { LfsRun } from '../src/git/lfs-destination';
import type { Repository } from '../src/protocol/types';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== path.resolve(os.tmpdir()) ||
      !path.basename(root).startsWith('alwaygit-index-lfs-')
    )
      throw new Error('Unsafe cleanup target');
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

async function fixture() {
  const root = path.resolve(await mkdtemp(path.join(os.tmpdir(), 'alwaygit-index-lfs-')));
  roots.push(root);
  const bytes = Buffer.from('verified Index LFS entity\n'),
    oid = createHash('sha256').update(bytes).digest('hex');
  const pointer = Buffer.from(
    `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${bytes.length}\n`,
  );
  const media = path.join(root, 'configured-storage', 'objects'),
    filename = path.join(media, oid.slice(0, 2), oid.slice(2, 4), oid);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, bytes);
  const repo: Repository = {
      id: 'index-lfs',
      root,
      commonDir: path.join(root, '.git'),
      name: 'Fixture',
    },
    manager = new LfsManager();
  const blob = 'a'.repeat(40),
    state = { mode: '100644' };
  const run = vi.fn<LfsRun>(async (args) => {
    let stdout: Buffer;
    if (args[0] === 'ls-files')
      stdout = Buffer.from(
        [0, 2, 3].map((stage) => `${state.mode} ${blob} ${stage}\tasset\0`).join(''),
      );
    else if (args[0] === 'cat-file' && args[1] === '-s')
      stdout = Buffer.from(String(pointer.length));
    else if (args[0] === 'cat-file' && args[1] === 'blob') stdout = pointer;
    else if (args[0] === 'lfs' && args[1] === 'env')
      stdout = Buffer.from(`LocalMediaDir=${media}\n`);
    else throw new Error(`Unexpected Git operation: ${args.join(' ')}`);
    return { stdout, stderr: Buffer.alloc(0), code: 0 };
  });
  return { repo, manager, bytes, oid, filename, state, run };
}

it('reads verified configured cache bytes for Index stages 0, 2 and 3 without mutating Git', async () => {
  const test = await fixture();
  for (const stage of [0, 2, 3] as const) {
    const request = { path: 'asset', stage };
    expect(await test.manager.indexObject(test.repo, request, test.run, test.bytes.length)).toEqual(
      {
        ...request,
        oid: test.oid,
        size: test.bytes.length,
        localObject: 'available',
        content: test.bytes,
      },
    );
  }
  expect(
    await test.manager.indexObject(test.repo, { path: 'asset' }, test.run, test.bytes.length - 1),
  ).toEqual({ path: 'asset', oid: test.oid, size: test.bytes.length, localObject: 'available' });
  test.state.mode = '120000';
  await expect(
    test.manager.indexObject(test.repo, { path: 'asset' }, test.run, 1024),
  ).rejects.toMatchObject({ code: 'INVALID_PATH' });
});

it('keeps missing and corrupt local entities unavailable and validates pointer and read limits', async () => {
  const test = await fixture(),
    pointer = { oid: test.oid, size: test.bytes.length };
  await writeFile(test.filename, Buffer.alloc(test.bytes.length, 65));
  expect(await test.manager.indexObject(test.repo, { path: 'asset' }, test.run, 1024)).toEqual({
    path: 'asset',
    ...pointer,
    localObject: 'unknown',
  });
  await rm(test.filename);
  expect(await test.manager.localObject(pointer, test.run, 1024)).toEqual({
    ...pointer,
    localObject: 'missing',
  });
  await expect(
    test.manager.localObject({ ...pointer, oid: '../escape' }, test.run, 1024),
  ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  await expect(test.manager.localObject(pointer, test.run, -1)).rejects.toMatchObject({
    code: 'INVALID_ARGUMENT',
  });
});
