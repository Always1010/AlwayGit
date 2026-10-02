import type { Snapshot } from '../protocol/types';

/** Shares only in-flight reads for the exact work directory, never across Worktrees. */
export class SnapshotCoordinator {
  private readonly pending = new Map<string, Promise<Snapshot>>();
  invalidate(repoId: string): void { this.pending.delete(repoId); }
  read(repoId: string, query: () => Promise<Snapshot>): Promise<Snapshot> {
    const previous = this.pending.get(repoId);
    if (previous) return previous;
    const next = Promise.resolve().then(query);
    this.pending.set(repoId, next);
    void next.finally(() => { if (this.pending.get(repoId) === next) this.pending.delete(repoId); }).catch(() => {});
    return next;
  }
}
