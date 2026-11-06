import { create } from 'zustand';
import type { Repository } from '../src/protocol/types';
import { groupRepositories } from '../src/protocol/repositories';
import { rpc } from './rpc';
import { operationTasks } from './operationTasks';
import { useWorkbench } from './store';

export interface RepositoryFetchEntry {
  repository: Repository;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  error?: string;
}

export const useRepositoryFetch = create<{
  entries: RepositoryFetchEntry[];
  running: boolean;
  taskId?: string;
}>(() => ({ entries: [], running: false }));

let sequence = 0;

/** One bounded batch per workbench; shared Git storage is fetched only once. */
export async function fetchRepositories(repositories: Repository[]): Promise<void> {
  if (useRepositoryFetch.getState().running) return;
  const targets = groupRepositories(repositories, useWorkbench.getState().repoId).map(
    (group) => group.repository,
  );
  if (!targets.length) return;
  const taskId = `repository-fetch-${++sequence}`;
  const entries: RepositoryFetchEntry[] = targets.map((repository) => ({
    repository,
    status: 'pending',
  }));
  let next = 0;
  let stopped = false;
  const requests = new Map<string, string>();
  const publish = () =>
    useRepositoryFetch.setState({ entries: entries.map((entry) => ({ ...entry })) });
  useRepositoryFetch.setState({ entries, running: true, taskId });
  operationTasks.add({
    id: taskId,
    repoId: targets[0].id,
    action: { type: 'fetch' },
    stopping: false,
    async cancel() {
      stopped = true;
      for (const entry of entries) {
        if (entry.status === 'pending') entry.status = 'skipped';
      }
      publish();
      await Promise.all(
        [...requests].map(([requestId, repoId]) => rpc('cancelOperation', repoId, { requestId })),
      );
    },
  });
  try {
    await Promise.all(
      Array.from({ length: Math.min(4, targets.length) }, async () => {
        while (!stopped && next < entries.length) {
          const entry = entries[next++];
          entry.status = 'running';
          publish();
          let requestId: string | undefined;
          try {
            await rpc(
              'action',
              entry.repository.id,
              { type: 'fetch' },
              {
                onRequestId(id) {
                  requestId = id;
                  requests.set(id, entry.repository.id);
                },
              },
            );
            entry.status = 'success';
          } catch (error) {
            entry.status = 'error';
            entry.error = error instanceof Error ? error.message : String(error);
          } finally {
            if (requestId) requests.delete(requestId);
            publish();
          }
        }
      }),
    );
    const state = useWorkbench.getState();
    const active = state.repositories.find((repository) => repository.id === state.repoId);
    if (active && groupRepositories([...targets, active]).length === targets.length)
      await state.refresh({ background: true });
    await useWorkbench.getState().loadRepositoryStatuses();
  } finally {
    operationTasks.remove(taskId);
    useRepositoryFetch.setState({ running: false, taskId: undefined });
  }
}
