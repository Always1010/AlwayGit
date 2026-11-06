import type { GitAction } from '../protocol/types';

interface Operation {
  owner: object;
  id: string;
  repoId: string;
  action?: GitAction;
  controller: AbortController;
}

/** Cancellation bypasses repository write queues and only addresses an exact owned request. */
export class OperationCancellation {
  private readonly operations = new Set<Operation>();

  async run<T>(
    owner: object,
    id: string,
    repoId: string,
    action: GitAction | undefined,
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const operation = { owner, id, repoId, action, controller: new AbortController() };
    this.operations.add(operation);
    const timer = action
      ? undefined
      : setTimeout(() => operation.controller.abort('TIMEOUT'), 180_000);
    try {
      return await task(operation.controller.signal);
    } finally {
      clearTimeout(timer);
      this.operations.delete(operation);
    }
  }

  cancel(owner: object, id: string, repoId: string): boolean {
    const operation = [...this.operations].find(
      (item) => item.owner === owner && item.id === id && item.repoId === repoId,
    );
    if (!operation) return false;
    operation.controller.abort();
    return true;
  }

  list() {
    return [...this.operations];
  }

  dispose(): void {
    for (const operation of this.operations) operation.controller.abort();
  }
}
