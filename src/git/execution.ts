import type { Repository } from '../protocol/types';
import type { GitResult } from './runner';
import type { StashExecution } from './stash';

export interface BoundRemote {
  remote: string;
  url: string;
  configOverrides: [string, string][];
}

/** Options interpreted only by GitService.run, including its cancellation and write guards. */
export interface GitExecution extends StashExecution {
  signal?: AbortSignal;
  maxOutputBytes?: number;
  configOverrides?: [string, string][];
  beforeSpawn?: () => Promise<void>;
  boundRemote?: BoundRemote;
  onStdout?: (chunk: Buffer) => void;
}

export type GitRun = (
  repo: Repository,
  args: string[],
  allowFailure?: boolean,
  captureBytes?: number,
  execution?: GitExecution,
) => Promise<GitResult>;
