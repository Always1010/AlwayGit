import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { GitServiceContract, Repository } from '../protocol/types';

export interface DiscoveryProgress { scanned: number; found: number }
export interface DiscoveryOptions {
  isCancelled?: () => boolean;
  onProgress?: (progress: DiscoveryProgress) => void;
}
export interface DiscoveryResult extends DiscoveryProgress {
  repositories: Repository[];
  issues: { path: string; message: string }[];
  cancelled: boolean;
}

/** Scan only beneath the selected directory; Git is invoked only for .git candidates. */
export async function discoverRepositories(root: string, git: Pick<GitServiceContract, 'discover'>, options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { scanned: 0, found: 0, repositories: [], issues: [], cancelled: false };
  const pending = [await realpath(root)];
  const seen = new Set<string>();
  const cancelled = () => !!options.isCancelled?.();
  while (pending.length && !cancelled()) {
    const directory = pending.pop()!;
    result.scanned++;
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      if (cancelled()) break;
      const marker = entries.find(entry => entry.name === '.git');
      let repository = false;
      if (marker) {
        try {
          const repo = await git.discover(directory);
          if (cancelled()) break;
          repository = true;
          if (!seen.has(repo.id)) {
            seen.add(repo.id); result.repositories.push(repo); result.found++;
          }
        } catch (error) {
          // A missing Git executable affects every repository, so fail the operation.
          if ((error as { code?: string }).code === 'GIT_UNAVAILABLE') throw error;
          result.issues.push({ path: directory, message: error instanceof Error ? error.message : String(error) });
        }
      }
      if (!repository) {
        // Dirent.isDirectory excludes symlinks and Windows junctions. Never enter .git.
        const children = entries.filter(entry => entry.isDirectory() && entry.name !== '.git').sort((a, b) => a.name.localeCompare(b.name));
        for (let i = children.length - 1; i >= 0; i--) pending.push(path.join(directory, children[i].name));
      }
    } catch (error) {
      if ((error as { code?: string }).code === 'GIT_UNAVAILABLE') throw error;
      result.issues.push({ path: directory, message: error instanceof Error ? error.message : String(error) });
    }
    options.onProgress?.({ scanned: result.scanned, found: result.found });
  }
  result.cancelled = cancelled();
  return result;
}
