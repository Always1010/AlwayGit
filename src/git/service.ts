import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Change, CheckoutBlocker, Commit, CommitDetails, CommitFile, ContentSource, GitAction, GitRef, GitServiceContract, HistoryPage, HistoryQuery, OperationState, Repository, Snapshot, Stash, Worktree } from '../protocol/types';

export interface GitServiceOptions {
  gitPath?: string;
  onOutput?: (repo: Repository, text: string) => void;
  timeoutMs?: number;
  maxOutputBytes?: number;
  environment?: NodeJS.ProcessEnv | ((repo: Repository, args: readonly string[]) => Promise<NodeJS.ProcessEnv | { env: NodeJS.ProcessEnv; dispose?: () => void | Promise<void> }>);
}
export class GitError extends Error {
  constructor(message: string, public readonly code: string, public readonly stdout = '', public readonly stderr = '', public readonly details?: CheckoutBlocker) { super(message); this.name = 'GitError'; }
}
type Result = { stdout: Buffer; stderr: Buffer; code: number };
const queues = new Map<string, Promise<unknown>>();
const normalized = (p: string) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
const canonicalPath = async (p: string) => { try { return await realpath(p); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return path.resolve(p); throw e; } };
function decodePaths(buffer: Buffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw new GitError('This repository contains a path encoded with invalid UTF-8. Rename the affected file with an external Git tool before continuing.', 'UNSUPPORTED_PATH_ENCODING'); }
}
const exists = async (p: string) => { try { await access(p); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } };
const token = (value: string, label: string) => { if (!value || value.startsWith('-') || /[\0\r\n]/.test(value)) throw new GitError(`Invalid ${label}`, 'INVALID_ARGUMENT'); return value; };
export function validateFilePath(value: string): string {
  if (!value || value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.startsWith('\\') || value.split(/[\\/]/).some(x => x === '..' || x === '.' || x.toLowerCase() === '.git' || (process.platform === 'win32' && (/^[. ]+$/.test(x) || /^\.git[. ]*$/i.test(x))))) throw new GitError('File paths must stay inside the repository', 'INVALID_PATH');
  return process.platform === 'win32' ? value.replace(/\\/g, '/') : value;
}
function fields(record: string, count: number): [string[], string] {
  const result: string[] = []; let start = 0;
  for (let i = 0; i < count; i++) { const end = record.indexOf(' ', start); if (end < 0) throw new GitError('Malformed Git status output', 'PARSE_ERROR'); result.push(record.slice(start, end)); start = end + 1; }
  return [result, record.slice(start)];
}
export function parseStatus(buffer: Buffer): { branch: string; head?: string; upstream?: string; ahead: number; behind: number; changes: Change[] } {
  const result: ReturnType<typeof parseStatus> = { branch: '', ahead: 0, behind: 0, changes: [] };
  const records = decodePaths(buffer).split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.startsWith('# branch.head ')) result.branch = record.slice(14) === '(detached)' ? '' : record.slice(14);
    else if (record.startsWith('# branch.oid ')) { const oid = record.slice(13); if (oid !== '(initial)') result.head = oid; }
    else if (record.startsWith('# branch.upstream ')) result.upstream = record.slice(18);
    else if (record.startsWith('# branch.ab ')) { const match = /\+(\d+) -(\d+)/.exec(record); if (match) { result.ahead = Number(match[1]); result.behind = Number(match[2]); } }
    else if (record.startsWith('1 ') || record.startsWith('2 ') || record.startsWith('u ')) {
      const kind = record[0]; const [parts, name] = fields(record, kind === '1' ? 8 : kind === '2' ? 9 : 10);
      const xy = parts[1]; const change: Change = { path: name, indexStatus: xy[0] === '.' ? ' ' : xy[0], worktreeStatus: xy[1] === '.' ? ' ' : xy[1], conflict: kind === 'u', untracked: false };
      if (kind === '2') change.originalPath = records[++i];
      result.changes.push(change);
    } else if (record.startsWith('? ')) result.changes.push({ path: record.slice(2), indexStatus: '?', worktreeStatus: '?', conflict: false, untracked: true });
  }
  return result;
}
function parseCommit(values: string[]): Commit { return { oid: values[0], parents: values[1] ? values[1].split(' ') : [], author: values[2], email: values[3], timestamp: Number(values[4]), subject: values[5] }; }
const commitFormat = '%H%x00%P%x00%an%x00%ae%x00%at%x00%s';

