import { create } from 'zustand';
import type { Repository } from '../src/protocol/types';
import { groupRepositories, repositoryGroupKey } from '../src/protocol/repositories';
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
  refreshing: boolean;
  taskId?: string;
}>(() => ({ entries: [], running: false, refreshing: false }));

let sequence = 0;

/** One bounded batch per workbench; shared Git storage is fetched only once. */
export async function fetchRepositories(repositories: Repository[]): Promise<void> {
  if (useRepositoryFetch.getState().running) return;
  const targets = groupRepositories(repositories, useWorkbench.getState().repoId).map(
    (group) => group.repository,
  );
  if (!targets.length) return;
  const configured = useWorkbench.getState().operationSettings.batchFetchConcurrency ?? 4;
  const concurrency =
    Number.isInteger(configured) && configured >= 1 && configured <= 8 ? configured : 4;
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
  useRepositoryFetch.setState({ entries, running: true, refreshing: false, taskId });
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
      Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
        while (!stopped && next < entries.length) {
          const entry = entries[next++];
          entry.status = 'running';
          publish();
          let requestId: string | undefined;
          try {
            await rpc(
              'action',
              entry.repository.id,
              { type: 'fetch', deferRefresh: true },
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
    operationTasks.remove(taskId);
    useRepositoryFetch.setState({ refreshing: true, taskId: undefined });
    const state = useWorkbench.getState();
    const affected = new Set(
      entries
        .filter((entry) => entry.status !== 'skipped')
        .map((entry) => repositoryGroupKey(entry.repository)),
    );
    const active = state.repositories.find((repository) => repository.id === state.repoId);
    if (active && affected.has(repositoryGroupKey(active)))
      await state.refresh({ background: true });
    const currentRepositories = useWorkbench.getState().repositories;
    const repositoryIds = currentRepositories
      .filter((repository) => affected.has(repositoryGroupKey(repository)))
      .map((repository) => repository.id);
    if (repositoryIds.length) await useWorkbench.getState().loadRepositoryStatuses(repositoryIds);
  } finally {
    operationTasks.remove(taskId);
    useRepositoryFetch.setState({ running: false, refreshing: false, taskId: undefined });
  }
}
