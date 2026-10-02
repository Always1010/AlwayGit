import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { OperationState, Repository, StashApplyBlocker } from '../protocol/types';

export interface StashExecution { root?: string; env?: NodeJS.ProcessEnv; input?: Buffer; silent?: boolean; isolated?: boolean; allowFailure?: boolean }
type Result = { stdout: Buffer; stderr: Buffer; code: number };
type Run = (args: string[], execution?: StashExecution) => Promise<Result>;
type FileState = { kind: 'missing' | 'directory' | 'file' | 'link'; mode?: number; bytes?: Buffer; link?: string; children?: string[] };
type Captured = { head: string; gitDir: string; index?: Buffer; shared: Map<string, Buffer>; files: Map<string, FileState>; config: string; attributes: Map<string, Buffer>; fingerprint: string };
type TreeEntry = { mode: string; oid: string };

export class StashStateError extends Error {
  constructor(message: string, public readonly code: string, public readonly stdout = '', public readonly stderr = '', public readonly details?: StashApplyBlocker) { super(message); this.name = 'StashStateError'; }
}

function paths(buffer: Buffer): string[] {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer).split('\0').filter(Boolean); }
  catch { throw new StashStateError('Stash requires repository paths encoded as UTF-8.', 'UNSUPPORTED_PATH_ENCODING'); }
}
function treeEntries(buffer: Buffer): Map<string, TreeEntry> {
  return new Map(paths(buffer).map(record => { const tab = record.indexOf('\t'), [mode, , oid] = record.slice(0, tab).split(' '); return [record.slice(tab + 1), { mode, oid }]; }));
}
function indexPaths(buffer: Buffer): string[] { return paths(buffer).map(record => record.slice(record.indexOf('\t') + 1)); }
async function text(run: Run, args: string[], execution?: StashExecution): Promise<string> { return (await run(args, execution)).stdout.toString('utf8').trim(); }
const absent = (error: unknown) => ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '');

// Never follow a working-tree directory symlink while copying the trial state.
async function fileState(root: string, name: string): Promise<FileState> {
  const parts = name.split('/');
  for (let i = 1; i < parts.length; i++) {
    try { if ((await lstat(path.join(root, ...parts.slice(0, i)))).isSymbolicLink()) throw new StashStateError(`Cannot safely inspect a path below a symbolic link: ${name}`, 'UNSUPPORTED_STASH_PATH'); }
    catch (error) { if (absent(error)) return { kind: 'missing' }; throw error; }
  }
  const target = path.join(root, name);
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) return { kind: 'link', link: await readlink(target) };
    if (stat.isDirectory()) return { kind: 'directory', children: (await readdir(target)).sort() };
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new StashStateError(`Cannot safely snapshot this file (unsupported type or larger than 32 MiB): ${name}`, 'UNSUPPORTED_STASH_PATH');
    return { kind: 'file', bytes: await readFile(target), mode: stat.mode & 0o777 };
  } catch (error) { if (absent(error)) return { kind: 'missing' }; throw error; }
}

