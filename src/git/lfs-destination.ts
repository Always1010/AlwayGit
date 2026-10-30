import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Repository } from '../protocol/types';
import type { LfsDestinations } from '../protocol/lfs';
import { message } from '../i18n';
import { GitError } from './error';
import type { GitResult } from './runner';
export type LfsRun = (
  args: string[],
  allowFailure?: boolean,
  execution?: { root?: string; env?: NodeJS.ProcessEnv; input?: Buffer },
) => Promise<GitResult>;
interface Captured {
  config: Buffer;
  lfsconfig: Buffer;
  remotes: string[];
  destinations: LfsDestinations;
}
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function entries(buffer: Buffer): [string, string][] {
  return new TextDecoder('utf-8', { fatal: true })
    .decode(buffer)
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const split = record.indexOf('\n');
      return split < 0 ? [record, 'true'] : [record.slice(0, split), record.slice(split + 1)];
    });
}
const include = (key: string) =>
  key === 'include.path' || (key.startsWith('includeif.') && key.endsWith('.path'));
function quoted(value: string): string {
  if (/[\0\r\x01-\x07\x0b\x0c\x0e-\x1f]/.test(value))
    throw new GitError(message('lfs.endpointUnsupported'), 'LFS_ENDPOINT_UNSUPPORTED');
  return (
    '"' +
    value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
      .replace(/\x08/g, '\\b') +
    '"'
  );
}
function serialized(config: Buffer): string {
  return entries(config)
    .filter(([key]) => !include(key.toLowerCase()))
    .map(([key, value]) => {
      const first = key.indexOf('.'),
        last = key.lastIndexOf('.'),
        section = key.slice(0, first),
        name = key.slice(last + 1);
      if (
        first < 0 ||
        !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(section) ||
        !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(name)
      )
        throw new GitError(message('lfs.endpointUnsupported'), 'LFS_ENDPOINT_UNSUPPORTED');
      return `[${section}${first !== last ? ' ' + quoted(key.slice(first + 1, last)) : ''}]\n\t${name} = ${quoted(value)}\n`;
    })
    .join('');
}
async function lfsConfig(repo: Repository, run: LfsRun): Promise<Buffer> {
  try {
    const filename = path.join(repo.root, '.lfsconfig'),
      info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024)
      throw new GitError(message('lfs.endpointUnsupported'), 'LFS_ENDPOINT_UNSUPPORTED');
    return await readFile(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const object of [':.lfsconfig', 'HEAD:.lfsconfig']) {
    const content = await run(['show', object], true);
    if (!content.code) {
      if (content.stdout.length > 1024 * 1024)
        throw new GitError(message('lfs.endpointUnsupported'), 'LFS_ENDPOINT_UNSUPPORTED');
      return content.stdout;
    }
  }
  return Buffer.alloc(0);
}
export async function captureLfsDestinations(repo: Repository, run: LfsRun): Promise<Captured> {
  const config = (await run(['config', '--list', '--null', '--includes'])).stdout,
    lfsconfig = await lfsConfig(repo, run);
  const parsed = await run(['config', '--list', '--null', '--file', '-'], false, {
    input: lfsconfig,
  });
  if (entries(parsed.stdout).some(([key]) => include(key.toLowerCase())))
    throw new GitError(message('lfs.endpointUnsupported'), 'LFS_ENDPOINT_UNSUPPORTED');
  const remotes = (await run(['remote'])).stdout
      .toString('utf8')
      .trim()
      .split('\n')
      .filter(Boolean),
    destinations: LfsDestinations = {};
  for (const remote of remotes)
    destinations[remote] = {
      fetch: fingerprint([
        repo.root,
        repo.commonDir,
        remote,
        'fetch',
        config.toString('base64'),
        lfsconfig.toString('base64'),
      ]),
      push: fingerprint([
        repo.root,
        repo.commonDir,
        remote,
        'push',
        config.toString('base64'),
        lfsconfig.toString('base64'),
      ]),
    };
  return { config, lfsconfig, remotes, destinations };
}
/** Git LFS reads an immutable flattened config and .lfsconfig, preserving SSH endpoint semantics. */
export async function runBoundLfs(
  repo: Repository,
  run: LfsRun,
  remote: string,
  direction: 'fetch' | 'push',
  expected: string,
  args: string[],
): Promise<void> {
  const captured = await captureLfsDestinations(repo, run);
  if (captured.destinations[remote]?.[direction] !== expected)
    throw new GitError(message('lfs.destinationChanged'), 'OPERATION_CHANGED');
  const directory = await mkdtemp(path.join(tmpdir(), 'alwaygit-lfs-operation-'));
  const cleanup = () => rm(directory, { recursive: true, force: true, maxRetries: 3 });
  let deferred = false;
  try {
    const config = path.join(directory, 'config'),
      empty = path.join(directory, 'empty-config');
    await writeFile(config, serialized(captured.config), { mode: 0o600 });
    await writeFile(empty, '', { mode: 0o600 });
    await writeFile(path.join(directory, '.lfsconfig'), captured.lfsconfig, { mode: 0o600 });
    await run(args, false, {
      root: directory,
      env: {
        GIT_DIR: repo.gitDir ?? repo.commonDir,
        GIT_WORK_TREE: directory,
        GIT_INDEX_FILE: path.join(directory, 'index'),
        GIT_CONFIG: config,
        GIT_CONFIG_GLOBAL: empty,
        GIT_CONFIG_SYSTEM: empty,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_COUNT: '0',
        GIT_CONFIG_PARAMETERS: undefined,
        GIT_COMMON_DIR: undefined,
      },
    });
  } catch (error) {
    const completion = (error as { completion?: Promise<void> }).completion;
    if (completion) {
      deferred = true;
      void completion.then(cleanup, cleanup).catch(() => {});
    }
    throw error;
  } finally {
    if (!deferred) await cleanup();
  }
}
