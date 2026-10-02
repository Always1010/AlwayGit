import type { Snapshot } from '../protocol/types';

interface Flight { generation: number; raw: Promise<Snapshot>; result: Promise<Snapshot> }
interface Reads { generation: number; query: () => Promise<Snapshot>; pending?: Flight }
class SnapshotCancelledError extends Error {
  readonly code = 'ABORTED';
  constructor() { super('The snapshot request was cancelled.'); }
}

/** Shares only in-flight reads for the exact work directory, never across Worktrees. */
export class SnapshotCoordinator {
  private readonly repositories = new Map<string, Reads>();
  private readonly interrupted = new Set<() => void>();
  private disposed = false;
  invalidate(repoId: string): void {
    const reads = this.repositories.get(repoId);
    if (reads) { reads.generation++; reads.pending = undefined; }
  }
  read(repoId: string, query: () => Promise<Snapshot>): Promise<Snapshot> {
    if (this.disposed) return Promise.reject(new SnapshotCancelledError());
    const reads = this.repositories.get(repoId) ?? { generation: 0, query };
    reads.query = query; this.repositories.set(repoId, reads);
    return (reads.pending ?? this.start(reads)).result;
  }
  private start(reads: Reads): Flight {
    const query = reads.query;
    const flight = { generation: reads.generation } as Flight;
    flight.raw = Promise.resolve().then(() => {
      if (this.disposed || flight.generation !== reads.generation) throw new SnapshotCancelledError();
      return query();
    });
    reads.pending = flight;
    flight.result = this.current(reads, flight);
    void flight.result.finally(() => { if (reads.pending === flight) reads.pending = undefined; }).catch(() => {});
    return flight;
  }
  private async current(reads: Reads, first: Flight): Promise<Snapshot> {
    let interrupt!: () => void;
    const closed = new Promise<never>((_resolve, reject) => { interrupt = () => reject(new SnapshotCancelledError()); });
    this.interrupted.add(interrupt);
    try {
      let flight = first;
      for (;;) {
        if (this.disposed) throw new SnapshotCancelledError();
        try {
          const snapshot = await Promise.race([flight.raw, closed]);
          if (this.disposed) throw new SnapshotCancelledError();
          if (flight.generation === reads.generation) return snapshot;
        } catch (error) {
          if (this.disposed || flight.generation === reads.generation) throw error;
          // An invalidated read's failure is obsolete too; use the current generation instead.
        }
        flight = reads.pending ?? this.start(reads);
      }
    } finally { this.interrupted.delete(interrupt); }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const interrupt of this.interrupted) interrupt();
    this.interrupted.clear(); this.repositories.clear();
  }
}