async function capture(repo: Repository, extraPaths: string[], run: Run): Promise<Captured> {
  const head = await text(run, ['rev-parse', '--verify', 'HEAD']);
  const gitDir = await text(run, ['rev-parse', '--path-format=absolute', '--git-dir']);
  const [headFiles, indexFiles, otherFiles, occupied, configResult] = await Promise.all([
    run(['ls-tree', '-r', '-z', head]), run(['ls-files', '--stage', '-z']),
    run(['ls-files', '--others', '--exclude-standard', '-z']),
    extraPaths.length ? run(['ls-files', '--others', '-z', '--', ...extraPaths]) : Promise.resolve({ stdout: Buffer.alloc(0) }),
    run(['config', '--null', '--list']),
  ]);
  const config = configResult.stdout.toString('utf8');
  if (config.split('\0').some(entry => /^core\.sparsecheckout\n(?:true|1|yes|on)$/i.test(entry))) throw new StashStateError('Stash preflight is not supported in a sparse checkout. Use Git directly for this repository.', 'UNSUPPORTED_STASH_STATE');
  const tree = treeEntries(headFiles.stdout), names = [...new Set([...tree.keys(), ...indexPaths(indexFiles.stdout), ...paths(otherFiles.stdout), ...paths(occupied.stdout), ...extraPaths])].sort();
  const gitlinks = new Set([...tree].filter(([, entry]) => entry.mode === '160000').map(([name]) => name));
  for (const record of paths(indexFiles.stdout)) if (record.startsWith('160000 ')) gitlinks.add(record.slice(record.indexOf('\t') + 1));
  if (extraPaths.some(name => gitlinks.has(name))) throw new StashStateError('Stash isolation cannot save or restore a submodule state. Use Git directly for this path.', 'UNSUPPORTED_STASH_STATE');
  let index: Buffer | undefined;
  try { index = await readFile(await text(run, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])); } catch (error) { if (!absent(error)) throw error; }
  const attributes = new Map<string, Buffer>();
  for (const variable of ['GIT_ATTR_SYSTEM', 'GIT_ATTR_GLOBAL']) {
    const result = await run(['var', variable], { allowFailure: true });
    if (result.code && result.stderr.length) throw new StashStateError('Stash isolation needs Git 2.43 or newer to inspect attribute sources.', 'UNSUPPORTED_STASH_STATE');
    const sources = result.stdout.toString('utf8').trim().split(/\r?\n/).filter(Boolean);
    const chunks: Buffer[] = [];
    for (const source of sources.reverse()) try { const bytes = await readFile(path.resolve(repo.root, source)); attributes.set(source, bytes); chunks.push(bytes, Buffer.from('\n')); } catch (error) { if (!absent(error)) throw error; }
    attributes.set(variable, Buffer.concat(chunks));
  }
  const infoAttributes = await text(run, ['rev-parse', '--path-format=absolute', '--git-path', 'info/attributes']);
  try { attributes.set('info', await readFile(infoAttributes)); } catch (error) { if (!absent(error)) throw error; }
  const shared = new Map<string, Buffer>();
  for (const directory of [...new Set([gitDir, repo.commonDir])]) {
    for (const name of await readdir(directory)) if (/^sharedindex\.[a-f0-9]+$/.test(name)) shared.set(name, await readFile(path.join(directory, name)));
  }
  const files = new Map<string, FileState>(), hash = createHash('sha256').update(head).update(index ?? '<missing-index>').update(config);
  let size = 0;
  for (const name of names) {
    // Gitlinks refer to separate repositories; their inner contents are never copied.
    if (gitlinks.has(name)) continue;
    const state = await fileState(repo.root, name); files.set(name, state);
    if (extraPaths.includes(name) && state.kind === 'directory' && state.children?.some(child => !names.some(candidate => candidate === `${name}/${child}` || candidate.startsWith(`${name}/${child}/`)))) throw new StashStateError(`Cannot safely inspect the directory occupying ${name}. Move it before restoring.`, 'UNSUPPORTED_STASH_PATH');
    size += state.bytes?.length ?? 0;
    if (size > 128 * 1024 * 1024) throw new StashStateError('The working state is larger than the 128 MiB Stash preflight limit. Use Git directly for this repository.', 'UNSUPPORTED_STASH_STATE');
    hash.update(JSON.stringify([name, state.kind, state.mode, state.link, state.children])); if (state.bytes) hash.update(state.bytes);
  }
  for (const [name, bytes] of shared) hash.update(name).update(bytes);
  for (const [name, bytes] of attributes) hash.update(name).update(bytes);
  return { head, gitDir, index, shared, files, config, attributes, fingerprint: hash.digest('hex') };
}

async function checkAttributes(names: string[], run: Run, source?: string): Promise<void> {
  if (!names.length) return;
  const values = paths((await run(['check-attr', ...(source ? [`--source=${source}`] : []), '-z', 'filter', 'merge', '--', ...names])).stdout);
  for (let i = 0; i < values.length; i += 3) {
    const [name, attribute, value] = values.slice(i, i + 3);
    if ((attribute === 'filter' && !['unspecified', 'unset'].includes(value)) || (attribute === 'merge' && !['unspecified', 'unset', 'set', 'text', 'binary', 'union'].includes(value))) {
      throw new StashStateError(`Stash isolation cannot safely run an external ${attribute} driver for ${name}. Use Git directly for this file.`, 'UNSUPPORTED_STASH_STATE');
    }
  }
}

