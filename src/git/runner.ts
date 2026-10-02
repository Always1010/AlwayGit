import { message as localizeMessage, translate } from '../i18n/index';
import { spawn } from 'node:child_process';
import { GitError, GitReadTerminationError, GitTerminationError } from './error';

export interface GitRunOptions {
  executable?: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  input?: Buffer;
  timeoutMs?: number;
  maxOutputBytes?: number;
  captureBytes?: number;
  onStderr?: (chunk: Buffer) => void;
  onStop?: () => void;
  signal?: AbortSignal;
  readOnly?: boolean;
}
export type GitResult = { stdout: Buffer; stderr: Buffer; code: number };

/** Waits for process-tree termination, or reports that the repository must be isolated. */
export function runGitProcess(options: GitRunOptions): Promise<GitResult> {
  if (options.signal?.aborted) return Promise.reject(new GitError(localizeMessage("runner.gitOperationWasCancelled"), 'ABORTED'));
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable ?? 'git', options.args, {
      shell: false, windowsHide: true, detached: process.platform !== 'win32', env: options.env,
      stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [], err: Buffer[] = [];
    let size = 0, captured = 0;
    let failure: GitError | undefined;
    let terminationFailure: string | undefined;
    let closed = false, terminating = false, settled = false;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    let complete!: () => void;
    const completion = new Promise<void>(resolve => { complete = resolve; });
    let exitCode = 1;
    const unconfirmed = (message: string) => options.readOnly
      ? new GitReadTerminationError(localizeMessage("runner.theReadOnlyQueryDidNotConfirmProcessTree", { value: (failure?.message ?? translate('en', "runner.gitQueryFailed")), message: (message) }), failure?.code ?? 'GIT_FAILED', child.pid, completion)
      : new GitTerminationError(localizeMessage("runner.furtherWritesAreBlockedPendingManualVerification", { value: (failure?.message ?? translate('en', "runner.cannotStopGit")), message: (message) }), child.pid, completion, failure?.code);
    const finish = () => {
      if (!closed || terminating) return;
      complete();
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(terminationTimer);
      options.signal?.removeEventListener('abort', abort);
      if (terminationFailure) reject(unconfirmed(translate('en', "runner.processTreeTerminationFailed", { terminationFailure: (terminationFailure) })));
      else if (failure) reject(failure);
      else resolve({ stdout: Buffer.concat(out), stderr: Buffer.concat(err), code: exitCode });
    };
    const killRoot = () => {
      // A failed termination request is not evidence that the process exited.
      // Keep waiting for close, even if this fallback also fails.
      try { if (!child.kill('SIGKILL') && !closed) terminationFailure ??= translate('en', "runner.theGitTerminationRequestWasNotAccepted"); }
      catch (error) { terminationFailure ??= (error as Error).message; }
    };
    const stop = (error: GitError) => {
      if (failure || closed) return;
      failure = error;
      try { options.onStop?.(); } catch { /* Prompt cleanup must not interrupt process termination. */ }
      clearTimeout(timer);
      terminationTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', abort);
        reject(unconfirmed(translate('en', "runner.gitProcessTreeTerminationDidNotFinishWithin5", { value: (terminationFailure ? ` (${terminationFailure})` : '') })));
      }, 5000);
      if (!child.pid) return;
      if (process.platform === 'win32') {
        terminating = true;
        try {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
          killer.once('error', error => { terminationFailure = error.message; killRoot(); });
          killer.once('close', code => {
            if (code !== 0 && !terminationFailure) { terminationFailure = translate('en', "runner.taskkillExitedWithStatus", { value: (code ?? translate('en', "runner.unknown")) }); killRoot(); }
            terminating = false;
            finish();
          });
        } catch (error) {
          terminationFailure = (error as Error).message;
          killRoot();
          terminating = false;
          finish();
        }
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { terminationFailure = (error as Error).message; killRoot(); }
      }
    };
    const abort = () => stop(new GitError(localizeMessage("runner.gitOperationWasCancelled"), 'ABORTED'));
    const timer = setTimeout(() => stop(new GitError(localizeMessage("runner.gitTimedOutCheckCredentialsHooksOrAnotherGit"), 'TIMEOUT')), options.timeoutMs ?? 60000);
    const collect = (bucket: Buffer[], chunk: Buffer) => {
      // Keep draining after cancellation; destroying pipes can manufacture close
      // before descendants have finished using the inherited pipe handles.
      if (failure) return;
      if (bucket === out && options.captureBytes !== undefined) {
        const remaining = options.captureBytes - captured;
        if (remaining > 0) { const piece = chunk.subarray(0, remaining); bucket.push(piece); captured += piece.length; }
        return;
      }
      size += chunk.length;
      if (size > (options.maxOutputBytes ?? 32 * 1024 * 1024)) { stop(new GitError(localizeMessage("runner.gitOutputExceededTheConfiguredLimit"), 'OUTPUT_LIMIT')); return; }
      bucket.push(chunk);
      if (bucket === err) options.onStderr?.(chunk);
    };
    child.stdout!.on('data', chunk => collect(out, chunk));
    child.stderr!.on('data', chunk => collect(err, chunk));
    child.once('error', error => { failure ??= new GitError(localizeMessage("runner.cannotRunGit", { message: (error.message) }), 'GIT_UNAVAILABLE'); });
    child.once('close', code => { closed = true; exitCode = code ?? 1; finish(); });
    options.signal?.addEventListener('abort', abort, { once: true });
    // Cancellation can arrive while spawn registers its event listeners.
    if (options.signal?.aborted) abort();
    if (options.input) { child.stdin?.on('error', () => {}); child.stdin?.end(options.input); }
  });
}
