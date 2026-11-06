import type { GitAction } from '../src/protocol/types';

export interface OperationTask {
  id: string;
  repoId: string;
  action?: GitAction;
  stopping: boolean;
  cancel?(): void;
}

let tasks: OperationTask[] = [];
let confirmation: string[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
export const operationTasks = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot: () => tasks,
  confirmation: () => confirmation,
  add(task: OperationTask) {
    tasks = [...tasks, task];
    emit();
  },
  remove(id: string) {
    if (!tasks.some((task) => task.id === id)) return;
    tasks = tasks.filter((task) => task.id !== id);
    confirmation = confirmation.filter((selected) => selected !== id);
    emit();
  },
  confirm(ids: string[]) {
    confirmation = ids;
    emit();
  },
  stopping(id: string) {
    tasks = tasks.map((task) => (task.id === id ? { ...task, stopping: true } : task));
    emit();
  },
  retry(id: string) {
    if (!tasks.some((task) => task.id === id)) return;
    tasks = tasks.map((task) => (task.id === id ? { ...task, stopping: false } : task));
    emit();
  },
};