async function makeSandbox(repo: Repository, state: Captured, run: Run): Promise<{ root: string; git: Run; dispose(): Promise<void> }> {
  const base = path.resolve(os.tmpdir()), root = await mkdtemp(path.join(base, 'alwaygit-stash-'));
  const dispose = async () => {
    if (path.dirname(path.resolve(root)) !== base || !path.basename(root).startsWith('alwaygit-stash-')) throw new Error('Unsafe Stash temporary directory');
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  };
  const git: Run = (args, execution = {}) => run(args, { ...execution, root, silent: true, isolated: true, env: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'no-global-config'), GIT_ATTR_NOSYSTEM: '1', ...execution.env } });
  try {
    const format = await text(run, ['rev-parse', '--show-object-format']);
    await git(['init', '--quiet', '--template=', `--object-format=${format}`]);
    const objects = await text(run, ['rev-parse', '--path-format=absolute', '--git-path', 'objects']);
    await writeFile(path.join(root, '.git', 'objects', 'info', 'alternates'), `${JSON.stringify(objects.replace(/\\/g, '/'))}\n`);
    await writeFile(path.join(root, '.git', 'HEAD'), `${state.head}\n`);
    for (const entry of state.config.split('\0').filter(Boolean)) {
      const split = entry.indexOf('\n'), key = split < 0 ? entry : entry.slice(0, split), value = split < 0 ? 'true' : entry.slice(split + 1);
      if (key.toLowerCase() === 'merge.default' && !['text', 'binary', 'union'].includes(value)) throw new StashStateError('Stash isolation cannot run an external default merge driver. Use Git directly for this repository.', 'UNSUPPORTED_STASH_STATE');
      if (/^(?:user\.(?:name|email)|core\.(?:autocrlf|eol|safecrlf|filemode|symlinks|ignorecase|precomposeunicode|checkroundtripencoding)|merge\.(?:default|conflictstyle|renamelimit|renames|renormalize))$/i.test(key)) await git(['config', '--local', '--replace-all', key, value]);
    }
    const globalAttributes = path.join(root, '.git', 'global-attributes');
    await writeFile(globalAttributes, Buffer.concat([state.attributes.get('GIT_ATTR_SYSTEM') ?? Buffer.alloc(0), state.attributes.get('GIT_ATTR_GLOBAL') ?? Buffer.alloc(0)]));
    await git(['config', '--local', 'core.attributesFile', globalAttributes]);
    if (state.attributes.has('info')) {
      await mkdir(path.join(root, '.git', 'info'), { recursive: true });
      await writeFile(path.join(root, '.git', 'info', 'attributes'), state.attributes.get('info')!);
    }
    await git(['config', '--local', 'core.hooksPath', path.join(root, 'no-hooks')]);
    await git(['config', '--local', 'core.fsmonitor', 'false']);
    await git(['config', '--local', 'rerere.enabled', 'false']);
    await git(['config', '--local', 'user.name', 'AlwayGit']);
    await git(['config', '--local', 'user.email', 'alwaygit@localhost']);
    if (state.index) await writeFile(path.join(root, '.git', 'index'), state.index);
    else await git(['read-tree', state.head]);
    for (const [name, bytes] of state.shared) await writeFile(path.join(root, '.git', name), bytes);
    // The probe gets raw working bytes, not a checkout that could invoke smudge drivers.
    for (const [name, file] of state.files) {
      if (file.kind === 'missing') continue;
      const target = path.join(root, name);
      await mkdir(path.dirname(target), { recursive: true });
      if (file.kind === 'directory') await mkdir(target, { recursive: true });
      else if (file.kind === 'link') await symlink(file.link!, target);
      else { await writeFile(target, file.bytes!); if (process.platform !== 'win32') await chmod(target, file.mode!); }
    }
    await git(['update-index', '--refresh'], { allowFailure: true });
    return { root, git, dispose };
  } catch (error) { await dispose(); throw error; }
}

export async function preflightStash(repo: Repository, selector: string, stashOid: string, affected: string[], operation: OperationState, run: Run): Promise<void> {
  const block = (reason: StashApplyBlocker['reason'], names: string[], message: string, output = '') => new StashStateError(message, 'STASH_RESTORE_BLOCKED', '', output, { kind: 'stash-apply', reason, paths: names, selector, stashOid, stashRetained: true, workingTreeUnchanged: true, ...(output ? { output } : {}) });
  if (operation.kind || operation.conflicts) throw block('restore-blocked', affected, 'Finish the active Git operation or resolve existing conflicts before restoring a Stash. The Index and Working Tree were not changed.');
  let sandbox: Awaited<ReturnType<typeof makeSandbox>> | undefined;
  try {
    await checkAttributes(affected, run);
    await checkAttributes(affected, run, stashOid);
    await checkAttributes(affected, run, `${stashOid}^2`);
    const before = await capture(repo, affected, run);
    sandbox = await makeSandbox(repo, before, run);
    try { await sandbox.git(['stash', 'apply', '--index', stashOid]); }
    catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      const output = [failure.stdout, failure.stderr].filter(Boolean).join('\n') || failure.message || 'Stash restoration failed in the isolated trial.';
      const conflicts = paths((await sandbox.git(['diff', '--name-only', '--diff-filter=U', '-z'])).stdout);
      throw block(/conflict|patch.*(?:fail|does not apply)|would be overwritten/i.test(output) ? 'restore-conflict' : 'restore-blocked', conflicts.length ? conflicts : affected, 'The Stash could not be restored in the isolated trial. The real Index and Working Tree were not changed, and the Stash is still saved.', output);
    }
    if (before.fingerprint !== (await capture(repo, affected, run)).fingerprint) throw block('state-changed', affected, 'The project changed during Stash inspection. Refresh and retry. This restore did not change the Index or Working Tree.');
  } catch (error) {
    if (error instanceof StashStateError && error.details) throw error;
    throw block('restore-blocked', affected, `Stash preflight could not complete. The Index and Working Tree were not changed.\n${error instanceof Error ? error.message : String(error)}`);
  } finally { await sandbox?.dispose(); }
}
