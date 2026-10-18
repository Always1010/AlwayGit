import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { message } from '../i18n';
import type { Repository } from '../protocol/types';
import { lfsHistoricalRequestSchema, lfsTrackRequestSchema, type LfsAction, type LfsFile, type LfsHistoricalObject, type LfsHistoricalRequest, type LfsStatus, type LfsTrackPreview, type LfsTrackRequest } from '../protocol/lfs';
import { redactSecrets } from '../application/logging';
import { safeWorkingPath } from '../editor/paths';
import { GitError } from './error';
import { captureLfsDestinations, runBoundLfs, type LfsRun } from './lfs-destination';
type Run = LfsRun;
export function parseLfsPointer(content: Buffer): { oid: string; size: number } | undefined {
  if (content.length > 1024) return;
  const text = content.toString('utf8');
  if (!text.startsWith('version https://git-lfs.github.com/spec/v1\n') && !text.startsWith('version https://git-lfs.github.com/spec/v1\r\n')) return;
  const oid = /^oid sha256:([a-f0-9]{64})\r?$/m.exec(text)?.[1], size = /^size (0|[1-9][0-9]*)\r?$/m.exec(text)?.[1];
  if (oid && size && Number.isSafeInteger(Number(size))) return { oid, size: Number(size) };
}
function validPath(value: string): boolean { return !!value && !/[\0\r\n]/.test(value) && !path.isAbsolute(value) && !(process.platform === 'win32' && /^[A-Za-z]:/.test(value)) && !value.split(process.platform === 'win32' ? /[\\/]/ : /\//).some(piece => piece === '..' || piece === '.' || /^\.git[. ]*$/i.test(piece)); }
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const normalized = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const fetchInclude = (name: string) => '/' + name.replace(/[\\\[\]*?]/g, '\\$&');
async function currentContext(run: Run): Promise<{ head?: string; branch: string }> {
  const head = await run(['rev-parse', '--verify', 'HEAD'], true), branch = await run(['symbolic-ref', '--quiet', '--short', 'HEAD'], true);
  return { head: head.code ? undefined : head.stdout.toString('utf8').trim(), branch: branch.code ? '' : branch.stdout.toString('utf8').trim() };
}
/** Configured storage may be outside the repository, but cache paths must not redirect. */
async function cachedObject(media: string | undefined, oid: string, size: number, maxBytes = 0): Promise<Pick<LfsHistoricalObject, 'localObject' | 'content'>> {
  if (!media || !path.isAbsolute(media)) return { localObject: 'unknown' };
  try {
    const canonicalMedia = await realpath(media); if ((await lstat(media)).isSymbolicLink()) return { localObject: 'unknown' }; media = canonicalMedia;
    for (const directory of [media, path.join(media, oid.slice(0, 2)), path.join(media, oid.slice(0, 2), oid.slice(2, 4))]) {
      const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) return { localObject: 'unknown' };
    }
    const filename = path.join(media, oid.slice(0, 2), oid.slice(2, 4), oid), before = await lstat(filename);
    if (!before.isFile() || before.isSymbolicLink() || before.size !== size) return { localObject: 'unknown' };
    if (!maxBytes || size > maxBytes) return { localObject: 'available' };
    const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size !== size || info.dev !== before.dev || info.ino !== before.ino || normalized(await realpath(filename)) !== normalized(filename)) return { localObject: 'unknown' };
      const bytes = Buffer.alloc(size + 1); let length = 0;
      while (length < bytes.length) { const read = await handle.read(bytes, length, bytes.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
      const content = bytes.subarray(0, length);
      if (length !== size || digest(content) !== oid) return { localObject: 'unknown' };
      return { localObject: 'available', content };
    } finally { await handle.close(); }
  } catch (error) { return { localObject: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unknown' }; }
}
/** Every mutation enters GitService's repository queue; status never downloads objects. */
export class LfsManager {
  private readonly plans = new Map<string, { root: string; commonDir: string; head?: string; branch: string; before: Buffer; after: string; expires: number }>();
  async status(repo: Repository, run: Run): Promise<LfsStatus> {
    const context = await currentContext(run);
    const version = await run(['lfs', 'version'], true);
    const configured = await run(['config', '--get', 'filter.lfs.process'], true);
    const result: LfsStatus = { ...context, destinations: {}, available: !version.code, version: version.code ? undefined : version.stdout.toString('utf8').trim(), filterConfigured: !configured.code && !!configured.stdout.length, files: [], statusText: '', checkedAt: Date.now(), remoteAvailability: 'unknown', truncated: false };
    if (!result.available) return result;
    const listing = await run(['lfs', 'ls-files', '--json']);
    const parsed: unknown = JSON.parse(listing.stdout.toString('utf8'));
    const raw = (parsed as { files?: unknown[] }).files ?? [];
    if (!Array.isArray(raw)) throw new GitError(message('lfs.invalidOutput'), 'PARSE_ERROR');
    const staged = new Set((await run(['diff', '--cached', '--name-only', '-z', '--'])).stdout.toString('utf8').split('\0'));
    const unstaged = new Set((await run(['diff', '--name-only', '-z', '--'])).stdout.toString('utf8').split('\0'));
    const env = (await run(['lfs', 'env'])).stdout.toString('utf8');
    const media = /^LocalMediaDir=(.+)\r?$/m.exec(env)?.[1]?.trim();
    result.statusText = redactSecrets((await run(['lfs', 'status'])).stdout.toString('utf8'));
    result.truncated = raw.length > 1000;
    for (const value of raw.slice(0, 1000)) {
      const item = value as { name?: unknown; oid?: unknown; size?: unknown };
      if (typeof item.name !== 'string' || !validPath(item.name) || typeof item.oid !== 'string' || !/^[a-f0-9]{64}$/.test(item.oid) || typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 0) throw new GitError(message('lfs.invalidOutput'), 'PARSE_ERROR');
      const file: LfsFile = { path: item.name, oid: item.oid, size: item.size, worktree: 'unknown', localObject: 'unknown', staged: staged.has(item.name), unstaged: unstaged.has(item.name) };
      try {
        const filename = await safeWorkingPath(repo.root, item.name), info = await lstat(filename);
        if (info.isFile() && !info.isSymbolicLink()) {
          const handle = await open(filename, 'r');
          try { const buffer = Buffer.alloc(1025); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); file.worktree = parseLfsPointer(buffer.subarray(0, bytesRead)) ? 'pointer' : 'content'; }
          finally { await handle.close(); }
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') file.worktree = 'missing'; }
      file.localObject = (await cachedObject(media, item.oid, item.size)).localObject;
      result.files.push(file);
    }
    result.destinations = (await captureLfsDestinations(repo, run)).destinations;
    const after = await currentContext(run);
    if (after.head !== context.head || after.branch !== context.branch) throw new GitError(message('lfs.previewChanged'), 'OPERATION_CHANGED');
    return result;
  }
  private async media(run: Run): Promise<string | undefined> {
    const env = await run(['lfs', 'env'], true);
    return env.code ? undefined : /^LocalMediaDir=(.+)\r?$/m.exec(env.stdout.toString('utf8'))?.[1]?.trim();
  }
  private async historicalPointer(raw: LfsHistoricalRequest, run: Run): Promise<Omit<LfsHistoricalObject, 'localObject' | 'content'>> {
    const request = lfsHistoricalRequestSchema.parse(raw);
    if (!validPath(request.path)) throw new GitError(message('lfs.invalidPattern'), 'INVALID_PATH');
    const type = await run(['cat-file', '-t', request.revision], true);
    if (type.code || type.stdout.toString('utf8').trim() !== 'commit') throw new GitError(message('lfs.historicalCommitRequired'), 'INVALID_REVISION');
    const records = (await run(['ls-tree', '-z', request.revision, '--', request.path])).stdout.toString('utf8').split('\0');
    const record = records.find(value => value.slice(value.indexOf('\t') + 1) === request.path), fields = record?.slice(0, record.indexOf('\t')).split(' ');
    if (!fields || !['100644', '100755'].includes(fields[0]) || fields[1] !== 'blob' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(fields[2])) throw new GitError(message('lfs.historicalFileRequired'), 'INVALID_PATH');
    const size = Number((await run(['cat-file', '-s', fields[2]])).stdout.toString('utf8').trim());
    if (!Number.isSafeInteger(size) || size < 0 || size > 1024) throw new GitError(message('lfs.notPointer'), 'LFS_NOT_POINTER');
    const pointer = parseLfsPointer((await run(['cat-file', 'blob', fields[2]])).stdout);
    if (!pointer) throw new GitError(message('lfs.notPointer'), 'LFS_NOT_POINTER');
    return { ...request, ...pointer };
  }
  async historicalObject(repo: Repository, request: LfsHistoricalRequest, run: Run, maxBytes = 0): Promise<LfsHistoricalObject> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 64 * 1024 * 1024) throw new GitError(message('lfs.historicalLimit'), 'INVALID_ARGUMENT');
    const pointer = await this.historicalPointer(request, run);
    return { ...pointer, ...await cachedObject(await this.media(run), pointer.oid, pointer.size, maxBytes) };
  }
  /** Host-only cache reads also support working files that have not been smudged. */
  async localObject(pointer: { oid: string; size: number }, run: Run, maxBytes = 0): Promise<import('../protocol/lfs').LfsCachedObject> {
    if (!/^[a-f0-9]{64}$/.test(pointer.oid) || !Number.isSafeInteger(pointer.size) || pointer.size < 0
      || !Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 64 * 1024 * 1024) throw new GitError(message('lfs.historicalLimit'), 'INVALID_ARGUMENT');
    return { ...pointer, ...await cachedObject(await this.media(run), pointer.oid, pointer.size, maxBytes) };
  }
  /** Read the selected Index stage without treating pointer-shaped symlinks as LFS. */
  async indexObject(repo: Repository, request: import('../protocol/lfs').LfsIndexRequest, run: Run, maxBytes = 0): Promise<import('../protocol/lfs').LfsIndexObject> {
    const stage = request.stage ?? 0;
    if (!validPath(request.path) || ![0, 1, 2, 3].includes(stage)) throw new GitError(message('lfs.invalidPattern'), 'INVALID_PATH');
    const records = (await run(['ls-files', '--stage', '-z', '--', request.path])).stdout.toString('utf8').split('\0');
    const record = records.find(value => {
      const tab = value.indexOf('\t');
      return value.slice(tab + 1) === request.path && Number(value.slice(0, tab).split(' ')[2]) === stage;
    });
    const fields = record?.slice(0, record.indexOf('\t')).split(' ');
    if (!fields || !['100644', '100755'].includes(fields[0]) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(fields[1])) throw new GitError(message('lfs.historicalFileRequired'), 'INVALID_PATH');
    const size = Number((await run(['cat-file', '-s', fields[1]])).stdout.toString('utf8').trim());
    if (!Number.isSafeInteger(size) || size < 0 || size > 1024) throw new GitError(message('lfs.notPointer'), 'LFS_NOT_POINTER');
    const pointer = parseLfsPointer((await run(['cat-file', 'blob', fields[1]])).stdout);
    if (!pointer) throw new GitError(message('lfs.notPointer'), 'LFS_NOT_POINTER');
    return { ...request, ...await this.localObject(pointer, run, maxBytes) };
  }
  private async attributes(repo: Repository): Promise<Buffer> {
    const target = path.join(repo.root, '.gitattributes');
    try { const info = await lstat(target); if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new GitError(message('lfs.attributesUnsafe'), 'INVALID_PATH'); return await readFile(target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Buffer.alloc(0); throw error; }
  }
  async preview(repo: Repository, raw: LfsTrackRequest, run: Run): Promise<LfsTrackPreview> {
    const request = lfsTrackRequestSchema.parse(raw);
    if (!request.literal && request.pattern.startsWith('!') || !validPath(request.pattern)) throw new GitError(message('lfs.invalidPattern'), 'INVALID_ARGUMENT');
    if (/\s$/.test(request.pattern)) throw new GitError(message('lfs.trailingSpaceUnsupported'), 'INVALID_ARGUMENT');
    const context = await currentContext(run);
    const before = await this.attributes(repo), source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(before);
    const filename = process.platform === 'win32' ? request.pattern.replace(/\\/g, '/') : request.pattern;
    let pattern = request.literal ? '/' + filename.replace(/[\\\[\]*?]/g, '\\$&') : request.pattern;
    if (pattern.startsWith('#') || /\s|["\\]/.test(pattern)) pattern = JSON.stringify(pattern);
    const line = `${pattern} filter=lfs diff=lfs merge=lfs -text`, eol = source.includes('\r\n') ? '\r\n' : '\n';
    const lines = source.split(/\r?\n/), matches = lines.filter(value => value === line);
    if (request.operation === 'untrack' && !matches.length) throw new GitError(message('lfs.untrackExact'), 'INVALID_ARGUMENT');
    const after = request.operation === 'track' ? matches.length ? source : source + (source && !source.endsWith('\n') ? eol : '') + line + eol : source.split(/(?<=\n)/).filter(value => value.replace(/\r?\n$/, '') !== line).join('');
    for (const [key, plan] of this.plans) if (plan.expires < Date.now()) this.plans.delete(key);
    while (this.plans.size >= 20) this.plans.delete(this.plans.keys().next().value!);
    const token = randomUUID(); this.plans.set(token, { root: repo.root, commonDir: repo.commonDir, ...context, before, after, expires: Date.now() + 300000 });
    return { token, before: source, after, pattern: request.pattern, operation: request.operation, ...context };
  }
  async execute(repo: Repository, action: LfsAction, run: Run, current: { head?: string; branch: string }): Promise<void> {
    if (action.type === 'lfs.fetchHistorical') {
      const pointer = await this.historicalPointer({ revision: action.revision, path: action.path }, run);
      if (pointer.oid !== action.oid || action.path.includes(',') || /\s$/.test(action.path)) throw new GitError(message('lfs.historicalSelectionChanged'), 'OPERATION_CHANGED');
      if (!(await run(['remote'])).stdout.toString('utf8').trim().split('\n').includes(action.remote)) throw new GitError(message('lfs.invalidRemote'), 'INVALID_ARGUMENT');
      if ((await run(['lfs', 'version'], true)).code) throw new GitError(message('lfs.missingTool'), 'LFS_UNAVAILABLE');
      await runBoundLfs(repo, run, action.remote, 'fetch', action.expectedDestination, ['lfs', 'fetch', `--include=${fetchInclude(action.path)}`, '--exclude=', action.remote, action.revision]);
      return;
    }
    if (action.type === 'lfs.track') {
      const plan = this.plans.get(action.token);
      if (!plan || plan.root !== repo.root || plan.commonDir !== repo.commonDir || plan.head !== current.head || plan.branch !== current.branch || plan.expires < Date.now() || digest(await this.attributes(repo)) !== digest(plan.before)) throw new GitError(message('lfs.previewChanged'), 'OPERATION_CHANGED');
      // Use the Git attributes lock convention and verify once more after acquiring it.
      const target = path.join(repo.root, '.gitattributes'), lock = target + '.lock';
      const handle = await open(lock, 'wx');
      try {
        const after = await currentContext(run);
        if (after.head !== plan.head || after.branch !== plan.branch) throw new GitError(message('lfs.previewChanged'), 'OPERATION_CHANGED');
        if (digest(await this.attributes(repo)) !== digest(plan.before)) throw new GitError(message('lfs.previewChanged'), 'OPERATION_CHANGED');
        try { await handle.chmod((await lstat(target)).mode); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await handle.writeFile(plan.after); await handle.close(); await rename(lock, target); this.plans.delete(action.token);
      } finally { await handle.close().catch(() => {}); await rm(lock, { force: true }); }
      return;
    }
    if (action.expectedHead !== (current.head ?? '') || action.expectedBranch !== current.branch) throw new GitError(message('lfs.previewChanged'), 'OPERATION_CHANGED');
    if (action.type === 'lfs.checkout') { await run(['lfs', 'checkout']); return; }
    const remotes = (await run(['remote'])).stdout.toString('utf8').trim().split('\n');
    if (!remotes.includes(action.remote)) throw new GitError(message('lfs.invalidRemote'), 'INVALID_ARGUMENT');
    if (!current.head || !current.branch && action.type !== 'lfs.fetch') throw new GitError(message('lfs.branchRequired'), 'INVALID_ARGUMENT');
    if (action.type === 'lfs.fetch') {
      let include = '';
      if (action.oids?.length) {
        const listing = JSON.parse((await run(['lfs', 'ls-files', '--json', current.head!])).stdout.toString('utf8')) as { files?: { name: string; oid: string }[] };
        const selected = (listing.files ?? []).filter(file => action.oids!.includes(file.oid));
        if (action.oids.some(oid => !selected.some(file => file.oid === oid)) || selected.some(file => !validPath(file.name) || file.name.includes(',') || /\s$/.test(file.name))) throw new GitError(message('lfs.selectionChanged'), 'OPERATION_CHANGED');
        include = selected.map(file => fetchInclude(file.name)).join(',');
      }
      await runBoundLfs(repo, run, action.remote, 'fetch', action.expectedDestination, ['lfs', 'fetch', `--include=${include}`, '--exclude=', action.remote, current.head!]);
    }
    else if (action.type === 'lfs.pull') {
      await runBoundLfs(repo, run, action.remote, 'fetch', action.expectedDestination, ['lfs', 'fetch', '--include=', '--exclude=', action.remote, current.head!]);
      const after = await currentContext(run);
      if (after.head !== current.head || after.branch !== current.branch) throw new GitError(message('lfs.previewChanged'), 'OPERATION_CHANGED');
      await run(['lfs', 'checkout']);
    } else await runBoundLfs(repo, run, action.remote, 'push', action.expectedDestination, ['lfs', 'push', action.remote, current.head!]);
  }
}
