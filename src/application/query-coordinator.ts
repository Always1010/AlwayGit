import type { ReadQueryCategory } from '../protocol/queries';

export class QueryCancelledError extends Error {
  readonly code = 'ABORTED';
  constructor() { super('The read request was cancelled.'); }
}
interface Query {
  owner: object;
  category: ReadQueryCategory;
  id: string;
  controller: AbortController;
  operation(signal: AbortSignal): Promise<unknown>;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  started: boolean;
}

/** Replaces each panel's obsolete reads and bounds active tasks until they actually finish. */
export class QueryCoordinator {
  private readonly owners = new Map<object, Map<ReadQueryCategory, Query>>();
  private readonly queue: Query[] = [];
  private active = 0;
  private disposed = false;
  constructor(private readonly limit = 3) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Query concurrency must be positive.');
  }
  run<T>(owner: object, category: ReadQueryCategory, id: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new QueryCancelledError());
    const previous = this.owners.get(owner)?.get(category);
    if (previous) this.cancel(previous);
    return new Promise<T>((resolve, reject) => {
      const query: Query = { owner, category, id, operation, controller: new AbortController(), resolve: value => resolve(value as T), reject, started: false };
      const categories = this.owners.get(owner) ?? new Map<ReadQueryCategory, Query>();
      categories.set(category, query); this.owners.set(owner, categories);
      this.queue.push(query); this.pump();
    });
  }
  cancelOwner(owner: object, id?: string): void {
    for (const query of [...(this.owners.get(owner)?.values() ?? [])]) if (id === undefined || query.id === id) this.cancel(query);
  }
  private forget(query: Query): void {
    const categories = this.owners.get(query.owner);
    if (categories?.get(query.category) !== query) return;
    categories.delete(query.category);
    if (!categories.size) this.owners.delete(query.owner);
  }
  private cancel(query: Query): void {
    query.controller.abort(); query.reject(new QueryCancelledError()); this.forget(query);
    if (!query.started) { const position = this.queue.indexOf(query); if (position >= 0) this.queue.splice(position, 1); }
    // A running task keeps its slot until its runner confirms completion, even after abort.
  }
  private pump(): void {
    while (!this.disposed && this.active < this.limit && this.queue.length) {
      const query = this.queue.shift()!;
      query.started = true; this.active++;
      void Promise.resolve().then(() => {
        if (query.controller.signal.aborted) throw new QueryCancelledError();
        return query.operation(query.controller.signal);
      }).then(value => {
        if (query.controller.signal.aborted) query.reject(new QueryCancelledError()); else query.resolve(value);
      }, async error => {
        query.reject(error);
        const completion = (error as { completion?: Promise<void> } | undefined)?.completion;
        if (completion) await completion.catch(() => {});
      }).finally(() => { this.active--; this.forget(query); this.pump(); });
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const owner of [...this.owners.keys()]) this.cancelOwner(owner);
  }
}
