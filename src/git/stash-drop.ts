import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { message, renderMessage } from '../i18n';
import type { Repository } from '../protocol/types';
import { GitError } from './error';

type Run = (args: string[]) => Promise<{ stdout: Buffer; code: number }>;
const changed = () => new GitError(message('service.theStashListChangedRefreshAndSelectTheSaved'), 'STASH_CHANGED');
const unsupported = () => new GitError(message('service.stashDeleteUnsupported'), 'STASH_DELETE_UNSUPPORTED');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const limit = 32 * 1024 * 1024;

async function regularFile(name: string): Promise<{ bytes: Buffer; mode: number } | undefined> {
  try {
    const stat = await lstat(name);
    if (!stat.isFile() || stat.size > limit) throw unsupported();
    return { bytes: await readFile(name), mode: stat.mode & 0o777 };
  } catch (error) { if (missing(error)) return; throw error; }
}

async function safeParents(base: string, name: string): Promise<void> {
  const relative = path.relative(base, path.dirname(name));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw unsupported();
  let current = base;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw unsupported();
  }
}

function packedStash(bytes: Buffer, length: number): { oid?: string; withoutStash: Buffer } {
  const kept: Buffer[] = [];
  let start = 0, oid: string | undefined, previous = false, removePeeled = false;
  while (start < bytes.length) {
    const end = bytes.indexOf(10, start);
    if (end < 0) throw unsupported();
    const record = bytes.subarray(start, end + 1), line = record.subarray(0, -1).toString('latin1');
    start = end + 1;
    if (line.startsWith('#')) { if (previous) throw unsupported(); kept.push(record); continue; }
    if (line.startsWith('^')) {
      if (!previous || !new RegExp(`^\\^[a-f0-9]{${length}}$`).test(line)) throw unsupported();
      if (!removePeeled) kept.push(record);
      previous = false; removePeeled = false; continue;
    }
    const match = new RegExp(`^([a-f0-9]{${length}}) ([^\\x00\\r\\n ]+)$`).exec(line);
    if (!match) throw unsupported();
    previous = true; removePeeled = match[2] === 'refs/stash';
    if (removePeeled) { if (oid) throw unsupported(); oid = match[1]; }
    else kept.push(record);
  }
  return { oid, withoutStash: Buffer.concat(kept) };
}

function deleteEntry(bytes: Buffer, index: number, expected: string, length: number): { bytes: Buffer; top?: string; originalTop: string } {
  const records: { bytes: Buffer; oid: string }[] = [];
  let start = 0;
  const pattern = new RegExp(`^[a-f0-9]{${length}} ([a-f0-9]{${length}}) [^\\x00\\n]*> [0-9]+ [+-][0-9]{4}\\t[^\\x00\\n]*\\n$`);
  while (start < bytes.length) {
    const end = bytes.indexOf(10, start);
    if (end < 0) throw unsupported();
    const record = bytes.subarray(start, end + 1), match = pattern.exec(record.toString('latin1'));
    if (!match || /^0+$/.test(match[1])) throw unsupported();
    records.push({ bytes: record, oid: match[1] }); start = end + 1;
  }
  const target = records.length - 1 - index;
  if (target < 0 || records[target].oid !== expected) throw changed();
  const originalTop = records[records.length - 1].oid;
  records.splice(target, 1);
  let old = '0'.repeat(length);
  const rewritten = records.map(record => { const result = Buffer.concat([Buffer.from(old), record.bytes.subarray(length)]); old = record.oid; return result; });
  return { bytes: Buffer.concat(rewritten), top: records.at(-1)?.oid, originalTop };
}

/** Delete an ordinal only after validating its OID under Git's reference lock.
 * The files backend serializes reflog writes using refs/stash.lock, NOT the
 * reflog lock. Publish the log before the ref, matching Git's reflog expiry.
 * This guarantees identity against cooperating Git writers, not power-loss
 * atomicity across multiple files. Unsupported storage fails before mutation.
 */
