import { message as localizeMessage, translate } from '../i18n/index';
import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { access, lstat, open, realpath, readFile, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { constants } from 'node:fs';
import path from 'node:path';
import type { Change, CheckoutBlocker, Commit, CommitComparison, CommitDetails, CommitFile, ContentSource, GitAction, GitRef, GitServiceContract, HistoryPage, HistoryQuery, OperationReview, OperationState, Repository, RepositoryStatus, Snapshot, Stash, StashApplyBlocker, StashDetails, Worktree } from '../protocol/types';
import { branchNameConflict, branchNameConflictMessage, branchNameProblem, branchNameProblemMessage } from '../protocol/ref-name';
import { remoteNameProblem, remoteUrlProblem } from '../protocol/remote';
import { parsePushResult } from './push-result';
import { hostingRepository } from '../protocol/hosting';
import type { PushResult, RemoteLinks } from '../protocol/types';
import type { RemoteTags } from '../protocol/types';
import type { DiscardRequest, DiscardPlan, FileOperationProgress } from '../protocol/types';
import { inferDefaultBranch } from './default-branch';
import { GitError, GitReadTerminationError, GitTerminationError } from './error';
import { isReadOnlyGitCommand } from './command-kind';
import { assertGitArgumentBudget, prepareGitArguments, splitCleanArguments } from './arguments';
import { mapGitQueries } from './query-map';
import { runGitProcess, type GitResult } from './runner';
export { GitError } from './error';
import { createSelectedStash, preflightStash, StashStateError, type StashExecution } from './stash';
import { commitSelected } from './selected-commit';
import { safeWorkingPath } from '../editor/paths';
import { requireExactFileScope } from './file-scope';
import { redactSecrets, SecretRedactor } from '../application/logging';

export interface GitServiceOptions {
  allowDetachedHead?: () => boolean;
  gitPath?: string;
  resolveGitPath?: () => Promise<string | undefined>;
  onOutput?: (repo: Repository, text: string) => void;
  timeoutMs?: number;
  networkTimeoutMs?: number;
  maxOutputBytes?: number;
  environment?: NodeJS.ProcessEnv | ((repo: Repository, args: readonly string[]) => Promise<NodeJS.ProcessEnv | { env: NodeJS.ProcessEnv; cancelPrompts?: () => void; dispose?: () => void | Promise<void> }>);
}
type Result = GitResult;
interface BoundRemote { remote: string; url: string; configOverrides: [string, string][] }
const queues = new Map<string, Promise<unknown>>();
const unsafeTerminations = new Map<string, GitTerminationError>();
const normalized = (p: string) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
const canonicalPath = async (p: string) => { try { return await realpath(p); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return path.resolve(p); throw e; } };
function decodePaths(buffer: Buffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw new GitError(localizeMessage("service.thisRepositoryContainsAPathEncodedWithInvalidUTF"), 'UNSUPPORTED_PATH_ENCODING'); }
}
const exists = async (p: string) => { try { await access(p); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } };
const token = (value: string, label: string) => { if (!value || value.startsWith('-') || /[\0\r\n]/.test(value)) throw new GitError(localizeMessage("service.invalid", { label: (label) }), 'INVALID_ARGUMENT'); return value; };
export function validateFilePath(value: string): string {
  if (!value || value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.startsWith('\\') || value.split(/[\\/]/).some(x => x === '..' || x === '.' || x.toLowerCase() === '.git' || (process.platform === 'win32' && (/^[. ]+$/.test(x) || /^\.git[. ]*$/i.test(x))))) throw new GitError(localizeMessage("service.filePathsMustStayInsideTheRepository"), 'INVALID_PATH');
  return process.platform === 'win32' ? value.replace(/\\/g, '/') : value;
}
function fields(record: string, count: number): [string[], string] {
  const result: string[] = []; let start = 0;
  for (let i = 0; i < count; i++) { const end = record.indexOf(' ', start); if (end < 0) throw new GitError(localizeMessage("service.malformedGitStatusOutput"), 'PARSE_ERROR'); result.push(record.slice(start, end)); start = end + 1; }
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
  private executable?: Promise<string>;
  private readonly reviews = new Map<string, { token: string; fingerprint: string }>();
  private readonly discards = new Map<string, { root: string; expires: number; plan: DiscardPlan; fingerprint: string; request: DiscardRequest }>();
  private readonly readSignal = new AsyncLocalStorage<{ controller: AbortController; pending: Set<Promise<void>> }>();
  constructor(private readonly options: GitServiceOptions = {}) {}
  private gitPath(): Promise<string> {
    return this.executable ??= Promise.resolve().then(() => this.options.gitPath || this.options.resolveGitPath?.()).then(value => value || 'git');
  }
  async withReadSignal<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    const controller=new AbortController(),abort=()=>controller.abort();
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
    const scope={controller,pending:new Set<Promise<void>>()};
    try{return await this.readSignal.run(scope,task);}
    catch(error){
      controller.abort();
      const failure=error instanceof Error?error:new Error(String(error));
      const original=(failure as {completion?:Promise<void>}).completion;
      const completion=Promise.all([...scope.pending,...(original?[original]:[])]).then(()=>{});
      Object.defineProperty(failure,'completion',{value:completion,configurable:true});
      throw failure;
    }
    finally{signal.removeEventListener('abort',abort);}
  }
  private async run(repo: Repository, args: string[], allowFailure = false, captureBytes?: number, execution: StashExecution & { signal?: AbortSignal; configOverrides?: [string, string][]; beforeSpawn?: () => Promise<void>; boundRemote?: BoundRemote } = {}): Promise<Result> {
    const readOnly = isReadOnlyGitCommand(args), scope = this.readSignal.getStore(), scopeSignal = scope?.controller.signal;
    if (!readOnly && scopeSignal) throw new GitError(localizeMessage("service.aReadOnlyRequestCannotRunGitMutations"), 'WRITE_IN_READ_SCOPE');
    const unsafe = unsafeTerminations.get(normalized(repo.commonDir));
    if (!readOnly && unsafe) throw unsafe;
    const prefix = ['-C', execution.root ?? repo.root, ...(args[0] === 'stash' ? [] : ['--literal-pathspecs']), ...[...Object.entries(execution.config ?? {}), ...(execution.configOverrides ?? [])].flatMap(([key, value]) => ['-c', `${key}=${value}`])];
    const executable = await this.gitPath();
    const batches = splitCleanArguments(executable, prefix, args);
    if (batches.length > 1) {
      const results: Result[] = [];
      try {
        for (const batch of batches) {
          const result = await this.run(repo, batch, allowFailure, captureBytes, execution);
          results.push(result);
          if (result.code) break;
        }
      } catch (error) {
        if (error instanceof GitTerminationError || !results.length) throw error;
        throw new GitError(localizeMessage("service.cleanBatchEsCompletedALaterBatchFailedAnd", { count: (results.length), value: (error instanceof Error ? error.message : String(error)) }), 'PARTIAL_FAILURE');
      }
      return { stdout: Buffer.concat(results.map(result => result.stdout)), stderr: Buffer.concat(results.map(result => result.stderr)), code: results.at(-1)?.code ?? 0 };
    }
    const prepared = prepareGitArguments(args, execution.input);
    assertGitArgumentBudget(executable, [...prefix, ...prepared.args]);
    const adapter = this.options.environment;
    const supplied = execution.isolated ? undefined : typeof adapter === 'function' ? await adapter(repo, args) : adapter;
    const wrapped = supplied && 'env' in supplied && typeof supplied.env === 'object' ? supplied as { env: NodeJS.ProcessEnv; cancelPrompts?: () => void; dispose?: () => void | Promise<void> } : undefined;
    const env = wrapped?.env ?? supplied as NodeJS.ProcessEnv | undefined;
    const commandEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
    if (execution.isolated) for (const key of Object.keys(commandEnv)) if (/^GIT_/i.test(key)) delete commandEnv[key];
    let preserveEnvironment = false;
    let bindingConfig: string | undefined;
    const log = new SecretRedactor(text => this.options.onOutput?.(repo, text));
    try {
      if (execution.boundRemote) {
        // An exact, first rewrite rule wins even if another client later adds
        // url.*.insteadOf for this address. Include the real system settings
        // after it; global/local settings and credential helpers remain intact.
        const system = await this.run(repo, ['var', 'GIT_CONFIG_SYSTEM'], true, undefined, { env: commandEnv });
        if (system.code) throw new GitError(localizeMessage('service.cannotBindRemoteDestination'), 'REMOTE_BINDING_UNSUPPORTED');
        const systemPath = system.stdout.toString('utf8').trim();
        const includeSystem = !/^(?:1|true|yes|on)$/i.test(commandEnv.GIT_CONFIG_NOSYSTEM ?? '') && systemPath && await exists(systemPath);
        const url = JSON.stringify(execution.boundRemote.url);
        const filename = path.join(tmpdir(), `alwaygit-push-${randomUUID()}.config`);
        const configFile = await open(filename, 'wx', 0o600);
        bindingConfig = filename;
        const rewriteKey = 'insteadOf';
        try { await configFile.writeFile([`[url ${url}]`, `\t${rewriteKey} = ${url}`, ...(includeSystem ? ['[include]', `\tpath = ${JSON.stringify(systemPath)}`] : []), ''].join('\n')); }
        finally { await configFile.close(); }
      }
      await execution.beforeSpawn?.();
      // Stash cleanup uses Git pathspec matching; all other commands use literal paths.
      const gitProcess = runGitProcess({
        executable,
        args: [...prefix, ...prepared.args],
        env: { ...commandEnv, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', ...(['status', 'log', 'show', 'ls-tree', 'ls-files', 'for-each-ref'].includes(args[0]) ? { GIT_OPTIONAL_LOCKS: '0' } : {}), ...execution.env, ...(bindingConfig ? { GIT_CONFIG_SYSTEM: bindingConfig, GIT_CONFIG_NOSYSTEM: '0' } : {}) },
        input: prepared.input, signal: execution.signal && scopeSignal ? AbortSignal.any([execution.signal,scopeSignal]) : execution.signal ?? scopeSignal, readOnly, captureBytes,
        timeoutMs: this.options.timeoutMs ?? (args[0] === 'ls-remote' ? 30_000 : ['fetch', 'pull', 'push'].includes(args[0]) ? this.options.networkTimeoutMs ?? 600_000 : undefined), onStop: wrapped?.cancelPrompts, maxOutputBytes: this.options.maxOutputBytes,
        onStderr: execution.silent ? undefined : chunk => log.write(chunk),
      });
      if(scope){
        const completion=gitProcess.then(()=>{},error=>(error as {completion?:Promise<void>}|undefined)?.completion?.catch(()=>{}));
        scope.pending.add(completion);void completion.then(()=>scope.pending.delete(completion));
      }
      const result = await gitProcess;
      log.end();
      if (!execution.silent && result.stdout.length && ['add', 'restore', 'rm', 'clean', 'commit', 'fetch', 'pull', 'push', 'branch', 'switch', 'tag', 'stash', 'worktree', 'merge', 'rebase', 'cherry-pick', 'revert', 'reset'].includes(args[0]) && !(args[0] === 'stash' && args[1] === 'list') && !(args[0] === 'worktree' && args[1] === 'list')) this.options.onOutput?.(repo, redactSecrets(result.stdout.toString('utf8')));
      if (result.code && !allowFailure && !execution.allowFailure) {
        const stdout = result.stdout.toString('utf8'); const stderr = result.stderr.toString('utf8');
        const hint = /authentication|could not read Username|terminal prompts disabled|permission denied|credential/i.test(stderr) ? translate('en', "service.configureGitCredentialsOrSignInThenRetry") : /index.lock|another git process/i.test(stderr) ? translate('en', "service.anotherGitProcessIsUsingThisRepositoryFinishIt") : '';
        throw new GitError((stderr.trim() || stdout.trim() || translate('en', "service.gitExitedWithStatus", { code: (result.code) })) + hint, 'GIT_FAILED', stdout, stderr);
      }
      return result;
    } catch (error) {
      if (error instanceof GitTerminationError || error instanceof GitReadTerminationError) {
        if (error instanceof GitTerminationError) unsafeTerminations.set(normalized(repo.commonDir), error);
        // Keep authentication until the known process and terminator handles close.
        // This does not lift isolation: closed handles don't prove every descendant exited.
        void error.completion.then(() => { log.end(); return wrapped?.dispose?.(); }).catch(() => {});
        if (bindingConfig) { const filename = bindingConfig; void error.completion.then(() => rm(filename, { force: true })).catch(() => {}); }
        preserveEnvironment = true;
      }
      throw error;
    } finally {
      if (!preserveEnvironment) {
        log.end();
        try { await wrapped?.dispose?.(); }
        finally { if (bindingConfig) await rm(bindingConfig, { force: true }); }
      }
    }
  }
  private async text(repo: Repository, args: string[]): Promise<string> { return (await this.run(repo, args)).stdout.toString('utf8').trim(); }
  private async optionalConfig(repo: Repository, key: string): Promise<string | undefined> {
    const result = await this.run(repo, ['config', '--get', key], true);
    if (result.code > 1) throw new GitError(result.stderr.toString('utf8').trim() || translate('en', "service.cannotReadGitConfiguration", { key: (key) }), 'GIT_FAILED');
    return result.stdout.toString('utf8').trim() || undefined;
  }
  private async remoteDestination(repo: Repository, remote: string, requireSingle = false): Promise<string> {
    const urls = (await this.text(repo, ['remote', 'get-url', '--push', '--all', token(remote, 'remote')])).split('\n').filter(Boolean);
    if (requireSingle && urls.length !== 1) throw new GitError(localizeMessage("service.thisRemoteHasMultiplePushDestinationsSelectARemote"), 'MULTIPLE_PUSH_DESTINATIONS');
    // The UI only receives a fingerprint; URLs may contain authentication secrets.
    return createHash('sha256').update(JSON.stringify(urls)).digest('hex');
  }
  private async remoteReadDestination(repo: Repository, remote: string): Promise<string> {
    const url = await this.text(repo, ['remote', 'get-url', token(remote, 'remote')]);
    return createHash('sha256').update(url).digest('hex');
  }
  async remoteTags(repo: Repository, remote: string, expectedDestination: string): Promise<RemoteTags> {
    const configured = (await this.text(repo, ['remote'])).split('\n');
    if (!configured.includes(token(remote, 'remote'))) throw new GitError(localizeMessage('service.unknownRemote', { destination: remote }), 'INVALID_ARGUMENT');
    const url = await this.text(repo, ['remote', 'get-url', remote]);
    const destination = createHash('sha256').update(url).digest('hex');
    if (destination !== expectedDestination) throw new GitError(localizeMessage('tags.remoteChanged'), 'OPERATION_CHANGED');
    const pushUrls = (await this.text(repo, ['remote', 'get-url', '--push', '--all', remote])).split('\n').filter(Boolean);
    // Query the captured read address, never a moving remote configuration.
    const output = (await this.run(repo, ['ls-remote', '--tags', '--refs', '--', url], false, undefined, { silent: true, env: { GIT_ASKPASS: '', SSH_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never' } })).stdout.toString('utf8');
    if (await this.remoteReadDestination(repo, remote) !== destination) throw new GitError(localizeMessage('tags.remoteChanged'), 'OPERATION_CHANGED');
    const refs: Record<string, string> = {};
    for (const line of output.split('\n').filter(Boolean)) {
      const match = /^([a-f0-9]{40}|[a-f0-9]{64})\t(refs\/tags\/[^\s]+)$/.exec(line);
      if (!match) throw new GitError(localizeMessage('service.malformedGitStatusOutput'), 'PARSE_ERROR');
      refs[match[2]] = match[1];
    }
    return { remote, destination, separatePush: pushUrls.length !== 1 || pushUrls[0] !== url, refs, checkedAt: Date.now() };
  }
  private async confirmRemoteDestination(repo: Repository, remote: string, expected?: string): Promise<BoundRemote> {
    token(remote, 'remote');
    const urls = (await this.text(repo, ['remote', 'get-url', '--push', '--all', remote])).split('\n').filter(Boolean);
    if (urls.length !== 1) throw new GitError(localizeMessage("service.thisRemoteHasMultiplePushDestinationsSelectARemote"), 'MULTIPLE_PUSH_DESTINATIONS');
    const actual = createHash('sha256').update(JSON.stringify(urls)).digest('hex');
    if (!expected || actual !== expected) throw new GitError(localizeMessage("service.theRemotePushDestinationIsMissingOrChangedRefresh"), 'OPERATION_CHANGED');
    // Reset before replacing this multi-valued key. Appending alone would push
    // to both the newly configured server and the confirmed one.
    const configOverrides: [string, string][] = [[`remote.${remote}.pushurl`, ''], [`remote.${remote}.pushurl`, urls[0]]];
    const bound = { remote, url: urls[0], configOverrides };
    const resolved = await this.run(repo, ['remote', 'get-url', '--push', '--all', remote], false, undefined, { configOverrides, boundRemote: bound });
    if (resolved.stdout.toString('utf8').trim() !== urls[0]) throw new GitError(localizeMessage('service.cannotBindRemoteDestination'), 'REMOTE_BINDING_UNSUPPORTED');
    return bound;
  }
  private confirmedRemoteOid(value: string | undefined): string {
    if (value === undefined) throw new GitError(localizeMessage("service.theConfirmedRemoteBranchVersionIsMissingRefreshAnd"), 'OPERATION_CHANGED');
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})?$/.test(value)) throw new GitError(localizeMessage("service.invalidConfirmedRemoteBranchVersion"), 'INVALID_ARGUMENT');
    return value;
  }
  async discover(root: string): Promise<Repository> {
    const resolved = await realpath(path.resolve(root));
    const provisional: Repository = { id: '', root: resolved, commonDir: '', name: path.basename(resolved) };
    const bare = await this.text(provisional, ['rev-parse', '--is-bare-repository']);
    if (bare === 'true') throw new GitError(localizeMessage("service.openAWorkingRepositoryRatherThanABareRepository"), 'BARE_REPOSITORY');
    const top = await this.text(provisional, ['rev-parse', '--show-toplevel']);
    provisional.root = await realpath(top);
    provisional.commonDir = await realpath(await this.text(provisional, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
    provisional.id = createHash('sha256').update(normalized(provisional.root)).digest('hex').slice(0, 24);
    provisional.name = path.basename(provisional.root);
    const gitDir = await realpath(await this.text(provisional, ['rev-parse', '--path-format=absolute', '--git-dir']));
    provisional.gitDir = gitDir;
    if (normalized(gitDir) === normalized(provisional.commonDir)) provisional.mainRoot = provisional.root;
    else {
      const [main] = await this.worktrees(provisional);
      if (main && !main.bare) provisional.mainRoot = await canonicalPath(main.path);
    }
    return provisional;
  }
  private async verify(repo: Repository) { const current = await this.discover(repo.root); if (normalized(current.commonDir) !== normalized(repo.commonDir) || current.id !== repo.id) throw new GitError(localizeMessage("service.repositoryChangedReopenItBeforeContinuing"), 'REPOSITORY_CHANGED'); return current; }
  /** A bounded watcher batch checks literal Index membership, including deleted tracked files. */
  async trackedPaths(repo: Repository, paths: string[]): Promise<string[]> {
    if (!paths.length) return [];
    await this.verify(repo);
    const names = new Set(paths.map(validateFilePath));
    const output = await this.run(repo, ['ls-files', '-z', '--', ...names], false, undefined, { env: { GIT_LITERAL_PATHSPECS: '1' } });
    return [...new Set(decodePaths(output.stdout).split('\0').filter(name => names.has(name)))];
  }
  private async oid(repo: Repository, revision: string): Promise<string> { token(revision, 'revision'); return this.text(repo, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]); }
  private async refName(repo: Repository, name: string): Promise<string> { const problem=branchNameProblem(name);if(problem)throw new GitError(branchNameProblemMessage(problem),'INVALID_BRANCH_NAME');await this.run(repo, ['check-ref-format', `refs/heads/${name}`]); return name; }
  private async status(repo: Repository) { return parseStatus((await this.run(repo, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])).stdout); }
  async cherryPickCheck(repo: Repository, commits: string[], context?: { expectedHead: string; expectedBranch: string }) {
    const current = await this.status(repo);
    if (context) this.requireActionContext(context, current);
    if (!current.branch || !current.head) throw new GitError(localizeMessage('service.cherryPickNeedsBranch'), 'INVALID_ARGUMENT');
    const included = await mapGitQueries([...new Set(commits)], async revision => {
      const oid = await this.oid(repo, revision);
      if (oid === current.head) return oid;
      const result = await this.run(repo, ['merge-base', '--is-ancestor', oid, current.head!], true);
      if (result.code !== 0 && result.code !== 1) throw new GitError(localizeMessage('service.cherryPickCheckFailed'), 'GIT_ERROR', result.stdout.toString('utf8'), result.stderr.toString('utf8'));
      return result.code === 0 ? oid : undefined;
    });
    return { head: current.head, branch: current.branch, included: included.filter((oid): oid is string => !!oid) };
  }
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
    const refs: GitRef[] = refsOutput ? await mapGitQueries(refsOutput.split('\n'), async line => {
      const [fullName, objectOid, upstream, peeledOid, peeledType, objectType, symbolicTarget] = line.split('\0');
      const kind: GitRef['kind'] = fullName.startsWith('refs/heads/') ? 'local' : fullName.startsWith('refs/remotes/') ? 'remote' : 'tag';
      // for-each-ref's starred fields peel one annotated-tag layer. Dereference
      // nested tags fully before deciding whether Commit actions are meaningful.
      const targetType = (peeledType === 'tag' ? await this.text(repo, ['cat-file', '-t', `${fullName}^{}`]) : peeledType || objectType) as GitRef['targetType'];
      const oid = targetType === 'commit' ? peeledType === 'commit' ? peeledOid : peeledType === 'tag' ? await this.oid(repo, fullName) : objectOid : objectOid;
      return { fullName, name: fullName.replace(/^refs\/(heads|remotes|tags)\//, ''), kind, oid, ...(kind === 'tag' ? { refOid: objectOid } : {}), targetType, ...(upstream ? { upstream } : {}), ...(symbolicTarget ? { symbolicTarget } : {}) };
    }) : [];
    const stashes: Stash[] = stashOutput ? stashOutput.split('\n').map(line => { const [selector, oid, subject] = line.split('\0'); return { selector, oid, subject }; }) : [];
    const remotes = remoteOutput ? remoteOutput.split('\n') : [];
    const remoteDestinations = Object.fromEntries(await mapGitQueries(remotes, async remote => [remote, await this.remoteDestination(repo, remote)] as const));
    const remoteReadDestinations = Object.fromEntries(await mapGitQueries(remotes, async remote => [remote, await this.remoteReadDestination(repo, remote)] as const));
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
    return { repository: repo, ...status, unpushed: status.branch ? unpushed : 0, refs, remotes, remoteDestinations, remoteReadDestinations, ...(defaultBranch ? { defaultBranch } : {}), ...(pushTarget ? { pushTarget } : {}), stashes, worktrees, operation, version: ++this.version };
  }
  private async worktrees(repo: Repository): Promise<Worktree[]> {
    const records = decodePaths((await this.run(repo, ['worktree', 'list', '--porcelain', '-z'])).stdout).split('\0'); const result: Worktree[] = []; let current: Worktree | undefined;
    for (const record of records) { if (record.startsWith('worktree ')) { current = { path: record.slice(9), head: '', bare: false, detached: false }; result.push(current); } else if (current) { if (record.startsWith('HEAD ')) current.head = record.slice(5); else if (record.startsWith('branch ')) current.branch = record.slice(7).replace(/^refs\/heads\//, ''); else if (record === 'bare') current.bare = true; else if (record === 'detached') current.detached = true; else if (record.startsWith('locked')) current.locked = record.slice(7) || translate('en', "service.locked"); else if (record.startsWith('prunable')) current.prunable = record.slice(9) || translate('en', "service.prunable"); } }
    return result;
  }
  async history(repo: Repository, query: HistoryQuery = {}): Promise<HistoryPage> {
    await this.verify(repo); const offset = query.offset ?? 0; const limit = query.limit ?? 100;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new GitError(localizeMessage("service.invalidHistoryPage"), 'INVALID_ARGUMENT');
    let tips: string[];
    if (query.tips) tips = await mapGitQueries([...new Set(query.tips)], ref => this.oid(repo, ref));
    else if (query.ref) tips = [await this.oid(repo, query.ref)];
    else {
      const all = await this.text(repo, ['for-each-ref', '--format=%(refname)%00%(objecttype)%00%(*objecttype)%00%(objectname)%00%(*objectname)', 'refs/heads', 'refs/remotes', 'refs/tags']);
      const candidates = await mapGitQueries(all ? all.split('\n') : [], async line => {
        const [ref, type, peeledType, oid, peeledOid] = line.split('\0');
        // Git already provides immutable commit IDs for ordinary refs and tags.
        // Only nested annotated tags require another query to peel completely.
        if (type === 'commit') return oid;
        if (peeledType === 'commit') return peeledOid;
        if (peeledType === 'tag' && await this.text(repo, ['cat-file', '-t', `${ref}^{}`]) === 'commit') return this.oid(repo, ref);
        return undefined;
      });
      tips = candidates.filter((oid): oid is string => !!oid);
      const head = (await this.status(repo)).head; if (head) tips.push(head);
    }
    tips = [...new Set(tips)];
    const searchArgs = query.search ? ['--fixed-strings', '--regexp-ignore-case', `--grep=${query.search}`] : [];
    if (query.search?.includes('\0')) throw new GitError(localizeMessage("service.invalidSearch"), 'INVALID_ARGUMENT');
    // Only resolved commit IDs enter stdin; raw revisions cannot inject flags or
    // negative tips. Keep --not/--remotes on argv to preserve remote exclusion.
    const tipInput = Buffer.from(`${tips.join('\n')}\n`, 'utf8');
    const output = tips.length ? (await this.run(repo, ['log', '--topo-order', '-z', `--format=${commitFormat}`, `--skip=${offset}`, `--max-count=${limit + 1}`, ...searchArgs, '--stdin', '--'], false, undefined, { input: tipInput })).stdout.toString('utf8').split('\0') : [];
    const commits: Commit[] = []; for (let i = 0; i + 5 < output.length; i += 6) commits.push(parseCommit(output.slice(i, i + 6)));
    const visible = commits.slice(0, limit);
    if (visible.length) {
      // Remote availability is based on locally known remote-tracking refs. The
      // same search filter keeps the bounded query aligned with history paging.
      const localOnlyOutput = (await this.run(repo, ['rev-list', '--topo-order', `--max-count=${offset + limit + 1}`, ...searchArgs, '--stdin', '--not', '--remotes', '--'], false, undefined, { input: tipInput })).stdout.toString('utf8').trim();
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
    if (base && !commit.parents.includes(base)) throw new GitError(localizeMessage("service.selectedParentIsNotAParentOfThisCommit"), 'INVALID_PARENT');
    const args = ['diff-tree', '--no-commit-id', '--name-status', '-z', '-r', '-M', ...(base ? [base, oid] : ['--root', oid]), '--']; const files=parseCommitFiles((await this.run(repo,args)).stdout);
    return { commit, body: data.slice(6).join('\0').trimEnd(), files, ...(base ? { parent: base } : {}) };
  }
  async stashDetails(repo: Repository, revision: string): Promise<StashDetails> {
    const stash = await this.details(repo, revision), [, indexOid, untrackedOid] = stash.commit.parents;
    if (!indexOid) throw new GitError(localizeMessage("service.theSelectedObjectIsNotAStash"), 'INVALID_STASH');
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
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024 * 1024)) throw new GitError(localizeMessage("service.invalidContentLimit"), 'INVALID_ARGUMENT');
    if (source.kind === 'empty') return Buffer.alloc(0); await this.verify(repo); const name = validateFilePath(source.path); let object: string | undefined;
    if (source.kind === 'revision') { const oid = await this.oid(repo, source.revision); const records = decodePaths((await this.run(repo, ['ls-tree', '-z', oid, '--', name])).stdout).split('\0'); for (const record of records) { const tab = record.indexOf('\t'); if (record.slice(tab + 1) === name) { const meta = record.slice(0, tab).split(' '); if (meta[1] !== 'blob') throw new GitError(localizeMessage("service.theSelectedPathIsNotAFile"), 'INVALID_PATH'); object = meta[2]; } } }
    else { const stage = source.stage ?? 0; if (![0, 1, 2, 3].includes(stage)) throw new GitError(localizeMessage("service.invalidIndexStage"), 'INVALID_ARGUMENT'); const records = decodePaths((await this.run(repo, ['ls-files', '--stage', '-z', '--', name])).stdout).split('\0'); for (const record of records) { const tab = record.indexOf('\t'); const meta = record.slice(0, tab).split(' '); if (record.slice(tab + 1) === name && Number(meta[2]) === stage) object = meta[1]; } }
    return object ? (await this.run(repo, ['cat-file', 'blob', object], false, maxBytes)).stdout : Buffer.alloc(0);
  }
  /** Freeze the selected target before a native confirmation can outlive its snapshot. */
  private discardChanges(status: Awaited<ReturnType<GitService['status']>>, request: DiscardRequest): Change[] {
    const selected = request.paths && new Set(request.paths.map(validateFilePath));
    return status.changes.filter(change => !change.conflict && (request.scope === 'all' || change.untracked || change.worktreeStatus !== ' ') && (!selected || selected.has(change.path) || !!change.originalPath && selected.has(change.originalPath)));
  }
  private async requireDiscardAllAvailable(repo: Repository, status: Awaited<ReturnType<GitService['status']>>): Promise<void> {
    const gitDir = repo.gitDir ?? await this.text(repo, ['rev-parse', '--path-format=absolute', '--git-dir']);
    const markers = await Promise.all(['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer'].map(name => exists(path.join(gitDir, name))));
    if (status.changes.some(change => change.conflict) || markers.some(Boolean)) throw new GitError(localizeMessage('service.discardAllOperationBlocked'), 'OPERATION_ACTIVE');
  }
  private async discardFingerprint(repo: Repository, status: Awaited<ReturnType<GitService['status']>>, changes: Change[]): Promise<string> {
    const index = await this.run(repo, ['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z']);
    const hash = createHash('sha256').update(JSON.stringify([status.head, status.branch, changes])).update(index.stdout);
    const paths = [...new Set(changes.flatMap(change => [change.path, ...(change.originalPath ? [change.originalPath] : [])]))].sort();
    for (const name of paths) {
      hash.update(JSON.stringify([name, await this.discardPathFingerprint(repo, name)]));
    }
    return hash.digest('hex');
  }
  private async discardPathFingerprint(repo: Repository, name: string): Promise<string> {
    const filename = await safeWorkingPath(repo.root, validateFilePath(name), false);
    try {
      const before = await lstat(filename);
      // Git stores link text; never read the target, especially outside the repository.
      if (before.isSymbolicLink()) return JSON.stringify(['link', await readlink(filename)]);
      if (!before.isFile()) return JSON.stringify(['other', before.mode]);
      const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const same = (value: typeof before) => value.isFile() && value.dev === before.dev && value.ino === before.ino && value.size === before.size && value.mode === before.mode && value.mtimeMs === before.mtimeMs && value.ctimeMs === before.ctimeMs;
        if (!same(await file.stat())) throw new GitError(localizeMessage('service.discardPlanChanged'), 'DISCARD_CHANGED');
        const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
        let position = 0;
        while (position < before.size) {
          const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, before.size - position), position);
          if (!bytesRead) throw new GitError(localizeMessage('service.discardPlanChanged'), 'DISCARD_CHANGED');
          hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
        }
        if (!same(await file.stat()) || !same(await lstat(filename))) throw new GitError(localizeMessage('service.discardPlanChanged'), 'DISCARD_CHANGED');
        return JSON.stringify(['file', before.mode, before.size, hash.digest('hex')]);
      } finally { await file.close(); }
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return 'missing';
      throw error;
    }
  }
  async prepareDiscard(repo: Repository, request: DiscardRequest): Promise<DiscardPlan> {
    await this.verify(repo);
    if ((request.paths !== undefined) === (request.scope !== undefined) || request.paths && !request.paths.length) throw new GitError(localizeMessage('service.selectAtLeastOneFile'), 'INVALID_ARGUMENT');
    const status = await this.status(repo), changes = this.discardChanges(status, request);
    if (request.scope === 'all') await this.requireDiscardAllAvailable(repo, status);
    const paths = [...new Set(changes.flatMap(change => [validateFilePath(change.path), ...(change.originalPath && (request.scope === 'all' && change.indexStatus === 'R' || change.worktreeStatus === 'R') ? [validateFilePath(change.originalPath)] : [])]))];
    await requireExactFileScope(repo, paths, args => this.run(repo, args), status.head);
    const untracked = changes.filter(change => change.untracked).length;
    const plan: DiscardPlan = { token: randomUUID(), scope: request.scope === 'all' ? 'all' : 'unstaged', paths, tracked: paths.length - untracked, untracked, staged: changes.filter(change => !change.untracked && change.indexStatus !== ' ').length, branch: status.branch, ...(status.head ? { head: status.head } : {}) };
    const fingerprint = await this.discardFingerprint(repo, status, changes);
    for (const [key, entry] of this.discards) if (entry.expires < Date.now()) this.discards.delete(key);
    while (this.discards.size >= 64) this.discards.delete(this.discards.keys().next().value!);
    this.discards.set(plan.token, { root: normalized(repo.root), expires: Date.now() + 5 * 60_000, plan, fingerprint, request: { ...request, ...(request.paths ? { paths: [...request.paths] } : {}) } });
    return { ...plan, paths: [...plan.paths] };
  }
  private async checkedDiscard(repo: Repository, token: string) {
    const entry = this.discards.get(token);
    if (!entry || entry.root !== normalized(repo.root) || entry.expires < Date.now()) throw new GitError(localizeMessage('service.discardPlanExpired'), 'DISCARD_CHANGED');
    const status = await this.status(repo), changes = this.discardChanges(status, entry.request);
    await requireExactFileScope(repo, entry.plan.paths, args => this.run(repo, args), status.head);
    if (entry.plan.scope === 'all') await this.requireDiscardAllAvailable(repo, status);
    if (await this.discardFingerprint(repo, status, changes) !== entry.fingerprint) throw new GitError(localizeMessage('service.discardPlanChanged'), 'DISCARD_CHANGED');
    return { plan: entry.plan, status };
  }
  async prepareAction(repo: Repository, action: GitAction): Promise<GitAction> {
    if (action.type === 'discard' && action.planToken) {
      const { plan } = await this.checkedDiscard(repo, action.planToken);
      return { ...action, paths: plan.paths, mode: plan.scope === 'all' ? 'all' : undefined };
    }
    if (!['merge', 'rebase', 'reset'].includes(action.type)) return action;
    const guarded = action as Extract<GitAction, { type: 'merge' | 'rebase' | 'reset' }>;
    await this.verify(repo);
    const current = await this.status(repo);
    if (guarded.expectedHead !== undefined || guarded.expectedBranch !== undefined) this.requireActionContext(guarded, current);
    return { ...guarded, target: await this.oid(repo, guarded.target), expectedHead: current.head ?? '', expectedBranch: current.branch };
  }
  private requireActionContext(action: { expectedHead?: string; expectedBranch?: string }, current: { head?: string; branch: string }): void {
    if (action.expectedHead === undefined || action.expectedBranch === undefined || action.expectedHead !== (current.head ?? '') || action.expectedBranch !== current.branch) {
      throw new GitError(localizeMessage("service.theTargetBranchOrHEADChangedBeforeTheOperation"), 'OPERATION_CHANGED');
    }
  }
  async execute(repo: Repository, action: GitAction, onProgress?: (progress: FileOperationProgress) => void): Promise<void | PushResult> {
    const key = normalized(repo.commonDir); const prior = queues.get(key) ?? Promise.resolve();
    const operation = prior.catch(() => {}).then(async () => { const unsafe = unsafeTerminations.get(key); if (unsafe) throw unsafe; await this.verify(repo); return this.executeNow(repo, action, onProgress); });
    queues.set(key, operation);
    try { const result = await operation; const unsafe = unsafeTerminations.get(key); if (unsafe) throw unsafe; return result; }
    catch (error) { if (error instanceof GitTerminationError) unsafeTerminations.set(key, error); throw unsafeTerminations.get(key) ?? error; }
    finally { if (queues.get(key) === operation) queues.delete(key); }
  }
  async remoteLinks(repo: Repository, remote?: string, branch?: string): Promise<RemoteLinks> {
    if (!remote && branch) { const name=await this.refName(repo,branch); remote = await this.optionalConfig(repo, `branch.${name}.pushRemote`) ?? await this.optionalConfig(repo,'remote.pushDefault') ?? await this.optionalConfig(repo, `branch.${name}.remote`); }
    if (!remote || remote === '.') {
      const remotes = (await this.text(repo, ['remote'])).split('\n').filter(Boolean);
      remote = remotes.length === 1 ? remotes[0] : undefined;
    }
    if (!remote) return { repositories: [] };
    const urls = await this.text(repo, ['remote', 'get-url', '--push', '--all', token(remote, 'remote')]);
    const head = await this.run(repo, ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`], true);
    const name = head.stdout.toString('utf8').trim();
    return { repositories: urls.split('\n').flatMap(value => { const repository = hostingRepository(value); return repository ? [repository] : []; }),
      ...(name.startsWith(remote + '/') ? { defaultBranch: name.slice(remote.length + 1) } : {}) };
  }
  private async push(repo: Repository, args: string[], remote?: string, branch?: string, bound?: BoundRemote): Promise<PushResult> {
    const configured = !bound && remote ? await this.run(repo, ['remote', 'get-url', '--push', '--all', token(remote, 'remote')], true) : undefined;
    const output = await this.run(repo, ['push', '--porcelain', ...args.slice(1)], true, undefined, bound ? { configOverrides: bound.configOverrides, boundRemote: bound } : {});
    const result = parsePushResult(output.stdout.toString('utf8'), output.stderr.toString('utf8'), output.code, remote, branch, bound ? [bound.url] : configured?.code === 0 ? configured.stdout.toString('utf8').trim().split('\n').filter(Boolean) : []);
    if (output.code) {
      const error = new GitError(result.error || translate('en','service.gitExitedWithStatus',{code:output.code}), result.outcome === 'partial' ? 'PARTIAL_FAILURE' : 'GIT_FAILED', output.stdout.toString('utf8'), output.stderr.toString('utf8'));
      error.pushResult = result; throw error;
    }
    return result;
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
    if (!kind) throw new GitError(localizeMessage("service.theGitOperationIsNoLongerActiveRefreshBefore"), 'OPERATION_CHANGED');
    if (!snapshot.operation.canContinue) throw new GitError(localizeMessage("service.resolveConflictsBeforeContinuing"), 'CONFLICTS');
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
    if (!current.operation.canContinue || fingerprint !== await this.reviewFingerprint(repo, current, await this.text(repo, ['write-tree']))) throw new GitError(localizeMessage("service.stagedContentOrTheOperationChangedDuringInspectionCheck"), 'REVIEW_CHANGED');
    const token = randomUUID(); this.reviews.set(repo.id, { token, fingerprint });
    return { kind, token, files };
  }
  private async requireReview(repo: Repository, snapshot: Snapshot, token?: string): Promise<void> {
    if (!snapshot.operation.kind) {
      if (token) throw new GitError(localizeMessage("service.theReviewedGitOperationIsNoLongerActiveRefresh"), 'OPERATION_CHANGED');
      return;
    }
    if (!snapshot.operation.canContinue) throw new GitError(localizeMessage("service.resolveConflictsBeforeContinuing"), 'CONFLICTS');
    const review = this.reviews.get(repo.id);
    if (!token || token !== review?.token) throw new GitError(localizeMessage("service.inspectTheStagedResultAndConfirmBeforeCompletingThis"), 'REVIEW_REQUIRED');
    if (review.fingerprint !== await this.reviewFingerprint(repo, snapshot, await this.text(repo, ['write-tree']))) throw new GitError(localizeMessage("service.stagedContentOrTheOperationChangedInspectTheResult"), 'REVIEW_CHANGED');
    this.reviews.delete(repo.id);
  }
  private async checkout(repo: Repository, target: string, detached = false, stashFirst = false, includeUntracked = false, createFrom?: { oid: string; upstream: string }): Promise<void> {
    if (detached) this.requireDetachedHead();
    const resolved = detached ? await this.oid(repo, target) : await this.refName(repo, target);
    if (!detached && !createFrom) await this.oid(repo, `refs/heads/${resolved}`);
    const snapshot = await this.snapshot(repo);
    const conflictPaths = snapshot.changes.filter(change => change.conflict).map(change => change.path);
    if (conflictPaths.length || snapshot.operation.kind) {
      throw new GitError(conflictPaths.length ? translate('en', "service.resolveConflictsOrAbortTheActiveGitOperationBefore") : translate('en', "service.continueOrAbortTheActiveBeforeCheckout", { kind: (snapshot.operation.kind) }), 'CHECKOUT_BLOCKED', '', '', { reason: conflictPaths.length ? 'conflicts' : 'operation-active', paths: conflictPaths, target });
    }
    const occupied = !detached && snapshot.worktrees.find(tree => tree.branch === target && normalized(tree.path) !== normalized(repo.root));
    if (occupied) throw new GitError(localizeMessage("service.branchIsCheckedOutInOpenThatWorktreeTo", { target: (target), path: (occupied.path) }), 'WORKTREE_OCCUPIED', '', '', { reason: 'worktree-occupied', paths: [], target, worktreePath: occupied.path });
    let branchCreated = false;
    if (createFrom) {
      // Create the ref before touching the Index or Working Tree. switch -c can
      // update both even when an external ref namespace collision makes it fail.
      await this.run(repo, ['branch', '--no-track', '--', resolved, createFrom.oid]);
      branchCreated = true;
      try { await this.run(repo, ['branch', `--set-upstream-to=${createFrom.upstream}`, '--', resolved]); }
      catch (error) {
        throw new GitError(localizeMessage("service.branchWasCreatedAndRetainedButUpstreamConfigurationFailed", { resolved: (resolved), value: (error instanceof Error ? error.message : String(error)) }), 'PARTIAL_FAILURE', '', '', { reason: 'checkout-failed', target, paths: [], branchCreated: true });
      }
    }
    let stashOid: string | undefined;
    if (detached) this.requireDetachedHead();
    if (stashFirst) {
      const previous = snapshot.stashes[0]?.oid;
      await this.run(repo, ['stash', 'push', ...(includeUntracked ? ['--include-untracked'] : []), '-m', translate('en', "service.alwayGitBeforeCheckout", { target: (target) })]);
      const top = await this.run(repo, ['rev-parse', '--verify', 'refs/stash'], true);
      const saved = top.code ? undefined : top.stdout.toString('utf8').trim();
      if (saved !== previous) stashOid = saved;
    }
    try {
      if (detached) this.requireDetachedHead();
      await this.run(repo, ['-c', 'core.quotePath=false', 'switch', ...(detached ? ['--detach'] : []), '--', resolved]);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      const blocked = /would be overwritten|local changes|needs merge|unmerged/i.test(cause);
      const listed = cause.split(/\r?\n/).filter(line => /^\t/.test(line)).map(line => line.slice(1));
      const current = await this.status(repo).catch(() => ({ changes: snapshot.changes }));
      // Porcelain paths are authoritative even for filenames which Git quotes in its diagnostic.
      const affected = listed.length ? current.changes.filter(change => listed.includes(change.path) || listed.includes(change.originalPath ?? '')).map(change => change.path) : [];
      const paths = blocked ? (affected.length ? affected : current.changes.map(change => change.path)) : [];
      const details: CheckoutBlocker = { reason: blocked ? 'local-changes' : 'checkout-failed', paths, target, ...(branchCreated ? { branchCreated: true } : {}), ...(stashOid ? { stashCreated: true, stashOid } : stashFirst ? { stashCreated: false } : {}) };
      const message = `${branchCreated ? translate("en", "service.retainedCheckoutBranch", {branch:resolved}) : ''}${cause}${stashOid ? translate("en", "service.retainedCheckoutStash", {oid:stashOid}) : ''}`;
      throw new GitError(message, blocked ? 'CHECKOUT_BLOCKED' : error instanceof GitError ? error.code : 'CHECKOUT_FAILED', error instanceof GitError ? error.stdout : '', error instanceof GitError ? error.stderr : '', details);
    }
  }
  private requireDetachedHead(): void {
    if (this.options.allowDetachedHead?.() !== true) throw new GitError(localizeMessage("service.directDetachedHEADCheckoutIsDisabledCreateAndSwitch"), 'DETACHED_HEAD_DISABLED');
  }
  private async trackBranches(repo: Repository, action: Extract<GitAction, { type: 'branch.track' }>): Promise<void> {
    if (!action.branches.length || action.branches.length > 1000 || (action.checkout && action.branches.length !== 1) || (action.stashFirst && !action.checkout)) throw new GitError(localizeMessage("service.selectUpTo1000BranchesCheckoutAndStashRequire"), 'INVALID_ARGUMENT');
    // Re-read full ref names under the common-directory write queue. Short names
    // are ambiguous across remotes and upstreams may have changed since the UI opened.
    const [output, remoteOutput] = await Promise.all([
      this.text(repo, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream)%00%(symref)%00%(objecttype)', 'refs/heads', 'refs/remotes']),
      this.text(repo, ['remote']),
    ]);
    const refs = new Map(output.split('\n').filter(Boolean).map(line => { const [fullName, oid, upstream, symbolicTarget, type] = line.split('\0'); return [fullName, { oid, upstream, symbolicTarget, type }] as const; }));
    const remotes = remoteOutput.split('\n').filter(Boolean);
    const plan: { source: string; oid: string; name: string; exists: boolean }[] = [];
    const names = new Map<string, string>();
    for (const branch of action.branches) {
      const name = await this.refName(repo, branch.name), source = token(branch.source, 'remote reference');
      const remoteRef = refs.get(source);
      if (!source.startsWith('refs/remotes/') || !remotes.some(remote => source.startsWith(`refs/remotes/${remote}/`)) || !remoteRef || remoteRef.symbolicTarget || remoteRef.type !== 'commit') throw new GitError(localizeMessage("service.selectAnExistingRemoteBranchRatherThanASymbolic", { source: (source) }), 'INVALID_ARGUMENT');
      if (branch.expectedOid && remoteRef.oid !== branch.expectedOid) throw new GitError(localizeMessage("service.remoteBranchChangedRefreshAndSelectItAgain", { source: (source) }), 'OPERATION_CHANGED');
      const prior = names.get(name);
      if (prior && prior !== source) throw new GitError(localizeMessage("service.multipleRemoteBranchesWouldUseTheSameLocalName", { name: (name) }), 'BRANCH_EXISTS');
      if (prior) continue;
      names.set(name, source);
      const local = refs.get(`refs/heads/${name}`);
      if (local && (local.symbolicTarget || local.upstream !== source)) throw new GitError(localizeMessage("service.localBranchAlreadyExistsAndDoesNotTrackChoose", { name: (name), value: (source.replace('refs/remotes/', '')) }), 'BRANCH_EXISTS');
      // refs/heads/feature and refs/heads/feature/a cannot coexist. Detect this
      // before creating any branch, including collisions within the batch.
      const collision = branchNameConflict(name, [...refs.keys()].filter(ref => ref.startsWith('refs/heads/')).map(ref => ref.slice('refs/heads/'.length)).concat([...names.keys()]).filter(other => other !== name));
      if (collision) throw new GitError(branchNameConflictMessage(name, collision), 'BRANCH_EXISTS');
      plan.push({ source, oid: remoteRef.oid, name, exists: !!local });
    }
    if (action.checkout) {
      const branch = plan[0];
      try { await this.checkout(repo, branch.name, false, action.stashFirst, action.includeUntracked, branch.exists ? undefined : { oid: branch.oid, upstream: branch.source }); }
      catch (error) {
        if (error instanceof GitError && error.details && 'target' in error.details) throw new GitError(error.message, error.code, error.stdout, error.stderr, { ...error.details, trackBranches: action.branches });
        throw error;
      }
      return;
    }
    let created = 0;
    for (const branch of plan) {
      if (branch.exists) continue;
      try {
        await this.run(repo, ['branch', '--no-track', '--', branch.name, branch.oid]); created++;
        await this.run(repo, ['branch', `--set-upstream-to=${branch.source}`, '--', branch.name]);
      }
      catch (error) {
        // An external Git process can race the preflight. Report exactly how far
        // this operation got; never roll back refs which the user may now be using.
        if (!created) throw error;
        throw new GitError(localizeMessage("service.localBranchEsCreatedCreationStoppedAtRefreshBefore", { created: (created), name: (branch.name), value: (error instanceof Error ? error.message : String(error)) }), 'PARTIAL_FAILURE');
      }
    }
  }
  private async validateStash(repo: Repository, selector: string, expectedOid?: string): Promise<string> {
    if (!/^stash@\{\d+\}$/.test(selector)) throw new GitError(localizeMessage("service.invalidStashSelector"), 'INVALID_ARGUMENT');
    if (expectedOid) {
      token(expectedOid, 'stash ID');
      const current = await this.run(repo, ['rev-parse', '--verify', '--end-of-options', `${selector}^{commit}`], true);
      if (current.code || current.stdout.toString('utf8').trim() !== expectedOid) throw new GitError(localizeMessage("service.theStashListChangedRefreshAndSelectTheSaved"), 'STASH_CHANGED');
    }
    return selector;
  }
  private async discard(repo: Repository, action: Extract<GitAction, { type: 'discard' }>, onProgress?: (progress: FileOperationProgress) => void): Promise<void> {
    const prepared = action.planToken ? await this.checkedDiscard(repo, action.planToken) : undefined;
    if (action.mode && !prepared) throw new GitError(localizeMessage('service.discardPlanExpired'), 'DISCARD_CHANGED');
    const all = prepared?.plan.scope === 'all';
    const paths = [...new Set((prepared?.plan.paths ?? action.paths).map(validateFilePath))], selected = new Set(paths);
    if (!paths.length) throw new GitError(localizeMessage('service.selectAtLeastOneFile'), 'INVALID_ARGUMENT');
    const status = prepared?.status ?? await this.status(repo), byPath = new Map(status.changes.map(change => [change.path, change]));
    if (paths.some(name => byPath.get(name)?.conflict)) throw new GitError(localizeMessage('service.resolveConflictsBeforeContinuing'), 'CONFLICTS');
    const renames = status.changes.filter(change => (change.worktreeStatus === 'R' || all && change.indexStatus === 'R') && change.originalPath && (selected.has(change.path) || selected.has(change.originalPath)));
    if (!all && renames.length) {
      const visible = new Set(decodePaths((await this.run(repo, ['diff', '--cached', '--ita-visible-in-index', '--name-only', '-z'])).stdout).split('\0'));
      const invisible = new Set(decodePaths((await this.run(repo, ['diff', '--cached', '--ita-invisible-in-index', '--name-only', '-z'])).stdout).split('\0'));
      if (renames.some(rename => !visible.has(rename.path) || invisible.has(rename.path))) throw new GitError(localizeMessage('service.theRenameDestinationHasStagedContentUnstageTheRename'), 'STAGED_RENAME_DESTINATION');
    }
    const destinations = all ? [] : renames.map(rename => validateFilePath(rename.path)), destinationSet = new Set(destinations);
    const untracked = new Set([...paths.filter(name => byPath.get(name)?.untracked), ...destinations]);
    const tracked = [...new Set([...paths.filter(name => !untracked.has(name)), ...renames.map(rename => validateFilePath(rename.originalPath!))])];
    const prefix = ['-C', repo.root, '--literal-pathspecs'];
    const indexedNewFiles = all && !status.head ? tracked : destinations;
    const clean = [
      ...(indexedNewFiles.length ? splitCleanArguments(await this.gitPath(), prefix, ['clean', '-f', '-x', '--', ...indexedNewFiles]) : []),
      ...(untracked.size > destinations.length ? splitCleanArguments(await this.gitPath(), prefix, ['clean', '-f', '--', ...[...untracked].filter(name => !destinationSet.has(name))]) : []),
    ];
    const total = tracked.length + untracked.size; let completed = 0, indexCleared = false;
    await requireExactFileScope(repo, [...new Set([...tracked, ...untracked])], args => this.run(repo, args), status.head);
    if (action.planToken) this.discards.delete(action.planToken);
    try {
      onProgress?.({ completed, total, phase: 'restoring' });
      for (let start = 0; start < tracked.length; start += 2000) {
        const batch = tracked.slice(start, start + 2000);
        if (all && !status.head) { await this.run(repo, ['rm', '-f', '--cached', '--ignore-unmatch', '--', ...batch]); indexCleared = true; }
        else { await this.run(repo, ['restore', ...(all ? ['--source=HEAD', '--staged'] : []), '--worktree', '--', ...batch]); completed += batch.length; }
        onProgress?.({ completed, total, phase: 'restoring' });
      }
      if (destinations.length) await this.run(repo, ['rm', '-f', '--cached', '--', ...destinations]);
      for (const batch of clean) {
        onProgress?.({ completed, total, phase: 'cleaning' });
        await this.run(repo, batch);
        const remaining = await Promise.all(batch.slice(batch.indexOf('--') + 1).map(async name => { try { await lstat(path.join(repo.root, name)); return name; } catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return undefined; throw error; } }));
        if (remaining.some(Boolean)) throw new GitError(localizeMessage('service.discardFilesRemain', { paths: remaining.filter(Boolean).slice(0, 10).join('\n') }), 'DISCARD_INCOMPLETE');
        completed += batch.length - batch.indexOf('--') - 1;
        onProgress?.({ completed, total, phase: 'cleaning' });
      }
      const remaining = (await this.status(repo)).changes.filter(change => (selected.has(change.path) || !!change.originalPath && selected.has(change.originalPath)) && (all || change.conflict || change.untracked || change.worktreeStatus !== ' '));
      if (remaining.length) throw new GitError(localizeMessage('service.discardFilesRemain', { paths: remaining.slice(0, 10).map(change => change.path).join('\n') }), 'DISCARD_INCOMPLETE');
    } catch (error) {
      if (error instanceof GitTerminationError) throw error;
      throw new GitError(localizeMessage('service.discardIncomplete', { completed, total, value: error instanceof Error ? error.message : String(error) }), completed || indexCleared ? 'PARTIAL_FAILURE' : 'DISCARD_FAILED');
    }
  }
  private async executeNow(repo: Repository, action: GitAction, onProgress?: (progress: FileOperationProgress) => void): Promise<void | PushResult> {
    if (action.type !== 'commit' && action.type !== 'operation.continue') this.reviews.delete(repo.id);
    let args: string[], pushedRemote: string | undefined, boundRemote: BoundRemote | undefined; const remote = (value?: string) => value ? [token(value, 'remote')] : [];
    switch (action.type) {
      case 'discard': return this.discard(repo, action, onProgress);
      case 'stage': case 'resolve-and-stage': case 'unstage': {
        if (!action.paths.length) throw new GitError(localizeMessage("service.selectAtLeastOneFile"), 'INVALID_ARGUMENT'); const paths = action.paths.map(validateFilePath);
        const status = await this.status(repo);
        const byPath = new Map(status.changes.flatMap(change => [[change.path, change] as const, ...(change.originalPath ? [[change.originalPath, change] as const] : [])]));
        const relatedPaths = (area: 'indexStatus' | 'worktreeStatus') => [...new Set(paths.flatMap(name => { const rename = byPath.get(name); return rename?.[area] === 'R' && rename.originalPath ? [validateFilePath(rename.path), validateFilePath(rename.originalPath)] : [name]; }))];
        if (action.type === 'resolve-and-stage' && paths.some(name => !byPath.get(name)?.conflict)) throw new GitError(localizeMessage("service.theSelectedConflictFilesChangedRefreshAndSelectThem"), 'OPERATION_CHANGED');
        const selected = relatedPaths(action.type === 'unstage' ? 'indexStatus' : 'worktreeStatus');
        await requireExactFileScope(repo, selected, args => this.run(repo, args), status.head);
        if (action.type === 'stage' || action.type === 'resolve-and-stage') args = ['add', '--', ...selected];
        else args = status.head ? ['restore', '--staged', '--source=HEAD', '--', ...selected] : ['rm', '-f', '--cached', '--ignore-unmatch', '--', ...selected];
        break;
      }
      case 'commit': {
        if (!action.message.trim() || action.message.includes('\0')) throw new GitError(localizeMessage("service.enterACommitMessage"), 'INVALID_ARGUMENT');
        const snapshot = await this.snapshot(repo);
        if (snapshot.operation.kind && action.amend) throw new GitError(localizeMessage("service.amendIsUnavailableDuringAnActiveGitOperation"), 'INVALID_ARGUMENT');
        if (action.files) {
          if (snapshot.operation.kind || snapshot.operation.conflicts || snapshot.changes.some(change => change.conflict)) throw new GitError(localizeMessage('commit.selectionOperationBlocked'), 'INVALID_ARGUMENT');
          this.requireActionContext(action, snapshot);
          const files = action.files.map(file => ({ ...file, path: validateFilePath(file.path) }));
          const beforeByPath = new Map(snapshot.changes.map(change => [change.path, change]));
          await commitSelected((args, execution) => this.run(repo, args, false, undefined, execution), files, snapshot.changes, snapshot.head,
            ['commit', ...(action.amend ? ['--amend'] : []), '-m', action.message], async () => {
              const current = await this.snapshot(repo), afterByPath = new Map(current.changes.map(change => [change.path, change]));
              const selectedPaths = [...new Set(files.flatMap(file => {
                const change = beforeByPath.get(file.path);
                return change?.originalPath && (change.indexStatus === 'R' || file.area === 'unstaged' && change.worktreeStatus === 'R') ? [file.path, change.originalPath] : [file.path];
              }))];
              await requireExactFileScope(repo, selectedPaths, args => this.run(repo, args), current.head);
              this.requireActionContext(action, current);
              if (current.operation.kind || current.changes.some(change => change.conflict) || files.some(file => {
                const before = beforeByPath.get(file.path), after = afterByPath.get(file.path);
                return !before || !after || before.indexStatus !== after.indexStatus || before.worktreeStatus !== after.worktreeStatus || before.originalPath !== after.originalPath;
              })) throw new GitError(localizeMessage('commit.selectionChanged'), 'OPERATION_CHANGED');
            }, await this.gitPath());
          return;
        }
        await this.requireReview(repo, snapshot, action.reviewToken);
        args = ['commit', ...(action.amend ? ['--amend'] : []), '-m', action.message]; break;
      }
      case 'fetch': args = ['fetch', ...remote(action.remote)]; break;
      case 'pull': if (!['ff-only', 'merge', 'rebase'].includes(action.strategy)) throw new GitError(localizeMessage("service.invalidPullStrategy"), 'INVALID_ARGUMENT'); args = ['pull', ...(action.strategy === 'merge' ? ['--no-rebase', '--ff'] : [`--${action.strategy}`]), ...remote(action.remote)]; break;
      case 'push': {
        if (action.forceWithLease && (!action.remote || !action.branch || !action.remoteBranch)) throw new GitError(localizeMessage("service.selectExplicitLocalAndRemoteBranchesThenReopenThe"), 'OPERATION_CHANGED');
        const branch = action.branch ? await this.refName(repo, action.branch) : undefined; let destination = action.remote;
        if (action.remoteBranch && !branch) throw new GitError(localizeMessage("service.selectALocalBranchBeforeChoosingARemoteBranch"), 'INVALID_ARGUMENT');
        if (branch) { await this.oid(repo, `refs/heads/${branch}`); if (!destination) { const configured = await this.run(repo, ['config', '--get', `branch.${branch}.remote`], true); if (configured.code > 1) throw new GitError(configured.stderr.toString('utf8'), 'GIT_FAILED'); destination = configured.stdout.toString('utf8').trim(); if (!destination) { const remotes = (await this.text(repo, ['remote'])).split('\n').filter(Boolean); if (remotes.length !== 1) throw new GitError(localizeMessage("service.selectARemoteBeforePushingThisBranch"), 'INVALID_ARGUMENT'); destination = remotes[0]; } } }
        const remoteBranch = branch ? await this.refName(repo, action.remoteBranch ?? branch) : undefined;
        const setUpstream = branch && (action.setUpstream ?? true);
        const lease = action.forceWithLease ? this.confirmedRemoteOid(action.expectedOid) : undefined;
        if (action.forceWithLease) boundRemote = await this.confirmRemoteDestination(repo, destination!, action.expectedDestination);
        pushedRemote = destination;
        args = ['push', action.followTags ? '--follow-tags' : '--no-follow-tags', ...(setUpstream ? ['--set-upstream'] : []), ...(lease !== undefined ? [`--force-with-lease=refs/heads/${remoteBranch}:${lease}`] : []), ...remote(destination), ...(branch ? [`refs/heads/${branch}:refs/heads/${remoteBranch}`] : [])]; break;
      }
      case 'remote.add': {
        const name=action.name.trim(),url=action.url.trim();
        if(remoteNameProblem(name))throw new GitError(localizeMessage("service.enterARemoteNameWithoutSpacesSuchAsOrigin"),'INVALID_REMOTE_NAME');
        if(remoteUrlProblem(url))throw new GitError(localizeMessage("service.enterARepositoryURL"),'INVALID_REMOTE_URL');
        const configured=(await this.text(repo,['remote'])).split('\n').filter(Boolean);
        if(configured.includes(name))throw new GitError(localizeMessage("service.remoteAlreadyExists", { name: (name) }),'REMOTE_EXISTS');
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
          catch (error) { throw new GitError(localizeMessage("service.branchWasCreatedAndRetainedButUpstreamConfigurationFailedVariant2", { name: (name), value: (error instanceof Error ? error.message : String(error)) }), 'PARTIAL_FAILURE'); }
        }
        if (action.checkout) {
          try { await this.checkout(repo, name); }
          catch (error) {
            const details: CheckoutBlocker = { ...(error instanceof GitError && error.details && 'target' in error.details ? error.details : { reason: 'checkout-failed' as const, paths: [], target: name }), branchCreated: true };
            throw new GitError(localizeMessage("service.branchWasCreatedAndRetainedButCheckoutDidNotVariant2", { name: (name), value: (error instanceof Error ? error.message : String(error)) }), error instanceof GitError ? error.code : 'CHECKOUT_FAILED', error instanceof GitError ? error.stdout : '', error instanceof GitError ? error.stderr : '', details);
          }
        }
        return;
      }
      case 'branch.checkout': return this.checkout(repo, action.name);
      case 'branch.track': return this.trackBranches(repo, action);
      case 'commit.checkout': return this.checkout(repo, action.target, true);
      case 'checkout.stash': return this.checkout(repo, action.target, action.detached, true, action.includeUntracked);
      case 'branch.delete': {
        const names=await mapGitQueries([...new Set(action.names)], name=>this.refName(repo,name));
        if(!names.length)throw new GitError(localizeMessage("service.selectAtLeastOneBranch"),'INVALID_ARGUMENT');
        const state=await this.snapshot(repo),current=state.branch,occupied=new Set(state.worktrees.map(tree=>tree.branch?.replace(/^refs\/heads\//,'')).filter(Boolean));
        if(current&&names.includes(current))throw new GitError(localizeMessage("service.theCurrentBranchCannotBeDeleted", { current: (current) }),'INVALID_ARGUMENT');
        const inUse=names.find(name=>occupied.has(name));if(inUse)throw new GitError(localizeMessage("service.branchIsUsedByAWorktree", { inUse: (inUse) }),'WORKTREE_OCCUPIED');
        const expectedOids = new Map<string, string>();
        for (const name of names) {
          const oid = await this.oid(repo, `refs/heads/${name}`), expected = action.expectedOids?.[name];
          if (expected !== undefined && expected !== oid) throw new GitError(localizeMessage("service.branchChangedBeforeDeletion", { name }), 'OPERATION_CHANGED');
          expectedOids.set(name, oid);
        }
        const failures:string[]=[];let deleted=0;
        for (const name of names) {
          try {
            const expected = expectedOids.get(name)!;
            // The ref transaction compares the old object while holding its lock.
            // It also deletes the reflog, without touching a symbolic ref's target.
            const result = await this.run(repo, ['update-ref', '--no-deref', '-d', `refs/heads/${name}`, expected], true, undefined, { beforeSpawn: async () => {
              const occupied = (await this.worktrees(repo)).find(tree => tree.branch === name);
              if (occupied) throw new GitError(localizeMessage('service.branchIsUsedByAWorktree', { inUse: name }), 'WORKTREE_OCCUPIED');
              if (!action.force) {
                // Match native branch -d: use a valid upstream, otherwise current HEAD.
                const upstream = await this.text(repo, ['for-each-ref', '--format=%(upstream)', `refs/heads/${name}`]);
                const upstreamOid = upstream ? await this.run(repo, ['rev-parse', '--verify', `${upstream}^{commit}`], true) : undefined;
                const mergeTarget = upstreamOid?.code === 0 ? upstreamOid.stdout.toString('utf8').trim() : (await this.status(repo)).head;
                const merged = mergeTarget ? await this.run(repo, ['merge-base', '--is-ancestor', expected, mergeTarget], true) : undefined;
                if (!merged || merged.code === 1) throw new GitError(localizeMessage('service.branchNotMerged', { name }), 'BRANCH_NOT_MERGED');
                if (merged.code) throw new GitError(merged.stderr.toString('utf8').trim(), 'GIT_FAILED');
              }
            } });
            if (result.code) throw new GitError(localizeMessage('service.branchChangedBeforeDeletion', { name }), 'OPERATION_CHANGED', result.stdout.toString('utf8'), result.stderr.toString('utf8'));
            deleted++;
            // A newly recreated branch owns its own configuration.
            const recreated = await this.run(repo, ['show-ref', '--verify', '--quiet', '--', `refs/heads/${name}`], true);
            if (!recreated.code) continue;
            if (recreated.code !== 1) throw new GitError(recreated.stderr.toString('utf8').trim(), 'GIT_FAILED');
            const config = await this.run(repo, ['config', '--remove-section', `branch.${name}`], true);
            if (config.code) {
              const pattern = `^branch\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`;
              const remaining = await this.run(repo, ['config', '--get-regexp', pattern], true);
              // Git versions differ in the missing-section exit code. Only
              // confirmed absence makes failed cleanup harmless.
              if (remaining.code !== 1) throw new GitError(config.stderr.toString('utf8').trim(), 'GIT_FAILED');
            }
          } catch (error) {
            if (error instanceof GitTerminationError) throw error;
            failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if(failures.length)throw new GitError(localizeMessage("service.branchEsDeletedFailed", { deleted: (deleted), count: (failures.length), value: (failures.join('\n')) }),'PARTIAL_FAILURE');
        return;
      }
      case 'remote.delete': {
        const destination=token(action.remote,'remote'),configured=(await this.text(repo,['remote'])).split('\n').filter(Boolean);
        if(!configured.includes(destination))throw new GitError(localizeMessage("service.unknownRemote", { destination: (destination) }),'INVALID_ARGUMENT');
        const branches=await mapGitQueries([...new Set(action.branches)], name=>this.refName(repo,name));
        if(!branches.length)throw new GitError(localizeMessage("service.selectAtLeastOneRemoteBranch"),'INVALID_ARGUMENT');
        for (const branch of branches) this.confirmedRemoteOid(Object.hasOwn(action.expectedOids ?? {}, branch) ? action.expectedOids![branch] : undefined);
        const bound = await this.confirmRemoteDestination(repo, destination, action.expectedDestination);
        const failures:string[]=[];let deleted=0;
        for(const branch of branches){try{await this.run(repo,['push','--no-follow-tags',`--force-with-lease=refs/heads/${branch}:${action.expectedOids![branch]}`,destination,`:refs/heads/${branch}`],false,undefined,{configOverrides:bound.configOverrides,boundRemote:bound});deleted++;}catch(error){if(error instanceof GitTerminationError)throw error;failures.push(`${destination}/${branch}: ${error instanceof Error?error.message:String(error)}`);}}
        if(failures.length)throw new GitError(localizeMessage("service.remoteBranchEsDeletedFailed", { deleted: (deleted), count: (failures.length), value: (failures.join('\n')) }),'PARTIAL_FAILURE');
        return;
      }
      case 'tag.create': {
        const name=token(action.name,'tag name'),ref=`refs/tags/${name}`;
        await this.run(repo,['check-ref-format',ref]);
        const target=await this.oid(repo,action.target??'HEAD');
        let destination:string|undefined;
        if(action.pushRemote){
          destination=token(action.pushRemote,'remote');
          const configured=(await this.text(repo,['remote'])).split('\n').filter(Boolean);
          if(!configured.includes(destination))throw new GitError(localizeMessage("service.unknownRemote",{destination}),'INVALID_ARGUMENT');
        }
        await this.run(repo,['tag',...(action.message?['-a','-m',action.message]:[]),name,target]);
        if(destination){
          try{return await this.push(repo,['push','--no-follow-tags',destination,`${ref}:${ref}`],destination);}
          catch(error){
            const detail=error instanceof Error?error.message:String(error);
            const failure=new GitError(localizeMessage("service.tagWasCreatedLocallyButCouldNotBePushed",{name,destination,value:detail}),'PARTIAL_FAILURE',error instanceof GitError?error.stdout:'',error instanceof GitError?error.stderr:'');
            if(error instanceof GitError)failure.pushResult=error.pushResult;throw failure;
          }
        }
        return;
      }
      case 'tag.push': {
        const destination=token(action.remote,'remote'),configured=(await this.text(repo,['remote'])).split('\n').filter(Boolean);
        if(!configured.includes(destination))throw new GitError(localizeMessage("service.unknownRemote", { destination: (destination) }),'INVALID_ARGUMENT');
        const names=[...new Set(action.names.map(name=>token(name,'tag name')))];
        if(!names.length)throw new GitError(localizeMessage("service.selectAtLeastOneTag"),'INVALID_ARGUMENT');
        const plan: { name: string; oid: string }[] = [];
        for(const name of names){
          const ref=`refs/tags/${name}`;await this.run(repo,['check-ref-format',ref]);
          const expected=Object.hasOwn(action.expectedOids,name)?action.expectedOids[name]:undefined;
          if(!expected||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(expected)||/^0+$/.test(expected))throw new GitError(localizeMessage("service.theTagIdentityIsMissingOrInvalidRefreshAnd"),'OPERATION_CHANGED');
          const current=await this.run(repo,['show-ref','--verify','--hash','--',ref],true);
          if(current.code||current.stdout.toString('utf8').trim()!==expected)throw new GitError(localizeMessage("service.theTagChangedRefreshAndReopenThePushDialog", { name: (name) }),'OPERATION_CHANGED');
          plan.push({ name, oid: expected });
        }
        const failures:string[]=[];let pushed=0;
        for(const {name,oid} of plan){try{await this.run(repo,['push','--no-follow-tags',destination,`${oid}:refs/tags/${name}`]);pushed++;}catch(error){if(error instanceof GitTerminationError)throw error;failures.push(`${destination}/${name}: ${error instanceof Error?error.message:String(error)}`);}}
        if(failures.length)throw new GitError(localizeMessage("service.tagEsPushedFailed", { pushed: (pushed), count: (failures.length), value: (failures.join('\n')) }),'PARTIAL_FAILURE');
        return;
      }
      case 'tag.delete': {
        const ref = `refs/tags/${token(action.name, 'tag name')}`, expected = action.expectedOid;
        await this.run(repo, ['check-ref-format', ref]);
        const validOid = (value: string | undefined) => !!value && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value) && !/^0+$/.test(value);
        if (!expected && !action.remote) throw new GitError(localizeMessage("service.theTagIdentityIsMissingOrInvalidRefreshAnd"), 'OPERATION_CHANGED');
        if (expected && !validOid(expected)) throw new GitError(localizeMessage("service.theTagIdentityIsMissingOrInvalidRefreshAnd"), 'OPERATION_CHANGED');
        const currentLocal = async () => this.run(repo, ['show-ref', '--verify', '--hash', '--', ref], true);
        if (expected) {
          const current = await currentLocal();
          if (current.code || current.stdout.toString('utf8').trim() !== expected) throw new GitError(localizeMessage("service.theTagChangedRefreshAndReopenTheDeletionDialog"), 'OPERATION_CHANGED');
        }
        let published: PushResult | undefined;
        if (action.remote) {
          const destination = token(action.remote, 'remote'), remoteExpected = action.expectedRemoteOid;
          const configured = (await this.text(repo, ['remote'])).split('\n').filter(Boolean);
          if (!configured.includes(destination)) throw new GitError(localizeMessage("service.unknownRemote", { destination }), 'INVALID_ARGUMENT');
          if (!validOid(remoteExpected)) throw new GitError(localizeMessage("service.theTagIdentityIsMissingOrInvalidRefreshAnd"), 'OPERATION_CHANGED');
          const bound = await this.confirmRemoteDestination(repo, destination, action.expectedDestination);
          const readUrl = await this.text(repo, ['remote', 'get-url', destination]);
          const pushUrls = (await this.text(repo, ['remote', 'get-url', '--push', '--all', destination])).split('\n').filter(Boolean);
          if (pushUrls.length !== 1) throw new GitError(localizeMessage("service.thisRemoteHasMultiplePushDestinationsSelectARemote"), 'MULTIPLE_PUSH_DESTINATIONS');
          if (pushUrls[0] !== readUrl || readUrl !== bound.url) throw new GitError(localizeMessage("service.remoteTagDeletionRequiresMatchingReadAndPushAddresses"), 'SEPARATE_PUSH_DESTINATION');
          published = await this.push(repo, ['push', '--no-follow-tags', `--force-with-lease=${ref}:${remoteExpected}`, destination, `:${ref}`], destination, undefined, bound);
        }
        if (expected) {
          // Compare the raw ref object, including an annotated tag object, atomically.
          // Do not dereference a symbolic tag and accidentally remove its target.
          const deleted = await this.run(repo, ['update-ref', '--no-deref', '-d', ref, expected], true);
          if (deleted.code) {
            const latest = await currentLocal();
            const changed = latest.code || latest.stdout.toString('utf8').trim() !== expected;
            const failureMessage = published
              ? localizeMessage(changed ? "service.remoteTagWasDeletedButTheLocalTagChangedAndWasRetained" : "service.remoteTagWasDeletedButTheLocalTagCouldNotBeDeleted")
              : changed ? localizeMessage("service.theTagChangedBeforeDeletionRefreshAndReopenThe") : deleted.stderr.toString('utf8').trim() || translate('en', "service.tagDeletionFailed");
            const failure = new GitError(failureMessage, published ? 'PARTIAL_FAILURE' : changed ? 'OPERATION_CHANGED' : 'GIT_FAILED', deleted.stdout.toString('utf8'), deleted.stderr.toString('utf8'));
            if (published) failure.pushResult = published;
            throw failure;
          }
        }
        return published;
      }
      case 'stash.create': {
        if (action.message?.includes('\0')) throw new GitError(localizeMessage("service.messagesCannotContainNULCharacters"), 'INVALID_ARGUMENT');
        // store has no stdin message option. Check its worst-case command before
        // preparing any snapshot or changing the source repository.
        if (action.message) assertGitArgumentBudget(await this.gitPath(), ['-C', repo.root, 'stash', 'store', '-m', action.message, '0'.repeat(64)]);
        if (action.paths) {
          if (!action.paths.length) throw new GitError(localizeMessage("service.selectAtLeastOneFile"), 'INVALID_ARGUMENT');
          const snapshot = await this.snapshot(repo);
          if (snapshot.operation.kind || snapshot.operation.conflicts) throw new GitError(localizeMessage("service.finishTheActiveOperationOrResolveConflictsBeforeSaving"), 'CONFLICTS');
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
          const summary = paths.length === 1 ? paths[0] : translate('en', "service.savedUntrackedFiles", { count: (paths.length) });
          throw new GitError(localizeMessage("service.cannotRestoreTheStashBecauseTheProjectAlreadyContains", { summary: (summary) }), 'STASH_UNTRACKED_CONFLICT', '', '', blocker);
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
          catch { throw new GitError(localizeMessage("service.stashChangesWereAppliedButTheStashListChanged"), 'STASH_CHANGED'); }
          await this.run(repo, ['stash', 'drop', selector]);
        }
        return;
      }
      case 'stash.drop': args = ['stash', 'drop', await this.validateStash(repo, action.selector, action.expectedOid)]; break;
      case 'worktree.add': {
        // A revision without -b or an existing branch implicitly creates a detached Worktree.
        if (action.detach || !action.branch && !action.newBranch && !!action.start) this.requireDetachedHead();
        token(action.path, 'worktree path'); if (action.detach && (action.branch || action.newBranch)) throw new GitError(localizeMessage("service.detachedWorktreesCannotAlsoSelectABranch"), 'INVALID_ARGUMENT'); if (action.branch && action.newBranch) throw new GitError(localizeMessage("service.chooseAnExistingOrANewBranch"), 'INVALID_ARGUMENT');
        const target = path.resolve(repo.root, action.path); const current = await this.worktrees(repo); if (current.some(x => normalized(x.path) === normalized(target))) throw new GitError(localizeMessage("service.worktreeAlreadyRegistered"), 'INVALID_WORKTREE');
        args = ['worktree', 'add', ...(action.detach ? ['--detach'] : []), ...(action.newBranch ? ['-b', await this.refName(repo, action.newBranch)] : []), '--', target];
        if (action.branch) { await this.refName(repo, action.branch); args.push(await this.oid(repo, `refs/heads/${action.branch}`)); if (!action.detach) args[args.length - 1] = action.branch; } else if (action.start) args.push(await this.oid(repo, action.start)); break;
      }
      case 'worktree.remove': { token(action.path, 'worktree path'); const target = await canonicalPath(path.resolve(repo.root, action.path)); const trees = await this.worktrees(repo); const canonical = await Promise.all(trees.map(tree => canonicalPath(tree.path))); const selected = trees.find((_, index) => normalized(canonical[index]) === normalized(target)); if (!selected || normalized(target) === normalized(canonical[0]) || normalized(target) === normalized(repo.root)) throw new GitError(localizeMessage("service.onlyRegisteredLinkedWorktreesOtherThanTheCurrentWorktree"), 'INVALID_WORKTREE'); if (selected.locked) throw new GitError(localizeMessage("service.thisWorktreeIsLockedUnlockItBeforeRemoval", { locked: (selected.locked) }), 'WORKTREE_LOCKED'); args = ['worktree', 'remove', ...(action.force ? ['--force'] : []), '--', selected.path]; break; }
      case 'merge': case 'rebase': this.requireActionContext(action, await this.status(repo)); args = [action.type, await this.oid(repo, action.target)]; break;
      case 'cherry-pick': case 'revert': {
        if (!action.commits.length) throw new GitError(localizeMessage("service.selectCommits"), 'INVALID_ARGUMENT');
        if (action.mainline !== undefined && (!Number.isSafeInteger(action.mainline) || action.mainline < 1)) throw new GitError(localizeMessage("service.invalidMergeParentNumber"), 'INVALID_ARGUMENT');
        if(action.expectedHead||action.expectedBranch){const current=await this.status(repo);if(action.expectedHead&&current.head!==action.expectedHead||action.expectedBranch&&current.branch!==action.expectedBranch)throw new GitError(localizeMessage("service.theTargetBranchChangedBeforeTheOperationStartedSelect"), 'OPERATION_CHANGED');}
        const commits = await mapGitQueries(action.commits, x => this.oid(repo, x));
        if (action.type === 'cherry-pick') {
          const check = await this.cherryPickCheck(repo, commits);
          if (check.included.includes(check.head)) throw new GitError(localizeMessage('service.cherryPickCurrentHead'), 'COMMIT_ALREADY_INCLUDED');
          if (check.included.length && !action.allowIncluded) throw new GitError(localizeMessage('service.cherryPickAlreadyIncluded'), 'COMMIT_ALREADY_INCLUDED');
          if (action.allowIncluded || action.expectedHead !== undefined || action.expectedBranch !== undefined) this.requireActionContext(action, check);
          // Check again after the read-only preflight; never apply to a changed branch.
          this.requireActionContext({ expectedHead: check.head, expectedBranch: check.branch }, await this.status(repo));
        }
        args = [action.type, ...(action.mainline ? ['-m', String(action.mainline)] : []), ...commits]; break;
      }
      case 'reset': if (!['soft', 'mixed', 'hard'].includes(action.mode)) throw new GitError(localizeMessage("service.invalidResetMode"), 'INVALID_ARGUMENT'); this.requireActionContext(action, await this.status(repo)); args = ['reset', `--${action.mode}`, await this.oid(repo, action.target), '--']; break;
      case 'operation.continue': case 'operation.abort': case 'operation.skip': {
        const snapshot = await this.snapshot(repo), state = snapshot.operation;
        if (!state.kind || state.kind !== action.kind) throw new GitError(localizeMessage("service.theSelectedGitOperationIsNoLongerActive"), 'OPERATION_CHANGED');
        const command = action.type.split('.')[1];
        if (command === 'skip' && !state.canSkip) throw new GitError(localizeMessage("service.thisOperationCannotBeSkipped"), 'INVALID_ARGUMENT');
        if (action.type === 'operation.continue') await this.requireReview(repo, snapshot, action.reviewToken);
        args = [action.kind, `--${command}`]; break;
      }
      default: throw new GitError(localizeMessage("service.unsupportedGitAction"), 'INVALID_ARGUMENT');
    }
    if (action.type === 'worktree.add' && (action.detach || !action.branch && !action.newBranch && !!action.start)) this.requireDetachedHead();
    if (args[0] === 'push') {
      return this.push(repo, args, pushedRemote ?? ('remote' in action ? action.remote : undefined), action.type === 'push' ? action.branch : undefined, boundRemote);
    }
    await this.run(repo, args);
  }
}
