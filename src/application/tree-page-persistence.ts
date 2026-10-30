import { message, MessageError } from '../i18n';
import { createHash } from 'node:crypto';
import {
  commitTreePanelStateSchema,
  type CommitTreePanelState,
  type CommitTreeTarget,
  type CommitTreeViewState,
} from '../protocol/tree';
import type { LocalCacheClear, LocalCacheEntry } from '../protocol/local-cache';

interface Storage {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
  keys(): readonly string[];
}
interface Repository {
  id: string;
  name: string;
  root: string;
}
interface RecordValue {
  state: CommitTreePanelState;
  updatedAt: number;
  name?: string;
  root?: string;
}
const prefix = 'alwaygit.treePage';
const maxPages = 40,
  maxBytes = 4 * 1024 * 1024;

/** New targets inherit display options from an existing complete page, never its query or coordinates. */
export function inheritedTreeView(view: CommitTreeViewState = {}): CommitTreeViewState {
  const { viewMode, showChanges, changesOnly, wheelMode, previewOpen, previewSplit } = view;
  return { viewMode, showChanges, changesOnly, wheelMode, previewOpen, previewSplit };
}

/** Independent keys avoid replacing other pages across hosts. Memento has no cross-window CAS. */
export class TreePageMemory {
  private pending: Promise<unknown> = Promise.resolve();
  private clock = 0;
  constructor(private readonly storage: Storage) {}
  private key(target: CommitTreeTarget) {
    const hash = createHash('sha256')
      .update(JSON.stringify([target.revision, target.baseRevision]))
      .digest('hex');
    return `${prefix}.${encodeURIComponent(target.repoId)}.${hash}`;
  }
  private records(): { key: string; value: RecordValue; bytes: number }[] {
    return this.storage
      .keys()
      .filter((key) => key.startsWith(`${prefix}.`))
      .flatMap((key) => {
        const raw = this.storage.get<Partial<RecordValue>>(key, {});
        const parsed = commitTreePanelStateSchema.safeParse(raw?.state);
        if (!parsed.success || typeof raw.updatedAt !== 'number') return [];
        const value = { ...raw, state: parsed.data, updatedAt: raw.updatedAt } as RecordValue;
        return [{ key, value, bytes: Buffer.byteLength(JSON.stringify(raw)) }];
      })
      .sort((a, b) => b.value.updatedAt - a.value.updatedAt);
  }
  async read(target: CommitTreeTarget): Promise<CommitTreeViewState | undefined> {
    await this.pending.catch(() => {});
    const raw = this.storage.get<Partial<RecordValue>>(this.key(target), {});
    const parsed = commitTreePanelStateSchema.safeParse(raw?.state);
    if (!parsed.success) return undefined;
    const saved = parsed.data.commitTree;
    if (
      saved.repoId !== target.repoId ||
      saved.revision !== target.revision ||
      saved.baseRevision !== target.baseRevision
    )
      return undefined;
    return parsed.data.view;
  }
  async latest(comparison: boolean): Promise<CommitTreeViewState | undefined> {
    await this.pending.catch(() => {});
    return this.records().find(({ value }) => !!value.state.commitTree.baseRevision === comparison)
      ?.value.state.view;
  }
  save(state: CommitTreePanelState, repo: Repository): Promise<void> {
    // Snapshot before queueing so callers cannot mutate an in-flight write.
    const copy = commitTreePanelStateSchema.parse(JSON.parse(JSON.stringify(state)));
    return this.write(async () => {
      const value = {
        state: copy,
        name: repo.name,
        root: repo.root,
        updatedAt: (this.clock = Math.max(Date.now(), this.clock + 1)),
      };
      const bytes = Buffer.byteLength(JSON.stringify(value));
      if (bytes > maxBytes) throw new MessageError(message('treeViews.cacheBudget'));
      await this.storage.update(this.key(copy.commitTree), value);
      let total = 0;
      for (const [index, record] of this.records().entries()) {
        total += record.bytes;
        if (index >= maxPages || total > maxBytes) await this.storage.update(record.key, undefined);
      }
    });
  }
  async list(
    repositories: readonly Repository[],
    initialized: boolean,
  ): Promise<LocalCacheEntry[]> {
    await this.pending.catch(() => {});
    const entries = new Map<string, LocalCacheEntry>();
    for (const { value } of this.records()) {
      const repoId = value.state.commitTree.repoId,
        repo = repositories.find((repo) => repo.id === repoId);
      const entry = entries.get(repoId) ?? {
        repoId,
        name: repo?.name ?? value.name,
        root: repo?.root ?? value.root,
        registered: !!repo,
        ...(!initialized && !repo ? { registrationUnknown: true } : {}),
        directories: 0,
        mode: 'auto' as const,
        pages: 0,
      };
      entry.pages = (entry.pages ?? 0) + 1;
      entries.set(repoId, entry);
    }
    return [...entries.values()];
  }
  clear(request: LocalCacheClear): Promise<void> {
    return this.write(async () => {
      for (const key of this.storage.keys().filter((key) => key.startsWith(`${prefix}.`))) {
        const repoId = key.slice(prefix.length + 1, key.lastIndexOf('.'));
        if (
          request.kind === 'all' ||
          request.repoIds.some((id) => encodeURIComponent(id) === repoId)
        )
          await this.storage.update(key, undefined);
      }
    });
  }
  private write<T>(task: () => Promise<T>): Promise<T> {
    const next = this.pending.catch(() => {}).then(task);
    this.pending = next;
    return next;
  }
}