export async function dropStash(repo: Repository, selector: string, expectedOid: string, run: Run): Promise<void> {
  const match = /^stash@\{(\d+)\}$/.exec(selector), index = Number(match?.[1]);
  if (!match || !Number.isSafeInteger(index) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(expectedOid)) throw new GitError(message('service.invalidStashSelector'), 'INVALID_ARGUMENT');
  const formatResult = await run(['rev-parse', '--show-ref-format']);
  let format = formatResult.stdout.toString('utf8').trim();
  if (!formatResult.code && format === '--show-ref-format') {
    const storage = await run(['config', '--local', '--get', 'extensions.refStorage']);
    if (storage.code > 1) throw unsupported();
    format = storage.code === 1 ? 'files' : storage.stdout.toString('utf8').trim();
  }
  if (formatResult.code || format !== 'files') throw unsupported();
  const objectFormat = await run(['rev-parse', '--show-object-format=storage']);
  const hash = objectFormat.stdout.toString('utf8').trim(), length = hash === 'sha1' ? 40 : hash === 'sha256' ? 64 : 0;
  if (objectFormat.code || !length || expectedOid.length !== length) throw unsupported();
  const base = path.resolve(repo.commonDir);
  const names: string[] = [];
  for (const relative of ['refs/stash', 'logs/refs/stash', 'packed-refs']) {
    const result = await run(['rev-parse', '--path-format=absolute', '--git-path', relative]);
    const name = path.resolve(result.stdout.toString('utf8').trim());
    const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
    if (result.code || normalize(name) !== normalize(path.join(base, relative))) throw unsupported();
    await safeParents(base, name); names.push(name);
  }
  const [refName, logName, packedName] = names;
  const owned = new Set<string>();
  const acquire = async (name: string, bytes?: Buffer, mode = 0o666) => {
    let handle;
    try { handle = await open(name, 'wx', mode); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new GitError(message('service.stashDeleteBusy'), 'STASH_DELETE_BUSY'); throw error; }
    owned.add(name);
    try { if (bytes) { await handle.writeFile(bytes); await handle.chmod(mode); await handle.sync(); } }
    finally { await handle.close(); }
  };
  const publish = async (source: string, destination: string) => { await rename(source, destination); owned.delete(source); };
  // Backup refs must also end in .lock so Git's loose-ref scanner ignores them.
  const suffix = `.alwaygit-rollback-${randomUUID()}.lock`;
  let logPublished = false, packedPublished = false, refRemoved = false;
  let primaryError: unknown;
  let logBackup: string | undefined, packedBackup: string | undefined, refBackup: string | undefined;
  try {
    await acquire(`${refName}.lock`);
    // Keep this marker locked across packed publication and loose-ref removal.
    // Git likewise publishes packed-refs.new rather than renaming this lock.
    await acquire(`${packedName}.lock`);
    const log = await regularFile(logName), ref = await regularFile(refName), packed = await regularFile(packedName);
    if (!log) throw changed();
    const packedState = packedStash(packed?.bytes ?? Buffer.alloc(0), length);
    const looseOid = ref?.bytes.toString('ascii');
    if (looseOid !== undefined && !new RegExp(`^[a-f0-9]{${length}}\\n?$`).test(looseOid)) throw unsupported();
    const result = deleteEntry(log.bytes, index, expectedOid, length);
    if ((looseOid?.trim() ?? packedState.oid) !== result.originalTop) throw unsupported();
    await acquire(`${logName}.lock`, result.bytes, log.mode);
    logBackup = `${logName}${suffix}`; await acquire(logBackup, log.bytes, log.mode);
    if (result.top) {
      // A packed-only ref becomes a loose ref, which correctly overrides its
      // packed copy. Non-top deletion does not publish a changed ref.
      if (result.top !== result.originalTop) {
        const handle = await open(`${refName}.lock`, 'r+');
        try { await handle.writeFile(`${result.top}\n`); if (ref) await handle.chmod(ref.mode); await handle.sync(); }
        finally { await handle.close(); }
      }
      await publish(`${logName}.lock`, logName); logPublished = true;
      if (result.top !== result.originalTop) await publish(`${refName}.lock`, refName);
    } else {
      if (packedState.oid) {
        await acquire(`${packedName}.new`, packedState.withoutStash, packed!.mode);
        packedBackup = `${packedName}${suffix}`; await acquire(packedBackup, packed!.bytes, packed!.mode);
      }
      if (ref) { refBackup = `${refName}${suffix}`; await acquire(refBackup, ref.bytes, ref.mode); }
      await publish(`${logName}.lock`, logName); logPublished = true;
      if (packedState.oid) { await publish(`${packedName}.new`, packedName); packedPublished = true; }
      if (ref) { await rm(refName); refRemoved = true; }
      await rm(logName);
    }
  } catch (error) {
    primaryError = error;
    if (logPublished) {
      try {
        if (refRemoved && refBackup) await publish(refBackup, refName);
        if (packedPublished && packedBackup) await publish(packedBackup, packedName);
        if (logBackup) await publish(logBackup, logName);
      } catch (rollbackError) {
        // Leave any still-owned recovery copies for inspection, while releasing
        // the Git locks. Never discard the only original bytes after a failed
        // rollback. Their .lock suffix keeps them out of Git's ref listing.
        const recovery = [logBackup, packedBackup, refBackup].filter((name): name is string => !!name && owned.has(name));
        for (const name of recovery) owned.delete(name);
        primaryError = new GitError(message('service.stashDeletePartial', { paths: recovery.join('\n') }), 'STASH_DELETE_PARTIAL', '', `${String(error)}\n${String(rollbackError)}\n${recovery.join('\n')}`);
        throw primaryError;
      }
    }
    throw error;
  } finally {
    const cleanupFailures: string[] = [];
    for (const name of owned) {
      try { await rm(name, { force: true }); }
      catch (error) { cleanupFailures.push(`${name}: ${String(error)}`); }
    }
    if (cleanupFailures.length) {
      const output = cleanupFailures.join('\n');
      if (primaryError instanceof GitError) {
        const visible = message('service.stashDeleteCleanupAfterError', { value: primaryError.message, paths: output });
        Object.defineProperty(primaryError, 'stderr', { value: `${primaryError.stderr}\n${output}`, configurable: true });
        Object.defineProperty(primaryError, 'localizedMessage', { value: visible, configurable: true });
        primaryError.message = renderMessage(visible);
      }
      else if (primaryError instanceof Error) primaryError.message += `\n${output}`;
      else if (!primaryError) throw new GitError(message('service.stashDeleteCleanupFailed', { paths: output }), 'STASH_DELETE_PARTIAL', '', output);
    }
  }
}
