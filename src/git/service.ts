import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActionBlocker, Change, CheckoutBlocker, Commit, CommitComparison, CommitDetails, CommitFile, ContentSource, GitAction, GitRef, GitServiceContract, HistoryPage, HistoryQuery, OperationReview, OperationState, Repository, RepositoryStatus, Snapshot, Stash, StashApplyBlocker, StashDetails, Worktree } from '../protocol/types';
import { branchNameConflict, branchNameConflictMessage, branchNameProblem, branchNameProblemMessage } from '../protocol/ref-name';
import { remoteNameProblem, remoteUrlProblem } from '../protocol/remote';
import { inferDefaultBranch } from './default-branch';
import { createSelectedStash, preflightStash, StashStateError, type StashExecution } from './stash';

export interface GitServiceOptions {
  allowDetachedHead?: () => boolean;
  gitPath?: string;
  onOutput?: (repo: Repository, text: string) => void;
  timeoutMs?: number;
  maxOutputBytes?: number;
  environment?: NodeJS.ProcessEnv | ((repo: Repository, args: readonly string[]) => Promise<NodeJS.ProcessEnv | { env: NodeJS.ProcessEnv; dispose?: () => void | Promise<void> }>);
}
export class GitError extends Error {
  constructor(message: string, public readonly code: string, public readonly stdout = '', public readonly stderr = '', public readonly details?: ActionBlocker) { super(message); this.name = 'GitError'; }
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
function parseCommitFiles(output:Buffer):CommitFile[]{const names=decodePaths(output).split('\0'),files:CommitFile[]=[];for(let i=0;i<names.length&&names[i];){const status=names[i++],name=names[i++];if(status.startsWith('R')||status.startsWith('C'))files.push({status,previousPath:name,path:names[i++]});else files.push({status,path:name});}return files;}
const commitFormat = '%H%x00%P%x00%an%x00%ae%x00%at%x00%s';

export class GitService implements GitServiceContract {
  private version = 0;
  private readonly reviews = new Map<string, { token: string; fingerprint: string }>();
  constructor(private readonly options: GitServiceOptions = {}) {}
  private async run(repo: Repository, args: string[], allowFailure = false, captureBytes?: number, execution: StashExecution = {}): Promise<Result> {
    const adapter = this.options.environment;
    const supplied = execution.isolated ? undefined : typeof adapter === 'function' ? await adapter(repo, args) : adapter;
    const wrapped = supplied && 'env' in supplied && typeof supplied.env === 'object' ? supplied as { env: NodeJS.ProcessEnv; dispose?: () => void | Promise<void> } : undefined;
    const env = wrapped?.env ?? supplied as NodeJS.ProcessEnv | undefined;
    const commandEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
    if (execution.isolated) for (const key of Object.keys(commandEnv)) if (/^GIT_/i.test(key)) delete commandEnv[key];
    try {
      const result = await new Promise<Result>((resolve, reject) => {
        // Stash accepts no user pathspecs in this API. Its internal cleanup relies on
        // Git pathspec matching; inheriting --literal-pathspecs leaves saved untracked
        // files behind on Git for Windows. All file actions still use literal paths.
        const child = spawn(this.options.gitPath ?? 'git', ['-C', execution.root ?? repo.root, ...(args[0] === 'stash' ? [] : ['--literal-pathspecs']), ...args], { shell: false, windowsHide: true, detached: process.platform !== 'win32', env: { ...commandEnv, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', ...(['status', 'log', 'show', 'ls-tree', 'ls-files', 'for-each-ref'].includes(args[0]) ? { GIT_OPTIONAL_LOCKS: '0' } : {}), ...execution.env }, stdio: [execution.input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
        if (execution.input) { child.stdin?.on('error', () => {}); child.stdin?.end(execution.input); }
        const out: Buffer[] = []; const err: Buffer[] = []; let size = 0; let captured = 0; let failure: GitError | undefined;
        const stop = (error: GitError) => { failure = error; if (child.pid) { if (process.platform === 'win32') { const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' }); killer.on('error', () => child.kill()); } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill(); } } } child.stdout!.destroy(); child.stderr!.destroy(); reject(error); };
        const timer = setTimeout(() => stop(new GitError('Git timed out. Check credentials, hooks, or another Git process, then retry.', 'TIMEOUT')), this.options.timeoutMs ?? 60000);
        const collect = (bucket: Buffer[], chunk: Buffer) => { if (bucket === out && captureBytes !== undefined) { const remaining = captureBytes - captured; if (remaining > 0) { const piece = chunk.subarray(0, remaining); bucket.push(piece); captured += piece.length; } return; } size += chunk.length; if (size > (this.options.maxOutputBytes ?? 32 * 1024 * 1024)) { clearTimeout(timer); stop(new GitError('Git output exceeded the configured limit', 'OUTPUT_LIMIT')); return; } bucket.push(chunk); if (bucket === err && !execution.silent) this.options.onOutput?.(repo, chunk.toString('utf8')); };
        child.stdout!.on('data', chunk => collect(out, chunk)); child.stderr!.on('data', chunk => collect(err, chunk));
        child.once('error', e => { clearTimeout(timer); reject(new GitError(`Cannot run Git: ${e.message}`, 'GIT_UNAVAILABLE')); });
        child.once('close', code => { clearTimeout(timer); if (failure) reject(failure); else resolve({ stdout: Buffer.concat(out), stderr: Buffer.concat(err), code: code ?? 1 }); });
      });
      if (!execution.silent && result.stdout.length && ['add', 'restore', 'rm', 'clean', 'commit', 'fetch', 'pull', 'push', 'branch', 'switch', 'tag', 'stash', 'worktree', 'merge', 'rebase', 'cherry-pick', 'revert', 'reset'].includes(args[0]) && !(args[0] === 'stash' && args[1] === 'list') && !(args[0] === 'worktree' && args[1] === 'list')) this.options.onOutput?.(repo, result.stdout.toString('utf8'));
      if (result.code && !allowFailure && !execution.allowFailure) {
        const stdout = result.stdout.toString('utf8'); const stderr = result.stderr.toString('utf8');
        const hint = /authentication|could not read Username|terminal prompts disabled|permission denied|credential/i.test(stderr) ? '\nConfigure Git credentials or sign in, then retry.' : /index.lock|another git process/i.test(stderr) ? '\nAnother Git process is using this repository. Finish it and retry.' : '';
        throw new GitError((stderr.trim() || stdout.trim() || `Git exited with status ${result.code}`) + hint, 'GIT_FAILED', stdout, stderr);
      }
      return result;
    } finally { await wrapped?.dispose?.(); }
  }
  private async text(repo: Repository, args: string[]): Promise<string> { return (await this.run(repo, args)).stdout.toString('utf8').trim(); }
  private async optionalConfig(repo: Repository, key: string): Promise<string | undefined> {
    const result = await this.run(repo, ['config', '--get', key], true);
    if (result.code > 1) throw new GitError(result.stderr.toString('utf8').trim() || `Cannot read Git configuration ${key}`, 'GIT_FAILED');
    return result.stdout.toString('utf8').trim() || undefined;
  }
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
    const gitDir = await realpath(await this.text(provisional, ['rev-parse', '--path-format=absolute', '--git-dir']));
    if (normalized(gitDir) === normalized(provisional.commonDir)) provisional.mainRoot = provisional.root;
    else {
      const [main] = await this.worktrees(provisional);
      if (main && !main.bare) provisional.mainRoot = await canonicalPath(main.path);
    }
    return provisional;
  }
  private async verify(repo: Repository) { const current = await this.discover(repo.root); if (normalized(current.commonDir) !== normalized(repo.commonDir) || current.id !== repo.id) throw new GitError('Repository changed; reopen it before continuing', 'REPOSITORY_CHANGED'); return current; }
  private async oid(repo: Repository, revision: string): Promise<string> { token(revision, 'revision'); return this.text(repo, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]); }
  private async refName(repo: Repository, name: string): Promise<string> { const problem=branchNameProblem(name);if(problem)throw new GitError(branchNameProblemMessage(problem),'INVALID_BRANCH_NAME');await this.run(repo, ['check-ref-format', `refs/heads/${name}`]); return name; }
  private async status(repo: Repository) { return parseStatus((await this.run(repo, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])).stdout); }
  private async unpushed(repo: Repository): Promise<number> {
    const result = await this.run(repo, ['rev-list', '--count', 'HEAD', '--not', '--remotes'], true);
    const count = Number.parseInt(result.stdout.toString('utf8').trim(), 10);
    return result.code === 0 && Number.isSafeInteger(count) && count > 0 ? count : 0;
  }
  async repositoryStatus(repo: Repository): Promise<RepositoryStatus> {
    await this.verify(repo);
    const [statusOutput, unpushed] = await Promise.all([this.run(repo, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=no']), this.unpushed(repo)]);
    const status = parseStatus(statusOutput.stdout);
    return { repositoryId: repo.id, branch: status.branch, ...(status.upstream ? { upstream: status.upstream } : {}), ahead: status.ahead, unpushed: status.branch ? unpushed : 0 };
  }
  async snapshot(repo: Repository): Promise<Snapshot> {
    await this.verify(repo);
    const [status, refsOutput, stashOutput, worktrees, gitDir, remoteOutput, unpushed] = await Promise.all([this.status(repo), this.text(repo, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream:short)%00%(*objectname)%00%(*objecttype)%00%(objecttype)%00%(symref)', 'refs/heads', 'refs/remotes', 'refs/tags']), this.text(repo, ['stash', 'list', '--format=%gd%x00%H%x00%s']), this.worktrees(repo), this.text(repo, ['rev-parse', '--path-format=absolute', '--git-dir']), this.text(repo, ['remote']), this.unpushed(repo)]);
    const refs: GitRef[] = refsOutput ? await Promise.all(refsOutput.split('\n').map(async line => {
      const [fullName, objectOid, upstream, peeledOid, peeledType, objectType, symbolicTarget] = line.split('\0');
      const kind: GitRef['kind'] = fullName.startsWith('refs/heads/') ? 'local' : fullName.startsWith('refs/remotes/') ? 'remote' : 'tag';
      // for-each-ref's starred fields peel one annotated-tag layer. Dereference
      // nested tags fully before deciding whether Commit actions are meaningful.
      const targetType = (peeledType === 'tag' ? await this.text(repo, ['cat-file', '-t', `${fullName}^{}`]) : peeledType || objectType) as GitRef['targetType'];
      const oid = targetType === 'commit' ? peeledType === 'commit' ? peeledOid : peeledType === 'tag' ? await this.oid(repo, fullName) : objectOid : objectOid;
      return { fullName, name: fullName.replace(/^refs\/(heads|remotes|tags)\//, ''), kind, oid, targetType, ...(upstream ? { upstream } : {}), ...(symbolicTarget ? { symbolicTarget } : {}) };
    })) : [];
    const stashes: Stash[] = stashOutput ? stashOutput.split('\n').map(line => { const [selector, oid, subject] = line.split('\0'); return { selector, oid, subject }; }) : [];
    const remotes = remoteOutput ? remoteOutput.split('\n') : [];
    const defaultBranch=inferDefaultBranch(refs,remotes,status.upstream);
    const operation: OperationState = { conflicts: status.changes.filter(x => x.conflict).length, canContinue: false, canAbort: false, canSkip: false };
    const markers = await Promise.all(['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer'].map(name => exists(path.join(gitDir, name))));
    if (markers[0] || markers[1]) operation.kind = 'rebase'; else if (markers[2]) operation.kind = 'merge'; else if (markers[3]) operation.kind = 'cherry-pick'; else if (markers[4]) operation.kind = 'revert'; else if (markers[5]) {
      const todo = await readFile(path.join(gitDir, 'sequencer', 'todo'), 'utf8'); if (/^pick /m.test(todo)) operation.kind = 'cherry-pick'; else if (/^revert /m.test(todo)) operation.kind = 'revert';
    }
    if (operation.kind) {
      operation.canContinue = operation.conflicts === 0; operation.canAbort = true; operation.canSkip = operation.kind !== 'merge';
      const original = operation.kind === 'merge' ? status.head : await this.readOperationFile(gitDir, markers[0] ? 'rebase-merge/orig-head' : markers[1] ? 'rebase-apply/orig-head' : 'sequencer/head');
      if (original && /^[a-f0-9]{40,64}$/.test(original.trim())) operation.originalHead = original.trim();
    }
    let pushTarget: Snapshot['pushTarget'];
    if (status.branch) {
      const [branchPushRemote, defaultPushRemote, branchRemote, mergeRef] = await Promise.all([
        this.optionalConfig(repo, `branch.${status.branch}.pushRemote`),
        this.optionalConfig(repo, 'remote.pushDefault'),
        this.optionalConfig(repo, `branch.${status.branch}.remote`),
        this.optionalConfig(repo, `branch.${status.branch}.merge`),
      ]);
      const upstream = refs.find(ref => ref.kind === 'local' && ref.name === status.branch)?.upstream ?? status.upstream;
      const upstreamRemote = remotes.slice().sort((a,b)=>b.length-a.length).find(remote => upstream?.startsWith(`${remote}/`));
      const remote = branchPushRemote ?? defaultPushRemote ?? branchRemote ?? upstreamRemote ?? (remotes.length === 1 ? remotes[0] : undefined);
      const upstreamBranch = upstreamRemote ? upstream!.slice(upstreamRemote.length + 1) : undefined;
      const configuredBranch = mergeRef?.replace(/^refs\/heads\//, '');
      const remoteBranch = remote && remote === upstreamRemote && upstreamBranch ? upstreamBranch : remote && remote === branchRemote && configuredBranch ? configuredBranch : status.branch;
      pushTarget = { localBranch: status.branch, ...(remote ? { remote } : {}), remoteBranch, configured: !!upstream };
    }
    return { repository: repo, ...status, unpushed: status.branch ? unpushed : 0, refs, remotes, ...(defaultBranch ? { defaultBranch } : {}), ...(pushTarget ? { pushTarget } : {}), stashes, worktrees, operation, version: ++this.version };
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
    tips = [...new Set(tips)];
    const searchArgs = query.search ? ['--fixed-strings', '--regexp-ignore-case', `--grep=${query.search}`] : [];
    if (query.search?.includes('\0')) throw new GitError('Invalid search', 'INVALID_ARGUMENT');
    const output = tips.length ? (await this.run(repo, ['log', '--topo-order', '-z', `--format=${commitFormat}`, `--skip=${offset}`, `--max-count=${limit + 1}`, ...searchArgs, ...tips, '--'])).stdout.toString('utf8').split('\0') : [];
    const commits: Commit[] = []; for (let i = 0; i + 5 < output.length; i += 6) commits.push(parseCommit(output.slice(i, i + 6)));
    const visible = commits.slice(0, limit);
    if (visible.length) {
      // Remote availability is based on locally known remote-tracking refs. The
      // same search filter keeps the bounded query aligned with history paging.
      const localOnlyOutput = await this.text(repo, ['rev-list', '--topo-order', `--max-count=${offset + limit + 1}`, ...searchArgs, ...tips, '--not', '--remotes', '--']);
      const localOnly = new Set(localOnlyOutput ? localOnlyOutput.split('\n') : []);
      for (const commit of visible) commit.pushed = !localOnly.has(commit.oid);
    }
    let head = query.head ? visible.find(commit => commit.oid === query.head) : undefined;
    if (query.head && !head) {
      const oid = await this.oid(repo, query.head);
      const data = await this.text(repo, ['show', '-s', `--format=${commitFormat}`, oid, '--']);
      head = parseCommit(data.split('\0'));
      const localOnly = await this.text(repo, ['rev-list', '--max-count=1', oid, '--not', '--remotes']);
      head.pushed = localOnly !== oid;
    }
    return { commits: visible, nextOffset: offset + Math.min(commits.length, limit), hasMore: commits.length > limit, tips, ...(head ? { head } : {}) };
  }
  async details(repo: Repository, revision: string, parent?: string): Promise<CommitDetails> {
    await this.verify(repo); const oid = await this.oid(repo, revision); const data = (await this.run(repo, ['show', '-s', `--format=${commitFormat}%x00%B`, oid, '--'])).stdout.toString('utf8').split('\0'); const commit = parseCommit(data);
    const base = parent ? await this.oid(repo, parent) : commit.parents[0];
    if (base && !commit.parents.includes(base)) throw new GitError('Selected parent is not a parent of this commit', 'INVALID_PARENT');
    const args = ['diff-tree', '--no-commit-id', '--name-status', '-z', '-r', '-M', ...(base ? [base, oid] : ['--root', oid]), '--']; const files=parseCommitFiles((await this.run(repo,args)).stdout);
    return { commit, body: data.slice(6).join('\0').trimEnd(), files, ...(base ? { parent: base } : {}) };
  }
  async stashDetails(repo: Repository, revision: string): Promise<StashDetails> {
    const stash = await this.details(repo, revision), [, indexOid, untrackedOid] = stash.commit.parents;
    if (!indexOid) throw new GitError('The selected object is not a Stash.', 'INVALID_STASH');
    const [working, index, untracked] = await Promise.all([
      this.details(repo, stash.commit.oid, indexOid),
      this.details(repo, indexOid),
      untrackedOid ? this.details(repo, untrackedOid) : Promise.resolve(undefined),
    ]);
    const paths = new Set([...working.files, ...index.files, ...(untracked?.files ?? [])].map(file => file.path));
    return { commit: stash.commit, body: stash.body, sections: { working, index, ...(untracked ? { untracked } : {}) }, totalFiles: paths.size };
  }
  private async existingStashPaths(repo: Repository, files: CommitFile[]): Promise<string[]> {
    const conflicts: string[] = [];
    for (const file of files) {
      const name = validateFilePath(file.path), parts = name.split('/');
      let current = repo.root;
      for (let index = 0; index < parts.length; index++) {
        current = path.join(current, parts[index]);
        try {
          const stat = await lstat(current);
          if (index === parts.length - 1 || stat.isSymbolicLink() || !stat.isDirectory()) { conflicts.push(name); break; }
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') break;
          if (code === 'ENOTDIR') { conflicts.push(name); break; }
          throw error;
        }
      }
    }
    return conflicts;
  }
  async compare(repo:Repository,leftRevision:string,rightRevision:string,preserveOrder=false):Promise<CommitComparison>{
    await this.verify(repo);let left=await this.oid(repo,leftRevision),right=await this.oid(repo,rightRevision);
    if(!preserveOrder){const leftAncestor=await this.run(repo,['merge-base','--is-ancestor',left,right],true),rightAncestor=leftAncestor.code===0?undefined:await this.run(repo,['merge-base','--is-ancestor',right,left],true);if(rightAncestor?.code===0)[left,right]=[right,left];}
    const [leftData,rightData,diff]=await Promise.all([this.text(repo,['show','-s',`--format=${commitFormat}`,left,'--']),this.text(repo,['show','-s',`--format=${commitFormat}`,right,'--']),this.run(repo,['diff','--name-status','-z','-M',left,right,'--'])]);
    return {left:parseCommit(leftData.split('\0')),right:parseCommit(rightData.split('\0')),files:parseCommitFiles(diff.stdout)};
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
  private async readOperationFile(gitDir: string, name: string): Promise<string> {
    try { return await readFile(path.join(gitDir, name), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; }
  }
  private async reviewFingerprint(repo: Repository, snapshot: Snapshot, tree: string): Promise<string> {
    const gitDir = await this.text(repo, ['rev-parse', '--path-format=absolute', '--git-dir']);
    const markers = await Promise.all(['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer/head', 'sequencer/todo', 'rebase-merge/onto', 'rebase-merge/orig-head', 'rebase-merge/done', 'rebase-merge/git-rebase-todo', 'rebase-apply/next', 'rebase-apply/last', 'rebase-apply/orig-head'].map(name => this.readOperationFile(gitDir, name)));
    return createHash('sha256').update(JSON.stringify([repo.id, snapshot.branch, snapshot.head, snapshot.operation.kind, tree, markers])).digest('hex');
  }
  async reviewOperation(repo: Repository): Promise<OperationReview> {
    const snapshot = await this.snapshot(repo), kind = snapshot.operation.kind;
    if (!kind) throw new GitError('The Git operation is no longer active. Refresh before continuing.', 'OPERATION_CHANGED');
    if (!snapshot.operation.canContinue) throw new GitError('Resolve conflicts before continuing', 'CONFLICTS');
    // Scan an immutable tree, rather than working files or a truncated Diff preview.
    const tree = await this.text(repo, ['write-tree']), fingerprint = await this.reviewFingerprint(repo, snapshot, tree);
    const paths = decodePaths((await this.run(repo, ['diff', '--name-only', '--no-renames', '-z', snapshot.head!, tree, '--'])).stdout).split('\0').filter(Boolean);
    const records = decodePaths((await this.run(repo, ['ls-tree', '-r', '-z', tree])).stdout).split('\0');
    const entries = new Map(records.filter(Boolean).map(record => { const tab = record.indexOf('\t'); return [record.slice(tab + 1), record.slice(0, tab).split(' ')]; }));
    const files: OperationReview['files'] = [];
    let remaining = 16 * 1024 * 1024;
    for (const name of paths) {
      const entry = entries.get(name); if (!entry) continue; // Staged deletions contain no text.
      const file: OperationReview['files'][number] = { path: name, lines: [] }; files.push(file);
      if (entry[1] !== 'blob') { file.skipped = 'submodule'; continue; }
      const size = Number(await this.text(repo, ['cat-file', '-s', entry[2]]));
      if (size > 2 * 1024 * 1024) { file.skipped = 'large'; continue; }
      if (size > remaining) { file.skipped = 'limit'; continue; }
      remaining -= size;
      const bytes = (await this.run(repo, ['cat-file', 'blob', entry[2]], false, size + 1)).stdout;
      if (bytes.includes(0)) { file.skipped = 'binary'; continue; }
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { file.skipped = 'encoding'; continue; }
      text.split(/\r?\n/).forEach((line, index) => {
        // Include diff3/zdiff3 base markers and non-default marker widths. A single
        // leftover marker is suspicious too; explicit confirmation allows literal text.
        if (/^(?:<{7,}(?: .*)?|\|{7,}(?: .*)?|={7,}|>{7,}(?: .*)?)$/.test(line)) {
          if (file.lines.length < 100) file.lines.push(index + 1); else file.more = true;
        }
      });
    }
    const current = await this.snapshot(repo);
    if (!current.operation.canContinue || fingerprint !== await this.reviewFingerprint(repo, current, await this.text(repo, ['write-tree']))) throw new GitError('Staged content or the operation changed during inspection. Check it again.', 'REVIEW_CHANGED');
    const token = randomUUID(); this.reviews.set(repo.id, { token, fingerprint });
    return { kind, token, files };
  }
  private async requireReview(repo: Repository, snapshot: Snapshot, token?: string): Promise<void> {
    if (!snapshot.operation.kind) {
      if (token) throw new GitError('The reviewed Git operation is no longer active. Refresh before continuing.', 'OPERATION_CHANGED');
      return;
    }
    if (!snapshot.operation.canContinue) throw new GitError('Resolve conflicts before continuing', 'CONFLICTS');
    const review = this.reviews.get(repo.id);
    if (!token || token !== review?.token) throw new GitError('Inspect the staged result and confirm before completing this operation.', 'REVIEW_REQUIRED');
    if (review.fingerprint !== await this.reviewFingerprint(repo, snapshot, await this.text(repo, ['write-tree']))) throw new GitError('Staged content or the operation changed. Inspect the result again.', 'REVIEW_CHANGED');
    this.reviews.delete(repo.id);
  }
  private async checkout(repo: Repository, target: string, detached = false, stashFirst = false, includeUntracked = false, createFrom?: string): Promise<void> {
    if (detached) this.requireDetachedHead();
    const resolved = detached ? await this.oid(repo, target) : await this.refName(repo, target);
    if (!detached && !createFrom) await this.oid(repo, `refs/heads/${resolved}`);
    const snapshot = await this.snapshot(repo);
    const conflictPaths = snapshot.changes.filter(change => change.conflict).map(change => change.path);
    if (conflictPaths.length || snapshot.operation.kind) {
      throw new GitError(conflictPaths.length ? 'Resolve conflicts or Abort the active Git operation before Checkout.' : `Continue or Abort the active ${snapshot.operation.kind} before Checkout.`, 'CHECKOUT_BLOCKED', '', '', { reason: conflictPaths.length ? 'conflicts' : 'operation-active', paths: conflictPaths, target });
    }
    const occupied = !detached && snapshot.worktrees.find(tree => tree.branch === target && normalized(tree.path) !== normalized(repo.root));
    if (occupied) throw new GitError(`Branch ${target} is checked out in ${occupied.path}. Open that Worktree to use this branch.`, 'WORKTREE_OCCUPIED', '', '', { reason: 'worktree-occupied', paths: [], target, worktreePath: occupied.path });
    let stashOid: string | undefined;
    if (detached) this.requireDetachedHead();
    if (stashFirst) {
      const previous = snapshot.stashes[0]?.oid;
      await this.run(repo, ['stash', 'push', ...(includeUntracked ? ['--include-untracked'] : []), '-m', `AlwayGit: before Checkout ${target}`]);
      const top = await this.run(repo, ['rev-parse', '--verify', 'refs/stash'], true);
      const saved = top.code ? undefined : top.stdout.toString('utf8').trim();
      if (saved !== previous) stashOid = saved;
    }
    try {
      if (detached) this.requireDetachedHead();
      await this.run(repo, ['-c', 'core.quotePath=false', 'switch', ...(createFrom ? ['-c', resolved, '--track', '--', createFrom] : [...(detached ? ['--detach'] : []), '--', resolved])]);
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
  private requireDetachedHead(): void {
    if (this.options.allowDetachedHead?.() !== true) throw new GitError('Direct Detached HEAD Checkout is disabled. Create and switch to a branch, or enable it in Settings > Advanced.', 'DETACHED_HEAD_DISABLED');
  }
  private async trackBranches(repo: Repository, action: Extract<GitAction, { type: 'branch.track' }>): Promise<void> {
    if (!action.branches.length || action.branches.length > 1000 || (action.checkout && action.branches.length !== 1) || (action.stashFirst && !action.checkout)) throw new GitError('Select up to 1000 branches; Checkout and Stash require a single branch.', 'INVALID_ARGUMENT');
    // Re-read full ref names under the common-directory write queue. Short names
    // are ambiguous across remotes and upstreams may have changed since the UI opened.
    const [output, remoteOutput] = await Promise.all([
      this.text(repo, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream)%00%(symref)%00%(objecttype)', 'refs/heads', 'refs/remotes']),
      this.text(repo, ['remote']),
    ]);
    const refs = new Map(output.split('\n').filter(Boolean).map(line => { const [fullName, oid, upstream, symbolicTarget, type] = line.split('\0'); return [fullName, { oid, upstream, symbolicTarget, type }] as const; }));
    const remotes = remoteOutput.split('\n').filter(Boolean);
    const plan: { source: string; name: string; exists: boolean }[] = [];
    const names = new Map<string, string>();
    for (const branch of action.branches) {
      const name = await this.refName(repo, branch.name), source = token(branch.source, 'remote reference');
      const remoteRef = refs.get(source);
      if (!source.startsWith('refs/remotes/') || !remotes.some(remote => source.startsWith(`refs/remotes/${remote}/`)) || !remoteRef || remoteRef.symbolicTarget || remoteRef.type !== 'commit') throw new GitError(`Select an existing remote branch rather than a symbolic reference: ${source}`, 'INVALID_ARGUMENT');
      if (branch.expectedOid && remoteRef.oid !== branch.expectedOid) throw new GitError(`Remote branch changed. Refresh and select it again: ${source}`, 'OPERATION_CHANGED');
      const prior = names.get(name);
      if (prior && prior !== source) throw new GitError(`Multiple remote branches would use the same local name: ${name}. Choose distinct local names.`, 'BRANCH_EXISTS');
      if (prior) continue;
      names.set(name, source);
      const local = refs.get(`refs/heads/${name}`);
      if (local && (local.symbolicTarget || local.upstream !== source)) throw new GitError(`Local branch ${name} already exists and does not track ${source.replace('refs/remotes/', '')}. Choose another local name.`, 'BRANCH_EXISTS');
      // refs/heads/feature and refs/heads/feature/a cannot coexist. Detect this
      // before creating any branch, including collisions within the batch.
      const collision = branchNameConflict(name, [...refs.keys()].filter(ref => ref.startsWith('refs/heads/')).map(ref => ref.slice('refs/heads/'.length)).concat([...names.keys()]).filter(other => other !== name));
      if (collision) throw new GitError(branchNameConflictMessage(name, collision), 'BRANCH_EXISTS');
      plan.push({ source, name, exists: !!local });
    }
    if (action.checkout) {
      const branch = plan[0];
      try { await this.checkout(repo, branch.name, false, action.stashFirst, action.includeUntracked, branch.exists ? undefined : branch.source); }
      catch (error) {
        if (error instanceof GitError && error.details && 'target' in error.details) throw new GitError(error.message, error.code, error.stdout, error.stderr, { ...error.details, trackBranches: action.branches });
        throw error;
      }
      return;
    }
    let created = 0;
    for (const branch of plan) {
      if (branch.exists) continue;
      try { await this.run(repo, ['branch', '--track', '--', branch.name, branch.source]); created++; }
      catch (error) {
        // An external Git process can race the preflight. Report exactly how far
        // this operation got; never roll back refs which the user may now be using.
        if (!created) throw error;
        throw new GitError(`${created} local branch(es) created; creation stopped at ${branch.name}. Refresh before retrying.\n${error instanceof Error ? error.message : String(error)}`, 'PARTIAL_FAILURE');
      }
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
    if (action.type !== 'commit' && action.type !== 'operation.continue') this.reviews.delete(repo.id);
    let args: string[]; const remote = (value?: string) => value ? [token(value, 'remote')] : [];
    switch (action.type) {
      case 'stage': case 'resolve-and-stage': case 'unstage': case 'discard': {
        if (!action.paths.length) throw new GitError('Select at least one file', 'INVALID_ARGUMENT'); const paths = action.paths.map(validateFilePath);
        const status = await this.status(repo);
        const relatedPaths = (area: 'indexStatus' | 'worktreeStatus') => [...new Set(paths.flatMap(name => { const rename = status.changes.find(change => change[area] === 'R' && change.originalPath && (change.path === name || change.originalPath === name)); return rename ? [validateFilePath(rename.path), validateFilePath(rename.originalPath!)] : [name]; }))];
        if (action.type === 'resolve-and-stage' && paths.some(name => !status.changes.some(change => change.path === name && change.conflict))) throw new GitError('The selected conflict files changed. Refresh and select them again.', 'OPERATION_CHANGED');
        if (action.type === 'stage' || action.type === 'resolve-and-stage') args = ['add', '--', ...relatedPaths('worktreeStatus')];
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
      case 'commit': {
        if (!action.message.trim() || action.message.includes('\0')) throw new GitError('Enter a commit message', 'INVALID_ARGUMENT');
        const snapshot = await this.snapshot(repo);
        if (snapshot.operation.kind && action.amend) throw new GitError('Amend is unavailable during an active Git operation.', 'INVALID_ARGUMENT');
        await this.requireReview(repo, snapshot, action.reviewToken);
        args = ['commit', ...(action.amend ? ['--amend'] : []), '-m', action.message]; break;
      }
      case 'fetch': args = ['fetch', ...remote(action.remote)]; break;
      case 'pull': if (!['ff-only', 'merge', 'rebase'].includes(action.strategy)) throw new GitError('Invalid pull strategy', 'INVALID_ARGUMENT'); args = ['pull', ...(action.strategy === 'merge' ? ['--no-rebase', '--ff'] : [`--${action.strategy}`]), ...remote(action.remote)]; break;
      case 'push': {
        const branch = action.branch ? await this.refName(repo, action.branch) : undefined; let destination = action.remote;
        if (action.remoteBranch && !branch) throw new GitError('Select a local branch before choosing a remote branch', 'INVALID_ARGUMENT');
        if (branch) { await this.oid(repo, `refs/heads/${branch}`); if (!destination) { const configured = await this.run(repo, ['config', '--get', `branch.${branch}.remote`], true); if (configured.code > 1) throw new GitError(configured.stderr.toString('utf8'), 'GIT_FAILED'); destination = configured.stdout.toString('utf8').trim(); if (!destination) { const remotes = (await this.text(repo, ['remote'])).split('\n').filter(Boolean); if (remotes.length !== 1) throw new GitError('Select a remote before pushing this branch', 'INVALID_ARGUMENT'); destination = remotes[0]; } } }
        const remoteBranch = branch ? await this.refName(repo, action.remoteBranch ?? branch) : undefined;
        const setUpstream = branch && (action.setUpstream ?? true);
        args = ['push', ...(setUpstream ? ['--set-upstream'] : []), ...(action.forceWithLease ? ['--force-with-lease'] : []), ...remote(destination), ...(branch ? [`refs/heads/${branch}:refs/heads/${remoteBranch}`] : [])]; break;
      }
      case 'remote.add': {
        const name=action.name.trim(),url=action.url.trim();
        if(remoteNameProblem(name))throw new GitError('Enter a remote name without spaces, such as origin.','INVALID_REMOTE_NAME');
        if(remoteUrlProblem(url))throw new GitError('Enter a repository URL.','INVALID_REMOTE_URL');
        const configured=(await this.text(repo,['remote'])).split('\n').filter(Boolean);
        if(configured.includes(name))throw new GitError(`Remote already exists: ${name}`,'REMOTE_EXISTS');
        args=['remote','add',name,url];break;
      }
      case 'branch.create': {
        const name = await this.refName(repo, action.name);
        // Re-read inside the common-directory write queue; the dialog snapshot may be stale.
        const localNames = (await this.text(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).split('\n').filter(Boolean).map(ref => ref.slice('refs/heads/'.length));
        const collision = branchNameConflict(name, localNames);
        if (collision) throw new GitError(branchNameConflictMessage(name, collision), 'BRANCH_EXISTS');
        const start = await this.oid(repo, action.start ?? 'HEAD'), upstream = action.start?.startsWith('refs/remotes/') ? action.start : undefined;
        if (upstream) await this.run(repo, ['show-ref', '--verify', '--', upstream]);
        // switch -c can change Index/Working Tree before a ref creation failure.
        // Create the ref first so even an external race cannot start Checkout on failure.
        await this.run(repo, ['branch', '--no-track', '--', name, start]);
        if (upstream) {
          try { await this.run(repo, ['branch', `--set-upstream-to=${upstream}`, '--', name]); }
          catch (error) { throw new GitError(`Branch ${name} was created and retained, but upstream configuration failed. Checkout did not run.\n${error instanceof Error ? error.message : String(error)}`, 'PARTIAL_FAILURE'); }
        }
        if (action.checkout) {
          try { await this.checkout(repo, name); }
          catch (error) {
            const details: CheckoutBlocker = { ...(error instanceof GitError && error.details && 'target' in error.details ? error.details : { reason: 'checkout-failed' as const, paths: [], target: name }), branchCreated: true };
            throw new GitError(`Branch ${name} was created and retained, but Checkout did not complete.\n${error instanceof Error ? error.message : String(error)}`, error instanceof GitError ? error.code : 'CHECKOUT_FAILED', error instanceof GitError ? error.stdout : '', error instanceof GitError ? error.stderr : '', details);
          }
        }
        return;
      }
      case 'branch.checkout': return this.checkout(repo, action.name);
      case 'branch.track': return this.trackBranches(repo, action);
      case 'commit.checkout': return this.checkout(repo, action.target, true);
      case 'checkout.stash': return this.checkout(repo, action.target, action.detached, true, action.includeUntracked);
      case 'branch.delete': {
        const names=[...new Set(await Promise.all(action.names.map(name=>this.refName(repo,name))))];
        if(!names.length)throw new GitError('Select at least one branch','INVALID_ARGUMENT');
        const state=await this.snapshot(repo),current=state.branch,occupied=new Set(state.worktrees.map(tree=>tree.branch?.replace(/^refs\/heads\//,'')).filter(Boolean));
        if(current&&names.includes(current))throw new GitError(`The current branch cannot be deleted: ${current}`,'INVALID_ARGUMENT');
        const inUse=names.find(name=>occupied.has(name));if(inUse)throw new GitError(`Branch is used by a Worktree: ${inUse}`,'WORKTREE_OCCUPIED');
        for(const name of names){const expected=action.expectedOids?.[name];if(expected&&await this.oid(repo,`refs/heads/${name}`)!==expected)throw new GitError(`Branch changed before deletion: ${name}`,'OPERATION_CHANGED');}
        const failures:string[]=[];let deleted=0;
        for(const name of names){try{await this.run(repo,['branch',action.force?'-D':'-d','--',name]);deleted++;}catch(error){failures.push(`${name}: ${error instanceof Error?error.message:String(error)}`);}}
        if(failures.length)throw new GitError(`${deleted} branch(es) deleted; ${failures.length} failed.\n${failures.join('\n')}`,'PARTIAL_FAILURE');
        return;
      }
      case 'remote.delete': {
        const destination=token(action.remote,'remote'),configured=(await this.text(repo,['remote'])).split('\n').filter(Boolean);
        if(!configured.includes(destination))throw new GitError(`Unknown remote: ${destination}`,'INVALID_ARGUMENT');
        const branches=[...new Set(await Promise.all(action.branches.map(name=>this.refName(repo,name))))];
        if(!branches.length)throw new GitError('Select at least one remote branch','INVALID_ARGUMENT');
        for(const branch of branches){const expected=action.expectedOids?.[branch];if(expected&&await this.oid(repo,`refs/remotes/${destination}/${branch}`)!==expected)throw new GitError(`Remote-tracking branch changed before deletion: ${destination}/${branch}`,'OPERATION_CHANGED');}
        const failures:string[]=[];let deleted=0;
        for(const branch of branches){try{await this.run(repo,['push',destination,'--delete',branch]);deleted++;}catch(error){failures.push(`${destination}/${branch}: ${error instanceof Error?error.message:String(error)}`);}}
        if(failures.length)throw new GitError(`${deleted} remote branch(es) deleted; ${failures.length} failed.\n${failures.join('\n')}`,'PARTIAL_FAILURE');
        return;
      }
      case 'tag.create': await this.run(repo, ['check-ref-format', `refs/tags/${token(action.name, 'tag name')}`]); args = ['tag', ...(action.message ? ['-a', '-m', action.message] : []), action.name, await this.oid(repo, action.target ?? 'HEAD')]; break;
      case 'tag.delete': await this.run(repo, ['check-ref-format', `refs/tags/${token(action.name, 'tag name')}`]); args = ['tag', '-d', '--', action.name]; break;
      case 'stash.create': {
        if (action.paths) {
          if (!action.paths.length) throw new GitError('Select at least one file', 'INVALID_ARGUMENT');
          const snapshot = await this.snapshot(repo);
          if (snapshot.operation.kind || snapshot.operation.conflicts) throw new GitError('Finish the active operation or resolve conflicts before saving selected files.', 'CONFLICTS');
          try { await createSelectedStash(repo, action.paths.map(validateFilePath), action.message, snapshot.changes, (args, execution) => this.run(repo, args, false, undefined, execution)); }
          catch (error) { if (error instanceof StashStateError) throw new GitError(error.message, error.code, error.stdout, error.stderr, error.details); throw error; }
          return;
        }
        args = ['stash', 'push', ...(action.includeUntracked ? ['--include-untracked'] : []), ...(action.message ? ['-m', action.message] : [])]; break;
      }
      case 'stash.apply': {
        const selector = await this.validateStash(repo, action.selector, action.expectedOid);
        const stashOid = action.expectedOid ?? await this.oid(repo, selector);
        const details = await this.stashDetails(repo, stashOid);
        const paths = await this.existingStashPaths(repo, details.sections.untracked?.files ?? []);
        if (paths.length) {
          const blocker: StashApplyBlocker = { kind: 'stash-apply', reason: 'untracked-path-exists', paths, selector, stashOid, stashRetained: true, workingTreeUnchanged: true };
          const summary = paths.length === 1 ? paths[0] : `${paths.length} saved untracked files`;
          throw new GitError(`Cannot restore the Stash because the project already contains ${summary}. Existing files were not overwritten, and the Stash is still saved.`, 'STASH_UNTRACKED_CONFLICT', '', '', blocker);
        }
        const snapshot = await this.snapshot(repo);
        const affected = [...new Set(Object.values(details.sections).flatMap(section => section?.files.flatMap(file => [file.path, ...(file.previousPath ? [file.previousPath] : [])]) ?? []))];
        try {
          await preflightStash(repo, selector, stashOid, affected.map(validateFilePath), snapshot.operation, (args, execution) => this.run(repo, args, false, undefined, execution));
        } catch (error) { if (error instanceof StashStateError) throw new GitError(error.message, error.code, error.stdout, error.stderr, error.details); throw error; }
        await this.validateStash(repo, selector, stashOid);
        // Apply the captured object, restore the Index, and keep the original archive.
        await this.run(repo, ['stash', 'apply', '--index', stashOid]);
        if (action.pop) {
          try { await this.validateStash(repo, selector, stashOid); }
          catch { throw new GitError('Stash changes were applied, but the Stash list changed before Drop. The saved entry was retained; refresh the list.', 'STASH_CHANGED'); }
          await this.run(repo, ['stash', 'drop', selector]);
        }
        return;
      }
      case 'stash.drop': args = ['stash', 'drop', await this.validateStash(repo, action.selector, action.expectedOid)]; break;
      case 'worktree.add': {
        // A revision without -b or an existing branch implicitly creates a detached Worktree.
        if (action.detach || !action.branch && !action.newBranch && !!action.start) this.requireDetachedHead();
        token(action.path, 'worktree path'); if (action.detach && (action.branch || action.newBranch)) throw new GitError('Detached worktrees cannot also select a branch', 'INVALID_ARGUMENT'); if (action.branch && action.newBranch) throw new GitError('Choose an existing or a new branch', 'INVALID_ARGUMENT');
        const target = path.resolve(repo.root, action.path); const current = await this.worktrees(repo); if (current.some(x => normalized(x.path) === normalized(target))) throw new GitError('Worktree already registered', 'INVALID_WORKTREE');
        args = ['worktree', 'add', ...(action.detach ? ['--detach'] : []), ...(action.newBranch ? ['-b', await this.refName(repo, action.newBranch)] : []), '--', target];
        if (action.branch) { await this.refName(repo, action.branch); args.push(await this.oid(repo, `refs/heads/${action.branch}`)); if (!action.detach) args[args.length - 1] = action.branch; } else if (action.start) args.push(await this.oid(repo, action.start)); break;
      }
      case 'worktree.remove': { token(action.path, 'worktree path'); const target = await canonicalPath(path.resolve(repo.root, action.path)); const trees = await this.worktrees(repo); const canonical = await Promise.all(trees.map(tree => canonicalPath(tree.path))); const selected = trees.find((_, index) => normalized(canonical[index]) === normalized(target)); if (!selected || normalized(target) === normalized(canonical[0]) || normalized(target) === normalized(repo.root)) throw new GitError('Only registered linked worktrees other than the current Worktree can be removed', 'INVALID_WORKTREE'); if (selected.locked) throw new GitError(`This Worktree is Locked: ${selected.locked}. Unlock it before removal.`, 'WORKTREE_LOCKED'); args = ['worktree', 'remove', ...(action.force ? ['--force'] : []), '--', selected.path]; break; }
      case 'merge': case 'rebase': args = [action.type, await this.oid(repo, action.target)]; break;
      case 'cherry-pick': case 'revert': {
        if (!action.commits.length) throw new GitError('Select commits', 'INVALID_ARGUMENT');
        if (action.mainline !== undefined && (!Number.isSafeInteger(action.mainline) || action.mainline < 1)) throw new GitError('Invalid merge parent number', 'INVALID_ARGUMENT');
        if(action.expectedHead||action.expectedBranch){const current=await this.status(repo);if(action.expectedHead&&current.head!==action.expectedHead||action.expectedBranch&&current.branch!==action.expectedBranch)throw new GitError('The target branch changed before the operation started. Select the commits again.', 'OPERATION_CHANGED');}
        args = [action.type, ...(action.mainline ? ['-m', String(action.mainline)] : []), ...(await Promise.all(action.commits.map(x => this.oid(repo, x))))]; break;
      }
      case 'reset': if (!['soft', 'mixed', 'hard'].includes(action.mode)) throw new GitError('Invalid reset mode', 'INVALID_ARGUMENT'); args = ['reset', `--${action.mode}`, await this.oid(repo, action.target), '--']; break;
      case 'operation.continue': case 'operation.abort': case 'operation.skip': {
        const snapshot = await this.snapshot(repo), state = snapshot.operation;
        if (!state.kind || state.kind !== action.kind) throw new GitError('The selected Git operation is no longer active', 'OPERATION_CHANGED');
        const command = action.type.split('.')[1];
        if (command === 'skip' && !state.canSkip) throw new GitError('This operation cannot be skipped', 'INVALID_ARGUMENT');
        if (action.type === 'operation.continue') await this.requireReview(repo, snapshot, action.reviewToken);
        args = [action.kind, `--${command}`]; break;
      }
      default: throw new GitError('Unsupported Git action', 'INVALID_ARGUMENT');
    }
    if (action.type === 'worktree.add' && (action.detach || !action.branch && !action.newBranch && !!action.start)) this.requireDetachedHead();
    await this.run(repo, args);
  }
}