export class GitService implements GitServiceContract {
  private version = 0;
  constructor(private readonly options: GitServiceOptions = {}) {}
  private async run(repo: Repository, args: string[], allowFailure = false, captureBytes?: number): Promise<Result> {
    const adapter = this.options.environment;
    const supplied = typeof adapter === 'function' ? await adapter(repo, args) : adapter;
    const wrapped = supplied && 'env' in supplied && typeof supplied.env === 'object' ? supplied as { env: NodeJS.ProcessEnv; dispose?: () => void | Promise<void> } : undefined;
    const env = wrapped?.env ?? supplied as NodeJS.ProcessEnv | undefined;
    try {
      const result = await new Promise<Result>((resolve, reject) => {
        // Stash accepts no user pathspecs in this API. Its internal cleanup relies on
        // Git pathspec matching; inheriting --literal-pathspecs leaves saved untracked
        // files behind on Git for Windows. All file actions still use literal paths.
        const child = spawn(this.options.gitPath ?? 'git', ['-C', repo.root, ...(args[0] === 'stash' ? [] : ['--literal-pathspecs']), ...args], { shell: false, windowsHide: true, detached: process.platform !== 'win32', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', ...(['status', 'log', 'show', 'ls-tree', 'ls-files', 'for-each-ref'].includes(args[0]) ? { GIT_OPTIONAL_LOCKS: '0' } : {}), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
        const out: Buffer[] = []; const err: Buffer[] = []; let size = 0; let captured = 0; let failure: GitError | undefined;
        const stop = (error: GitError) => { failure = error; if (child.pid) { if (process.platform === 'win32') { const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' }); killer.on('error', () => child.kill()); } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill(); } } } child.stdout.destroy(); child.stderr.destroy(); reject(error); };
        const timer = setTimeout(() => stop(new GitError('Git timed out. Check credentials, hooks, or another Git process, then retry.', 'TIMEOUT')), this.options.timeoutMs ?? 60000);
        const collect = (bucket: Buffer[], chunk: Buffer) => { if (bucket === out && captureBytes !== undefined) { const remaining = captureBytes - captured; if (remaining > 0) { const piece = chunk.subarray(0, remaining); bucket.push(piece); captured += piece.length; } return; } size += chunk.length; if (size > (this.options.maxOutputBytes ?? 32 * 1024 * 1024)) { clearTimeout(timer); stop(new GitError('Git output exceeded the configured limit', 'OUTPUT_LIMIT')); return; } bucket.push(chunk); if (bucket === err) this.options.onOutput?.(repo, chunk.toString('utf8')); };
        child.stdout.on('data', chunk => collect(out, chunk)); child.stderr.on('data', chunk => collect(err, chunk));
        child.once('error', e => { clearTimeout(timer); reject(new GitError(`Cannot run Git: ${e.message}`, 'GIT_UNAVAILABLE')); });
        child.once('close', code => { clearTimeout(timer); if (failure) reject(failure); else resolve({ stdout: Buffer.concat(out), stderr: Buffer.concat(err), code: code ?? 1 }); });
      });
      if (result.stdout.length && ['add', 'restore', 'rm', 'clean', 'commit', 'fetch', 'pull', 'push', 'branch', 'switch', 'tag', 'stash', 'worktree', 'merge', 'rebase', 'cherry-pick', 'revert', 'reset'].includes(args[0]) && !(args[0] === 'stash' && args[1] === 'list') && !(args[0] === 'worktree' && args[1] === 'list')) this.options.onOutput?.(repo, result.stdout.toString('utf8'));
      if (result.code && !allowFailure) {
        const stdout = result.stdout.toString('utf8'); const stderr = result.stderr.toString('utf8');
        const hint = /authentication|could not read Username|terminal prompts disabled|permission denied|credential/i.test(stderr) ? '\nConfigure Git credentials or sign in, then retry.' : /index.lock|another git process/i.test(stderr) ? '\nAnother Git process is using this repository. Finish it and retry.' : '';
        throw new GitError((stderr.trim() || stdout.trim() || `Git exited with status ${result.code}`) + hint, 'GIT_FAILED', stdout, stderr);
      }
      return result;
    } finally { await wrapped?.dispose?.(); }
  }
  private async text(repo: Repository, args: string[]): Promise<string> { return (await this.run(repo, args)).stdout.toString('utf8').trim(); }
  async discover(root: string): Promise<Repository> {
    const resolved = await realpath(path.resolve(root));
    const provisional: Repository = { id: '', root: resolved, commonDir: '', name: path.basename(resolved) };
    const bare = await this.text(provisional, ['rev-parse', '--is-bare-repository']);
    if (bare === 'true') throw new GitError('Open a working repository rather than a bare repository', 'BARE_REPOSITORY');
    const top = await this.text(provisional, ['rev-parse', '--show-toplevel']);
    provisional.root = await realpath(top);
    provisional.commonDir = await realpath(await this.text(provisional, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
    provisional.id = createHash('sha256').update(normalized(provisional.root)).digest('hex').slice(0, 24);
    provisional.name = path.basename(provisional.root);
    return provisional;
  }
  private async verify(repo: Repository) { const current = await this.discover(repo.root); if (normalized(current.commonDir) !== normalized(repo.commonDir) || current.id !== repo.id) throw new GitError('Repository changed; reopen it before continuing', 'REPOSITORY_CHANGED'); return current; }
  private async oid(repo: Repository, revision: string): Promise<string> { token(revision, 'revision'); return this.text(repo, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]); }
  private async refName(repo: Repository, name: string): Promise<string> { token(name, 'reference name'); await this.run(repo, ['check-ref-format', `refs/heads/${name}`]); return name; }
  private async status(repo: Repository) { return parseStatus((await this.run(repo, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])).stdout); }
  async snapshot(repo: Repository): Promise<Snapshot> {
    await this.verify(repo);
    const [status, refsOutput, stashOutput, worktrees, gitDir, remoteOutput] = await Promise.all([this.status(repo), this.text(repo, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream:short)%00%(*objectname)%00%(*objecttype)%00%(objecttype)', 'refs/heads', 'refs/remotes', 'refs/tags']), this.text(repo, ['stash', 'list', '--format=%gd%x00%H%x00%s']), this.worktrees(repo), this.text(repo, ['rev-parse', '--path-format=absolute', '--git-dir']), this.text(repo, ['remote'])]);
    const refs: GitRef[] = refsOutput ? await Promise.all(refsOutput.split('\n').map(async line => {
      const [fullName, objectOid, upstream, peeledOid, peeledType, objectType] = line.split('\0');
      const kind: GitRef['kind'] = fullName.startsWith('refs/heads/') ? 'local' : fullName.startsWith('refs/remotes/') ? 'remote' : 'tag';
      // for-each-ref's starred fields peel one annotated-tag layer. Dereference
      // nested tags fully before deciding whether Commit actions are meaningful.
      const targetType = (peeledType === 'tag' ? await this.text(repo, ['cat-file', '-t', `${fullName}^{}`]) : peeledType || objectType) as GitRef['targetType'];
      const oid = targetType === 'commit' ? peeledType === 'commit' ? peeledOid : peeledType === 'tag' ? await this.oid(repo, fullName) : objectOid : objectOid;
      return { fullName, name: fullName.replace(/^refs\/(heads|remotes|tags)\//, ''), kind, oid, targetType, ...(upstream ? { upstream } : {}) };
    })) : [];
    const stashes: Stash[] = stashOutput ? stashOutput.split('\n').map(line => { const [selector, oid, subject] = line.split('\0'); return { selector, oid, subject }; }) : [];
    const operation: OperationState = { conflicts: status.changes.filter(x => x.conflict).length, canContinue: false, canAbort: false, canSkip: false };
    const markers = await Promise.all(['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer'].map(name => exists(path.join(gitDir, name))));
    if (markers[0] || markers[1]) operation.kind = 'rebase'; else if (markers[2]) operation.kind = 'merge'; else if (markers[3]) operation.kind = 'cherry-pick'; else if (markers[4]) operation.kind = 'revert'; else if (markers[5]) {
      const todo = await readFile(path.join(gitDir, 'sequencer', 'todo'), 'utf8'); if (/^pick /m.test(todo)) operation.kind = 'cherry-pick'; else if (/^revert /m.test(todo)) operation.kind = 'revert';
    }
    if (operation.kind) { operation.canContinue = operation.conflicts === 0; operation.canAbort = true; operation.canSkip = operation.kind !== 'merge'; }
    return { repository: repo, ...status, refs, remotes: remoteOutput ? remoteOutput.split('\n') : [], stashes, worktrees, operation, version: ++this.version };
  }
  private async worktrees(repo: Repository): Promise<Worktree[]> {
    const records = decodePaths((await this.run(repo, ['worktree', 'list', '--porcelain', '-z'])).stdout).split('\0'); const result: Worktree[] = []; let current: Worktree | undefined;
    for (const record of records) { if (record.startsWith('worktree ')) { current = { path: record.slice(9), head: '', bare: false, detached: false }; result.push(current); } else if (current) { if (record.startsWith('HEAD ')) current.head = record.slice(5); else if (record.startsWith('branch ')) current.branch = record.slice(7).replace(/^refs\/heads\//, ''); else if (record === 'bare') current.bare = true; else if (record === 'detached') current.detached = true; else if (record.startsWith('locked')) current.locked = record.slice(7) || 'Locked'; else if (record.startsWith('prunable')) current.prunable = record.slice(9) || 'Prunable'; } }
    return result;
  }
  async history(repo: Repository, query: HistoryQuery = {}): Promise<HistoryPage> {
    await this.verify(repo); const offset = query.offset ?? 0; const limit = query.limit ?? 100;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new GitError('Invalid history page', 'INVALID_ARGUMENT');
    let tips: string[];
    if (query.tips) tips = await Promise.all(query.tips.map(ref => this.oid(repo, ref)));
    else if (query.ref) tips = [await this.oid(repo, query.ref)];
    else { const all = await this.text(repo, ['for-each-ref', '--format=%(refname)%00%(objecttype)%00%(*objecttype)', 'refs/heads', 'refs/remotes', 'refs/tags']); const candidates = all ? await Promise.all(all.split('\n').map(async line => { const [ref, type, peeledType] = line.split('\0'); return type === 'commit' || peeledType === 'commit' || peeledType === 'tag' && await this.text(repo, ['cat-file', '-t', `${ref}^{}`]) === 'commit' ? ref : undefined; })) : []; tips = await Promise.all(candidates.filter((ref): ref is string => !!ref).map(ref => this.oid(repo, ref))); const head = (await this.status(repo)).head; if (head) tips.push(head); }
    tips = [...new Set(tips)]; if (!tips.length) return { commits: [], nextOffset: offset, hasMore: false, tips };
    const searchArgs = query.search ? ['--fixed-strings', '--regexp-ignore-case', `--grep=${query.search}`] : [];
    if (query.search?.includes('\0')) throw new GitError('Invalid search', 'INVALID_ARGUMENT');
    const output = (await this.run(repo, ['log', '--topo-order', '-z', `--format=${commitFormat}`, `--skip=${offset}`, `--max-count=${limit + 1}`, ...searchArgs, ...tips, '--'])).stdout.toString('utf8').split('\0');
    const commits: Commit[] = []; for (let i = 0; i + 5 < output.length; i += 6) commits.push(parseCommit(output.slice(i, i + 6)));
    return { commits: commits.slice(0, limit), nextOffset: offset + Math.min(commits.length, limit), hasMore: commits.length > limit, tips };
  }
  async details(repo: Repository, revision: string, parent?: string): Promise<CommitDetails> {
    await this.verify(repo); const oid = await this.oid(repo, revision); const data = (await this.run(repo, ['show', '-s', `--format=${commitFormat}%x00%B`, oid, '--'])).stdout.toString('utf8').split('\0'); const commit = parseCommit(data);
    const base = parent ? await this.oid(repo, parent) : commit.parents[0];
    if (base && !commit.parents.includes(base)) throw new GitError('Selected parent is not a parent of this commit', 'INVALID_PARENT');
    const args = ['diff-tree', '--no-commit-id', '--name-status', '-z', '-r', '-M', ...(base ? [base, oid] : ['--root', oid]), '--']; const names = decodePaths((await this.run(repo, args)).stdout).split('\0'); const files: CommitFile[] = [];
    for (let i = 0; i < names.length && names[i];) { const status = names[i++]; const name = names[i++]; if (status.startsWith('R') || status.startsWith('C')) files.push({ status, previousPath: name, path: names[i++] }); else files.push({ status, path: name }); }
    return { commit, body: data.slice(6).join('\0').trimEnd(), files, ...(base ? { parent: base } : {}) };
  }
  async content(repo: Repository, source: ContentSource, maxBytes?: number): Promise<Buffer> {
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024 * 1024)) throw new GitError('Invalid content limit', 'INVALID_ARGUMENT');
    if (source.kind === 'empty') return Buffer.alloc(0); await this.verify(repo); const name = validateFilePath(source.path); let object: string | undefined;
    if (source.kind === 'revision') { const oid = await this.oid(repo, source.revision); const records = decodePaths((await this.run(repo, ['ls-tree', '-z', oid, '--', name])).stdout).split('\0'); for (const record of records) { const tab = record.indexOf('\t'); if (record.slice(tab + 1) === name) { const meta = record.slice(0, tab).split(' '); if (meta[1] !== 'blob') throw new GitError('The selected path is not a file', 'INVALID_PATH'); object = meta[2]; } } }
    else { const stage = source.stage ?? 0; if (![0, 1, 2, 3].includes(stage)) throw new GitError('Invalid index stage', 'INVALID_ARGUMENT'); const records = decodePaths((await this.run(repo, ['ls-files', '--stage', '-z', '--', name])).stdout).split('\0'); for (const record of records) { const tab = record.indexOf('\t'); const meta = record.slice(0, tab).split(' '); if (record.slice(tab + 1) === name && Number(meta[2]) === stage) object = meta[1]; } }
    return object ? (await this.run(repo, ['cat-file', 'blob', object], false, maxBytes)).stdout : Buffer.alloc(0);
  }
  async execute(repo: Repository, action: GitAction): Promise<void> {
    const key = normalized(repo.commonDir); const prior = queues.get(key) ?? Promise.resolve();
    const operation = prior.catch(() => {}).then(async () => { await this.verify(repo); await this.executeNow(repo, action); });
    queues.set(key, operation); try { await operation; } finally { if (queues.get(key) === operation) queues.delete(key); }
  }
  private async checkout(repo: Repository, target: string, detached = false, stashFirst = false, includeUntracked = false): Promise<void> {
    const resolved = detached ? await this.oid(repo, target) : await this.refName(repo, target);
    if (!detached) await this.oid(repo, `refs/heads/${resolved}`);
    const snapshot = await this.snapshot(repo);
    const conflictPaths = snapshot.changes.filter(change => change.conflict).map(change => change.path);
    if (conflictPaths.length || snapshot.operation.kind) {
      throw new GitError(conflictPaths.length ? 'Resolve conflicts or Abort the active Git operation before Checkout.' : `Continue or Abort the active ${snapshot.operation.kind} before Checkout.`, 'CHECKOUT_BLOCKED', '', '', { reason: conflictPaths.length ? 'conflicts' : 'operation-active', paths: conflictPaths, target });
    }
    const occupied = !detached && snapshot.worktrees.find(tree => tree.branch === target && normalized(tree.path) !== normalized(repo.root));
    if (occupied) throw new GitError(`Branch ${target} is checked out in ${occupied.path}. Open that Worktree to use this branch.`, 'WORKTREE_OCCUPIED', '', '', { reason: 'worktree-occupied', paths: [], target, worktreePath: occupied.path });
    let stashOid: string | undefined;
    if (stashFirst) {
      const previous = snapshot.stashes[0]?.oid;
      await this.run(repo, ['stash', 'push', ...(includeUntracked ? ['--include-untracked'] : []), '-m', `AlwayGit: before Checkout ${target}`]);
      const top = await this.run(repo, ['rev-parse', '--verify', 'refs/stash'], true);
      const saved = top.code ? undefined : top.stdout.toString('utf8').trim();
      if (saved !== previous) stashOid = saved;
    }
    try {
      await this.run(repo, ['-c', 'core.quotePath=false', 'switch', ...(detached ? ['--detach'] : []), '--', resolved]);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      const blocked = /would be overwritten|local changes|needs merge|unmerged/i.test(cause);
      const listed = cause.split(/\r?\n/).filter(line => /^\t/.test(line)).map(line => line.slice(1));
      const current = await this.status(repo).catch(() => ({ changes: snapshot.changes }));
      // Porcelain paths are authoritative even for filenames which Git quotes in its diagnostic.
      const affected = listed.length ? current.changes.filter(change => listed.includes(change.path) || listed.includes(change.originalPath ?? '')).map(change => change.path) : [];
      const paths = blocked ? (affected.length ? affected : current.changes.map(change => change.path)) : [];
      const details: CheckoutBlocker = { reason: blocked ? 'local-changes' : 'checkout-failed', paths, target, ...(stashOid ? { stashCreated: true, stashOid } : stashFirst ? { stashCreated: false } : {}) };
      const message = `${cause}${stashOid ? `\nStash ${stashOid} was created and retained. Checkout did not complete; your saved changes remain in Stashes.` : ''}`;
      throw new GitError(message, blocked ? 'CHECKOUT_BLOCKED' : error instanceof GitError ? error.code : 'CHECKOUT_FAILED', error instanceof GitError ? error.stdout : '', error instanceof GitError ? error.stderr : '', details);
    }
  }
  private async validateStash(repo: Repository, selector: string, expectedOid?: string): Promise<string> {
    if (!/^stash@\{\d+\}$/.test(selector)) throw new GitError('Invalid stash selector', 'INVALID_ARGUMENT');
    if (expectedOid) {
      token(expectedOid, 'stash ID');
      const current = await this.run(repo, ['rev-parse', '--verify', '--end-of-options', `${selector}^{commit}`], true);
      if (current.code || current.stdout.toString('utf8').trim() !== expectedOid) throw new GitError('The Stash list changed. Refresh and select the saved entry again.', 'STASH_CHANGED');
    }
    return selector;
  }
  private async executeNow(repo: Repository, action: GitAction): Promise<void> {
    let args: string[]; const remote = (value?: string) => value ? [token(value, 'remote')] : [];
    switch (action.type) {
      case 'stage': case 'unstage': case 'discard': {
        if (!action.paths.length) throw new GitError('Select at least one file', 'INVALID_ARGUMENT'); const paths = action.paths.map(validateFilePath);
        const status = await this.status(repo);
        const relatedPaths = (area: 'indexStatus' | 'worktreeStatus') => [...new Set(paths.flatMap(name => { const rename = status.changes.find(change => change[area] === 'R' && change.originalPath && (change.path === name || change.originalPath === name)); return rename ? [validateFilePath(rename.path), validateFilePath(rename.originalPath!)] : [name]; }))];
        if (action.type === 'stage') args = ['add', '--', ...relatedPaths('worktreeStatus')];
        else if (action.type === 'unstage') { const selected = relatedPaths('indexStatus'); args = status.head ? ['restore', '--staged', '--source=HEAD', '--', ...selected] : ['rm', '-f', '--cached', '--ignore-unmatch', '--', ...selected]; }
        else {
          const renames = status.changes.filter(change => change.worktreeStatus === 'R' && change.originalPath && (paths.includes(change.path) || paths.includes(change.originalPath)));
          // A worktree rename's destination is normally an intent-to-add entry. Prove
          // that before removing it, so a genuine staged destination stays protected.
          for (const rename of renames) {
            validateFilePath(rename.path); validateFilePath(rename.originalPath!);
            const visible = decodePaths((await this.run(repo, ['diff', '--cached', '--ita-visible-in-index', '--name-only', '-z', '--', rename.path])).stdout).split('\0');
            const invisible = decodePaths((await this.run(repo, ['diff', '--cached', '--ita-invisible-in-index', '--name-only', '-z', '--', rename.path])).stdout).split('\0');
            if (!visible.includes(rename.path) || invisible.includes(rename.path)) throw new GitError('The rename destination has staged content. Unstage the rename before discarding it.', 'STAGED_RENAME_DESTINATION');
          }
          const destinations = renames.map(rename => rename.path);
          const untracked = [...new Set([...paths.filter(name => status.changes.some(change => change.path === name && change.untracked)), ...destinations])];
          const tracked = [...new Set([...paths.filter(name => !untracked.includes(name)), ...renames.map(rename => rename.originalPath!)])];
          if (tracked.length) await this.run(repo, ['restore', '--worktree', '--', ...tracked]);
          if (destinations.length) await this.run(repo, ['rm', '-f', '--cached', '--', ...destinations]);
          if (destinations.length) await this.run(repo, ['clean', '-f', '-x', '--', ...destinations]);
          const otherUntracked = untracked.filter(name => !destinations.includes(name));
          if (otherUntracked.length) await this.run(repo, ['clean', '-f', '--', ...otherUntracked]); return;
        }
        break;
      }
      case 'commit': if (!action.message.trim() || action.message.includes('\0')) throw new GitError('Enter a commit message', 'INVALID_ARGUMENT'); args = ['commit', ...(action.amend ? ['--amend'] : []), '-m', action.message]; break;
      case 'fetch': args = ['fetch', ...remote(action.remote)]; break;
      case 'pull': if (!['ff-only', 'merge', 'rebase'].includes(action.strategy)) throw new GitError('Invalid pull strategy', 'INVALID_ARGUMENT'); args = ['pull', ...(action.strategy === 'merge' ? ['--no-rebase', '--ff'] : [`--${action.strategy}`]), ...remote(action.remote)]; break;
      case 'push': {
        const branch = action.branch ? await this.refName(repo, action.branch) : undefined; let destination = action.remote;
        if (branch) { await this.oid(repo, `refs/heads/${branch}`); if (!destination) { const configured = await this.run(repo, ['config', '--get', `branch.${branch}.remote`], true); if (configured.code > 1) throw new GitError(configured.stderr.toString('utf8'), 'GIT_FAILED'); destination = configured.stdout.toString('utf8').trim(); if (!destination) { const remotes = (await this.text(repo, ['remote'])).split('\n').filter(Boolean); if (remotes.length !== 1) throw new GitError('Select a remote before pushing this branch', 'INVALID_ARGUMENT'); destination = remotes[0]; } } }
        args = ['push', ...(branch ? ['--set-upstream'] : []), ...(action.forceWithLease ? ['--force-with-lease'] : []), ...remote(destination), ...(branch ? [`refs/heads/${branch}:refs/heads/${branch}`] : [])]; break;
      }
      case 'branch.create': {
        const name = await this.refName(repo, action.name); const start = action.start ? await this.oid(repo, action.start) : undefined; const upstream = action.start?.startsWith('refs/remotes/') ? action.start : undefined;
        if (upstream) await this.run(repo, ['show-ref', '--verify', '--', upstream]); args = action.checkout ? ['switch', '-c', name] : ['branch', name]; if (start) args.push(start); await this.run(repo, args); if (upstream) await this.run(repo, ['branch', `--set-upstream-to=${upstream}`, '--', name]); return;
      }
      case 'branch.checkout': return this.checkout(repo, action.name);
      case 'commit.checkout': return this.checkout(repo, action.target, true);
      case 'checkout.stash': return this.checkout(repo, action.target, action.detached, true, action.includeUntracked);
      case 'branch.delete': args = ['branch', action.force ? '-D' : '-d', '--', await this.refName(repo, action.name)]; break;
      case 'tag.create': await this.run(repo, ['check-ref-format', `refs/tags/${token(action.name, 'tag name')}`]); args = ['tag', ...(action.message ? ['-a', '-m', action.message] : []), action.name, await this.oid(repo, action.target ?? 'HEAD')]; break;
      case 'tag.delete': await this.run(repo, ['check-ref-format', `refs/tags/${token(action.name, 'tag name')}`]); args = ['tag', '-d', '--', action.name]; break;
      case 'stash.create': args = ['stash', 'push', ...(action.includeUntracked ? ['--include-untracked'] : []), ...(action.message ? ['-m', action.message] : [])]; break;
      case 'stash.apply': {
        const selector = await this.validateStash(repo, action.selector, action.expectedOid);
        if (action.expectedOid) {
          // Apply the captured object rather than a reflog position which can move externally.
          await this.run(repo, ['stash', 'apply', action.expectedOid]);
          if (action.pop) {
            try { await this.validateStash(repo, selector, action.expectedOid); }
            catch { throw new GitError('Stash changes were applied, but the Stash list changed before Drop. The saved entry was retained; refresh the list.', 'STASH_CHANGED'); }
            await this.run(repo, ['stash', 'drop', selector]);
          }
          return;
        }
        args = ['stash', action.pop ? 'pop' : 'apply', selector]; break;
      }
      case 'stash.drop': args = ['stash', 'drop', await this.validateStash(repo, action.selector, action.expectedOid)]; break;
      case 'worktree.add': {
        token(action.path, 'worktree path'); if (action.detach && (action.branch || action.newBranch)) throw new GitError('Detached worktrees cannot also select a branch', 'INVALID_ARGUMENT'); if (action.branch && action.newBranch) throw new GitError('Choose an existing or a new branch', 'INVALID_ARGUMENT');
        const target = path.resolve(repo.root, action.path); const current = await this.worktrees(repo); if (current.some(x => normalized(x.path) === normalized(target))) throw new GitError('Worktree already registered', 'INVALID_WORKTREE');
        args = ['worktree', 'add', ...(action.detach ? ['--detach'] : []), ...(action.newBranch ? ['-b', await this.refName(repo, action.newBranch)] : []), '--', target];
        if (action.branch) { await this.refName(repo, action.branch); args.push(await this.oid(repo, `refs/heads/${action.branch}`)); if (!action.detach) args[args.length - 1] = action.branch; } else if (action.start) args.push(await this.oid(repo, action.start)); break;
      }
      case 'worktree.remove': { token(action.path, 'worktree path'); const target = await canonicalPath(path.resolve(repo.root, action.path)); const trees = await this.worktrees(repo); const canonical = await Promise.all(trees.map(tree => canonicalPath(tree.path))); const selected = trees.find((_, index) => normalized(canonical[index]) === normalized(target)); if (!selected || normalized(target) === normalized(canonical[0]) || normalized(target) === normalized(repo.root)) throw new GitError('Only registered linked worktrees other than the current Worktree can be removed', 'INVALID_WORKTREE'); if (selected.locked) throw new GitError(`This Worktree is Locked: ${selected.locked}. Unlock it before removal.`, 'WORKTREE_LOCKED'); args = ['worktree', 'remove', ...(action.force ? ['--force'] : []), '--', selected.path]; break; }
      case 'merge': case 'rebase': args = [action.type, await this.oid(repo, action.target)]; break;
      case 'cherry-pick': case 'revert': if (!action.commits.length) throw new GitError('Select commits', 'INVALID_ARGUMENT'); if (action.mainline !== undefined && (!Number.isSafeInteger(action.mainline) || action.mainline < 1)) throw new GitError('Invalid merge parent number', 'INVALID_ARGUMENT'); args = [action.type, ...(action.mainline ? ['-m', String(action.mainline)] : []), ...(await Promise.all(action.commits.map(x => this.oid(repo, x))))]; break;
      case 'reset': if (!['soft', 'mixed', 'hard'].includes(action.mode)) throw new GitError('Invalid reset mode', 'INVALID_ARGUMENT'); args = ['reset', `--${action.mode}`, await this.oid(repo, action.target), '--']; break;
      case 'operation.continue': case 'operation.abort': case 'operation.skip': { const state = (await this.snapshot(repo)).operation; if (!state.kind || state.kind !== action.kind) throw new GitError('The selected Git operation is no longer active', 'OPERATION_CHANGED'); const command = action.type.split('.')[1]; if (command === 'skip' && !state.canSkip) throw new GitError('This operation cannot be skipped', 'INVALID_ARGUMENT'); if (command === 'continue' && !state.canContinue) throw new GitError('Resolve conflicts before continuing', 'CONFLICTS'); args = [action.kind, `--${command}`]; break; }
      default: throw new GitError('Unsupported Git action', 'INVALID_ARGUMENT');
    }
    await this.run(repo, args);
  }
}
