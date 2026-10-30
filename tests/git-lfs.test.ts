import { afterEach, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, rm, rename, symlink } from 'node:fs/promises';
import path from 'node:path';
import { gitFixtures, git } from './support/git-fixture';
import { parseLfsPointer } from '../src/git/lfs';
import { isReadOnlyGitCommand } from '../src/git/command-kind';
import { readQueryCategory } from '../src/protocol/queries';
import { actionSchema } from '../src/protocol/validation';
import { GitService } from '../src/git/service';
const fixtures = gitFixtures('alwaygit-lfs-');
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await fixtures.cleanup();
});
let installed = false;
try {
  installed = /^git-lfs\//.test(
    execFileSync('git', ['lfs', 'version'], {
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  );
} catch {
  /* Read-only prerequisite detection; never install tools. */
}
async function endpoint() {
  const objects = new Map<string, Buffer>(),
    requests: { operation: string; oid: string }[] = [];
  let url = '';
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      if (request.url === '/lfs/objects/batch') {
        const batch = JSON.parse(body.toString('utf8')) as {
          operation: string;
          objects: { oid: string; size: number }[];
        };
        response.setHeader('Content-Type', 'application/vnd.git-lfs+json');
        response.end(
          JSON.stringify({
            transfer: 'basic',
            objects: batch.objects.map((object) => {
              requests.push({ operation: batch.operation, oid: object.oid });
              if (batch.operation === 'download')
                return objects.has(object.oid)
                  ? { ...object, actions: { download: { href: `${url}/objects/${object.oid}` } } }
                  : { ...object, error: { code: 404, message: 'object missing' } };
              return objects.has(object.oid)
                ? object
                : { ...object, actions: { upload: { href: `${url}/objects/${object.oid}` } } };
            }),
          }),
        );
        return;
      }
      const oid = /^\/objects\/([a-f0-9]{64})$/.exec(request.url ?? '')?.[1];
      if (oid && request.method === 'PUT') {
        if (createHash('sha256').update(body).digest('hex') !== oid)
          throw new Error('Invalid LFS payload');
        objects.set(oid, body);
        response.end();
        return;
      }
      if (oid && request.method === 'GET' && objects.has(oid)) {
        const object = objects.get(oid)!;
        response.setHeader('Content-Length', object.length);
        response.end(object);
        return;
      }
      response.writeHead(404);
      response.end();
    } catch {
      response.writeHead(500);
      response.end();
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url, objects, requests };
}
it('validates LFS requests and classifies status as read-only while keeping transfers out of read scopes', () => {
  expect(
    parseLfsPointer(
      Buffer.from(
        `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 12\n`,
      ),
    ),
  ).toEqual({ oid: 'a'.repeat(64), size: 12 });
  expect(
    parseLfsPointer(
      Buffer.from(
        `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 9007199254740992\n`,
      ),
    ),
  ).toBeUndefined();
  for (const command of ['status', 'ls-files', 'env', 'version'])
    expect(isReadOnlyGitCommand(['lfs', command])).toBe(true);
  for (const command of ['fetch', 'checkout', 'pull', 'push', 'prune', 'track'])
    expect(isReadOnlyGitCommand(['lfs', command])).toBe(false);
  expect(readQueryCategory('lfsStatus')).toBe('lfsStatus');
  expect(readQueryCategory('lfsHistoricalStatus')).toBe('lfsHistoricalStatus');
  expect(
    actionSchema.safeParse({
      type: 'lfs.fetchHistorical',
      revision: 'HEAD',
      path: 'file.bin',
      oid: 'a'.repeat(64),
      remote: 'origin',
    }).success,
  ).toBe(false);
  expect(
    actionSchema.safeParse({
      type: 'lfs.fetch',
      remote: '--all',
      expectedHead: '',
      expectedBranch: '',
    }).success,
  ).toBe(false);
  expect(actionSchema.safeParse({ type: 'lfs.prune' }).success).toBe(false);
});
it('previews literal and glob attributes without staging and protects unrelated rules and changed previews', async () => {
  const { root, repo, service } = await fixtures.setup();
  const source = '# preserve me\n*.txt text eol=lf\n';
  await writeFile(path.join(root, '.gitattributes'), source);
  await git(root, 'add', '.gitattributes');
  const index = await readFile(path.join(root, '.git/index'));
  const preview = await service.lfsTrackPreview(repo, {
    pattern: 'asset[1].bin',
    literal: true,
    operation: 'track',
  });
  expect(await readFile(path.join(root, '.gitattributes'), 'utf8')).toBe(source);
  await service.execute(repo, { type: 'lfs.track', token: preview.token });
  expect(await readFile(path.join(root, '.git/index'))).toEqual(index);
  expect(await git(root, 'check-attr', 'filter', '--', 'asset[1].bin')).toContain('filter: lfs');
  expect(await git(root, 'check-attr', 'filter', '--', 'asset1.bin')).toContain(
    'filter: unspecified',
  );
  expect(await git(root, 'check-attr', 'filter', '--', 'nested/asset[1].bin')).toContain(
    'filter: unspecified',
  );
  const untrack = await service.lfsTrackPreview(repo, {
    pattern: 'asset[1].bin',
    literal: true,
    operation: 'untrack',
  });
  await service.execute(repo, { type: 'lfs.track', token: untrack.token });
  expect(await readFile(path.join(root, '.gitattributes'), 'utf8')).toBe(source);
  const hashPattern = { pattern: '#*.dat', literal: false };
  const hashRule = await service.lfsTrackPreview(repo, { ...hashPattern, operation: 'track' });
  expect(hashRule.after).toContain('"#*.dat" filter=lfs diff=lfs merge=lfs -text');
  await service.execute(repo, { type: 'lfs.track', token: hashRule.token });
  expect(await git(root, 'check-attr', 'filter', '--', '#a.dat')).toContain('filter: lfs');
  expect(await git(root, 'check-attr', 'filter', '--', 'a.dat')).toContain('filter: unspecified');
  const untrackHash = await service.lfsTrackPreview(repo, { ...hashPattern, operation: 'untrack' });
  await service.execute(repo, { type: 'lfs.track', token: untrackHash.token });
  expect(await git(root, 'check-attr', 'filter', '--', '#a.dat')).toContain('filter: unspecified');
  expect(await readFile(path.join(root, '.gitattributes'), 'utf8')).toBe(source);
  const mixed =
    '\uFEFF# preserve CRLF\r\n*.txt text\n*.bin filter=lfs diff=lfs merge=lfs -text\r\n# keep trailing';
  await writeFile(path.join(root, '.gitattributes'), mixed);
  const exact = await service.lfsTrackPreview(repo, {
    pattern: '*.bin',
    literal: false,
    operation: 'untrack',
  });
  await service.execute(repo, { type: 'lfs.track', token: exact.token });
  expect(await readFile(path.join(root, '.gitattributes'), 'utf8')).toBe(
    mixed.replace('*.bin filter=lfs diff=lfs merge=lfs -text\r\n', ''),
  );
  const stale = await service.lfsTrackPreview(repo, {
    pattern: '*.bin',
    literal: false,
    operation: 'track',
  });
  await writeFile(path.join(root, '.gitattributes'), source + '# external edit\n');
  await expect(
    service.execute(repo, { type: 'lfs.track', token: stale.token }),
  ).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
  expect(await readFile(path.join(root, '.gitattributes'), 'utf8')).toContain('# external edit');
  await expect(
    service.lfsTrackPreview(repo, { pattern: '../outside', literal: true, operation: 'track' }),
  ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  for (const filename of ['-literal.bin', '!literal.bin']) {
    const literal = await service.lfsTrackPreview(repo, {
      pattern: filename,
      literal: true,
      operation: 'track',
    });
    await service.execute(repo, { type: 'lfs.track', token: literal.token });
    expect(await git(root, 'check-attr', 'filter', '--', filename)).toContain('filter: lfs');
  }
  await expect(
    service.lfsTrackPreview(repo, { pattern: 'trailing.bin ', literal: true, operation: 'track' }),
  ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  await git(root, 'commit', '-m', 'base attributes');
  const changedBranch = await service.lfsTrackPreview(repo, {
    pattern: '*.pdf',
    literal: false,
    operation: 'track',
  });
  await git(root, 'checkout', '-b', 'topic');
  await expect(
    service.execute(repo, { type: 'lfs.track', token: changedBranch.token }),
  ).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
});
it.skipIf(!installed)(
  'uploads to a real local LFS endpoint, separates selected fetch/cache checkout/pull, and preserves dirty files',
  async () => {
    const { root, repo, service } = await fixtures.setup(),
      server = await endpoint();
    await git(root, 'config', 'filter.lfs.process', 'git-lfs filter-process');
    await git(root, 'config', 'filter.lfs.required', 'true');
    await git(root, 'config', 'lfs.url', `${server.url}/lfs`);
    await git(root, 'remote', 'add', 'origin', `${server.url}/repo.git`);
    const preview = await service.lfsTrackPreview(repo, {
      pattern: '*.bin',
      literal: false,
      operation: 'track',
    });
    await service.execute(repo, { type: 'lfs.track', token: preview.token });
    const contents = ['first LFS payload\n', 'second LFS payload\n'],
      names = ['asset[1].bin', 'asset1.bin'];
    for (let i = 0; i < names.length; i++) await writeFile(path.join(root, names[i]), contents[i]);
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'LFS files');
    const head = await git(root, 'rev-parse', 'HEAD'),
      context = { expectedHead: head, expectedBranch: 'main' };
    const initial = await service.withReadSignal(new AbortController().signal, () =>
      service.lfsStatus(repo),
    );
    expect(initial.available).toBe(true);
    expect(initial.filterConfigured).toBe(true);
    expect(initial.files).toHaveLength(2);
    expect(
      initial.files.every(
        (file) =>
          file.oid.length === 64 && file.worktree === 'content' && file.localObject === 'available',
      ),
    ).toBe(true);
    expect(initial.remoteAvailability).toBe('unknown');
    expect(server.requests).toEqual([]);
    await service.execute(repo, {
      type: 'lfs.push',
      remote: 'origin',
      expectedDestination: initial.destinations.origin.push,
      ...context,
    });
    expect(server.objects.size).toBe(2);
    expect(await git(root, 'rev-parse', 'HEAD')).toBe(head);
    const pointer = await git(root, 'show', `HEAD:${names[0]}`),
      pointer2 = await git(root, 'show', `HEAD:${names[1]}`);
    await writeFile(path.join(root, names[0]), pointer + '\n');
    await writeFile(path.join(root, names[1]), pointer2 + '\n');
    for (const file of initial.files) {
      const cache = path.join(
        repo.commonDir,
        'lfs/objects',
        file.oid.slice(0, 2),
        file.oid.slice(2, 4),
        file.oid,
      );
      await rm(cache);
    }
    const missing = await service.lfsStatus(repo);
    expect(
      missing.files.every((file) => file.worktree === 'pointer' && file.localObject === 'missing'),
    ).toBe(true);
    const first = initial.files.find((file) => file.path === names[0])!;
    const beforeCheckout = server.requests.length;
    await service.execute(repo, { type: 'lfs.checkout', ...context });
    expect(server.requests).toHaveLength(beforeCheckout);
    expect(await readFile(path.join(root, names[0]), 'utf8')).toContain('version https://git-lfs');
    await service.execute(repo, {
      type: 'lfs.fetch',
      remote: 'origin',
      expectedDestination: initial.destinations.origin.fetch,
      oids: [first.oid],
      ...context,
    });
    expect(
      server.requests
        .filter((request) => request.operation === 'download')
        .map((request) => request.oid),
    ).toEqual([first.oid]);
    expect(await readFile(path.join(root, names[0]), 'utf8')).toContain('version https://git-lfs');
    await service.execute(repo, { type: 'lfs.checkout', ...context });
    expect(await readFile(path.join(root, names[0]), 'utf8')).toBe(contents[0]);
    expect(await readFile(path.join(root, names[1]), 'utf8')).toContain('version https://git-lfs');
    await writeFile(path.join(root, names[0]), 'keep dirty content');
    await service.execute(repo, {
      type: 'lfs.pull',
      remote: 'origin',
      expectedDestination: initial.destinations.origin.fetch,
      ...context,
    });
    expect(await readFile(path.join(root, names[0]), 'utf8')).toBe('keep dirty content');
    expect(await readFile(path.join(root, names[1]), 'utf8')).toBe(contents[1]);
    const changed = await service.lfsStatus(repo);
    expect(changed.files.find((file) => file.path === names[0])?.unstaged).toBe(true);
    await git(root, 'add', '--', names[0]);
    expect(
      (await service.lfsStatus(repo)).files.find((file) => file.path === names[0])?.staged,
    ).toBe(true);
    await expect(
      service.execute(repo, {
        type: 'lfs.push',
        remote: 'origin',
        expectedDestination: initial.destinations.origin.push,
        ...context,
        expectedBranch: 'changed',
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
  },
  60000,
);
it.skipIf(!installed)(
  'fetches only a pinned historical LFS object into configured storage and returns bounded verified cache bytes',
  async () => {
    const { root, repo, service } = await fixtures.setup(),
      server = await endpoint();
    const storage = path.join(root, '.git', 'custom-lfs');
    await git(root, 'config', 'filter.lfs.process', 'git-lfs filter-process');
    await git(root, 'config', 'filter.lfs.required', 'true');
    await git(root, 'config', 'lfs.url', `${server.url}/lfs`);
    await git(root, 'config', 'lfs.storage', storage);
    await git(root, 'remote', 'add', 'origin', `${server.url}/repo.git`);
    const filename = 'history[1].bin',
      other = 'history1.bin',
      historical = Buffer.from('historical payload\n'),
      unrelated = Buffer.from('unrelated historical payload\n');
    await writeFile(
      path.join(root, '.gitattributes'),
      '*.bin filter=lfs diff=lfs merge=lfs -text\n',
    );
    await writeFile(path.join(root, filename), historical);
    await writeFile(path.join(root, other), unrelated);
    await writeFile(path.join(root, 'plain.txt'), 'ordinary text');
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'historical LFS');
    const revision = await git(root, 'rev-parse', 'HEAD');
    const oid = createHash('sha256').update(historical).digest('hex'),
      otherOid = createHash('sha256').update(unrelated).digest('hex');
    server.objects.set(oid, historical);
    server.objects.set(otherOid, unrelated);
    await writeFile(path.join(root, filename), 'current committed version');
    await git(root, 'rm', '--', other);
    await git(root, 'add', filename);
    await git(root, 'commit', '-m', 'replace historical LFS');
    const head = await git(root, 'rev-parse', 'HEAD');
    expect((await service.lfsStatus(repo)).files.some((file) => file.oid === oid)).toBe(false);
    await writeFile(path.join(root, filename), 'keep current dirty content');
    await writeFile(path.join(root, 'note.txt'), 'keep staged content');
    await git(root, 'add', 'note.txt');
    const index = await readFile(path.join(root, '.git', 'index')),
      cache = path.join(storage, 'objects', oid.slice(0, 2), oid.slice(2, 4), oid);
    for (const value of [oid, otherOid])
      await rm(path.join(storage, 'objects', value.slice(0, 2), value.slice(2, 4), value));
    const request = { revision, path: filename },
      expectedDestination = (await service.lfsDestinations(repo)).origin.fetch;
    const missing = await service.withReadSignal(new AbortController().signal, () =>
      service.lfsHistoricalObject(repo, request, 1024),
    );
    expect(missing).toEqual({ ...request, oid, size: historical.length, localObject: 'missing' });
    expect(server.requests).toEqual([]);
    await expect(
      service.execute(repo, {
        type: 'lfs.fetchHistorical',
        ...request,
        oid: otherOid,
        remote: 'origin',
        expectedDestination,
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
    const redirectedServer = await endpoint();
    const frozen = new GitService({
      environment: async (_repository, args) => {
        if (args[0] === 'lfs' && args[1] === 'fetch') {
          await git(root, 'config', 'lfs.url', `${redirectedServer.url}/lfs`);
          await git(root, 'config', 'remote.origin.url', `${redirectedServer.url}/repo.git`);
          await git(root, 'config', `url.${redirectedServer.url}/.insteadOf`, server.url + '/');
          await writeFile(
            path.join(root, '.lfsconfig'),
            `[lfs]\nurl = ${redirectedServer.url}/lfs\n`,
          );
        }
        return {};
      },
    });
    await frozen.execute(repo, {
      type: 'lfs.fetchHistorical',
      ...request,
      oid,
      remote: 'origin',
      expectedDestination,
    });
    expect(redirectedServer.requests).toEqual([]);
    expect(server.requests).toEqual([{ operation: 'download', oid }]);
    await expect(
      service.execute(repo, {
        type: 'lfs.fetchHistorical',
        ...request,
        oid,
        remote: 'origin',
        expectedDestination,
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_CHANGED' });
    expect(await readFile(path.join(root, filename), 'utf8')).toBe('keep current dirty content');
    expect(await readFile(path.join(root, 'note.txt'), 'utf8')).toBe('keep staged content');
    expect(await readFile(path.join(root, '.git', 'index'))).toEqual(index);
    expect(await git(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(await service.lfsHistoricalObject(repo, request)).toEqual({
      ...request,
      oid,
      size: historical.length,
      localObject: 'available',
    });
    expect(
      await service.lfsHistoricalObject(repo, request, historical.length - 1),
    ).not.toHaveProperty('content');
    expect((await service.lfsHistoricalObject(repo, request, historical.length)).content).toEqual(
      historical,
    );
    expect(server.requests).toHaveLength(1);
    await expect(
      service.lfsHistoricalObject(repo, { revision, path: 'plain.txt' }, 1024),
    ).rejects.toMatchObject({ code: 'LFS_NOT_POINTER' });
    await expect(service.lfsHistoricalObject(repo, request, -1)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await writeFile(cache, Buffer.alloc(historical.length, 66));
    expect(await service.lfsHistoricalObject(repo, request, historical.length)).toEqual({
      ...request,
      oid,
      size: historical.length,
      localObject: 'unknown',
    });
    await writeFile(cache, historical);
    const directory = path.join(storage, 'objects', oid.slice(0, 2)),
      redirected = path.join(storage, 'redirected-objects');
    await rename(directory, redirected);
    await symlink(redirected, directory, process.platform === 'win32' ? 'junction' : 'dir');
    expect(await service.lfsHistoricalObject(repo, request, historical.length)).toEqual({
      ...request,
      oid,
      size: historical.length,
      localObject: 'unknown',
    });
    expect(server.requests).toHaveLength(1);
    expect(await readFile(path.join(root, '.git', 'index'))).toEqual(index);
  },
  60000,
);
