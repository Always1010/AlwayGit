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
  signal?: AbortSignal;
  readOnly?: boolean;
}
export type GitResult = { stdout: Buffer; stderr: Buffer; code: number };

/** Waits for process-tree termination, or reports that the repository must be isolated. */
export function runGitProcess(options: GitRunOptions): Promise<GitResult> {
  if (options.signal?.aborted) return Promise.reject(new GitError('Git operation was cancelled', 'ABORTED'));
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
      ? new GitReadTerminationError(`${failure?.message ?? 'Git query failed'}. ${message}; the read-only query did not confirm process-tree termination.`, failure?.code ?? 'GIT_FAILED', child.pid, completion)
      : new GitTerminationError(`${failure?.message ?? 'Cannot stop Git'}. ${message}; further writes are blocked pending manual verification.`, child.pid, completion, failure?.code);
    const finish = () => {
      if (!closed || terminating) return;
      complete();
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(terminationTimer);
      options.signal?.removeEventListener('abort', abort);
      if (terminationFailure) reject(unconfirmed(`Process-tree termination failed: ${terminationFailure}`));
      else if (failure) reject(failure);
      else resolve({ stdout: Buffer.concat(out), stderr: Buffer.concat(err), code: exitCode });
    };
    const killRoot = () => {
      // A failed termination request is not evidence that the process exited.
      // Keep waiting for close, even if this fallback also fails.
      try { if (!child.kill('SIGKILL') && !closed) terminationFailure ??= 'the Git termination request was not accepted'; }
      catch (error) { terminationFailure ??= (error as Error).message; }
    };
    const stop = (error: GitError) => {
      if (failure || closed) return;
      failure = error;
      clearTimeout(timer);
      terminationTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', abort);
        reject(unconfirmed(`Git process-tree termination did not finish within 5 seconds${terminationFailure ? ` (${terminationFailure})` : ''}`));
      }, 5000);
      if (!child.pid) return;
      if (process.platform === 'win32') {
        terminating = true;
        try {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
          killer.once('error', error => { terminationFailure = error.message; killRoot(); });
          killer.once('close', code => {
            if (code !== 0 && !terminationFailure) { terminationFailure = `taskkill exited with status ${code ?? 'unknown'}`; killRoot(); }
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
    const abort = () => stop(new GitError('Git operation was cancelled', 'ABORTED'));
    const timer = setTimeout(() => stop(new GitError('Git timed out. Check credentials, hooks, or another Git process, then retry.', 'TIMEOUT')), options.timeoutMs ?? 60000);
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
      if (size > (options.maxOutputBytes ?? 32 * 1024 * 1024)) { stop(new GitError('Git output exceeded the configured limit', 'OUTPUT_LIMIT')); return; }
      bucket.push(chunk);
      if (bucket === err) options.onStderr?.(chunk);
    };
    child.stdout!.on('data', chunk => collect(out, chunk));
    child.stderr!.on('data', chunk => collect(err, chunk));
    child.once('error', error => { failure ??= new GitError(`Cannot run Git: ${error.message}`, 'GIT_UNAVAILABLE'); });
    child.once('close', code => { closed = true; exitCode = code ?? 1; finish(); });
    options.signal?.addEventListener('abort', abort, { once: true });
    // Cancellation can arrive while spawn registers its event listeners.
    if (options.signal?.aborted) abort();
    if (options.input) { child.stdin?.on('error', () => {}); child.stdin?.end(options.input); }
  });
}
