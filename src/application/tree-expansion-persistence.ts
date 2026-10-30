import {
  defaultTreeExpansion,
  patchTreeExpansion,
  treeExpansionPreferencesSchema,
  type TreeExpansionPatch,
  type TreeExpansionPreferences,
} from '../protocol/tree-expansion';
import type { LocalCacheClear, LocalCacheEntry } from '../protocol/local-cache';
import { z } from 'zod';

interface LocalMemory {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
  keys?(): readonly string[];
}
interface RepositoryMetadata {
  id: string;
  name: string;
  root: string;
}
interface SavedExpansion {
  preferences: unknown;
  name?: string;
  root?: string;
}
const cacheKeyPrefix = 'alwaygit.treeExpansion';
const hintDismissedKey = 'alwaygit.treeExpansionHintDismissed.v1';
const migrationBlockedKey = 'alwaygit.treeExpansionMigrationBlocked.v1';
const migrationBlockedSchema = z
  .object({ all: z.boolean(), repoIds: z.array(z.string()) })
  .strict();

/** Serializes this extension host's mutations. VS Code Memento has no cross-window CAS;
 * separate repository keys avoid replacing another repository's cache in other windows. */
export class TreeExpansionMemory {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly storage: LocalMemory,
    private readonly legacyStorage?: LocalMemory,
  ) {}
  private key(repoId: string) {
    return `${cacheKeyPrefix}.${encodeURIComponent(repoId)}`;
  }
  private repoId(key: string): string {
    const encoded = key.slice(cacheKeyPrefix.length + 1);
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  private records(storage: LocalMemory): string[] {
    return (storage.keys?.() ?? []).filter((key) => key.startsWith(`${cacheKeyPrefix}.`));
  }
  private migrationBlocked() {
    return migrationBlockedSchema.parse(
      this.storage.get<unknown>(migrationBlockedKey, { all: false, repoIds: [] }),
    );
  }
  private async blockLegacyMigration(request: LocalCacheClear): Promise<void> {
    const previous = this.migrationBlocked();
    const all = previous.all || request.kind === 'all';
    await this.storage.update(migrationBlockedKey, {
      all,
      repoIds: all
        ? []
        : [
            ...new Set([
              ...previous.repoIds,
              ...(request.kind === 'repositories' ? request.repoIds : []),
            ]),
          ],
    });
  }
  private saved(value: unknown): SavedExpansion {
    if (value && typeof value === 'object' && Object.hasOwn(value, 'preferences')) {
      const saved = value as SavedExpansion;
      return {
        preferences: saved.preferences,
        ...(typeof saved.name === 'string' ? { name: saved.name } : {}),
        ...(typeof saved.root === 'string' ? { root: saved.root } : {}),
      };
    }
    return { preferences: value };
  }
  private async migrate(
    repositories: readonly RepositoryMetadata[] = [],
    repoId?: string,
  ): Promise<void> {
    if (!this.legacyStorage) return;
    const blocked = this.migrationBlocked(),
      blockedIds = new Set(blocked.repoIds);
    const keys = new Set(this.records(this.legacyStorage));
    if (repoId !== undefined) keys.add(this.key(repoId));
    for (const key of keys) {
      const old = this.legacyStorage.get<unknown>(key, undefined);
      if (old === undefined) continue;
      if (
        !blocked.all &&
        !blockedIds.has(this.repoId(key)) &&
        this.storage.get<unknown>(key, undefined) === undefined
      ) {
        const repo = repositories.find((repo) => repo.id === this.repoId(key));
        await this.storage.update(key, {
          ...this.saved(old),
          ...(repo ? { name: repo.name, root: repo.root } : {}),
        });
      }
      // Delete only after copying, or after an explicit clear blocked this import.
      // Failed copies/deletions retry without losing the remaining source records.
      await this.legacyStorage.update(key, undefined);
    }
  }
  private readCurrent(repoId: string): TreeExpansionPreferences {
    const raw = this.storage.get<unknown>(this.key(repoId), undefined);
    return raw === undefined
      ? defaultTreeExpansion()
      : treeExpansionPreferencesSchema.parse(this.saved(raw).preferences);
  }
  private async remember(repoId: string, repo?: RepositoryMetadata): Promise<void> {
    if (!repo) return;
    const raw = this.storage.get<unknown>(this.key(repoId), undefined);
    if (raw === undefined) return;
    const saved = this.saved(raw);
    if (saved.name !== repo.name || saved.root !== repo.root)
      await this.storage.update(this.key(repoId), { ...saved, name: repo.name, root: repo.root });
  }
  read(repoId: string, repo?: RepositoryMetadata): Promise<TreeExpansionPreferences> {
    return this.write(async () => {
      await this.migrate(repo ? [repo] : [], repoId);
      const preferences = this.readCurrent(repoId);
      await this.remember(repoId, repo);
      return preferences;
    });
  }
  patch(
    repoId: string,
    patch: TreeExpansionPatch,
    repo?: RepositoryMetadata,
  ): Promise<TreeExpansionPreferences> {
    return this.write(async () => {
      await this.migrate(repo ? [repo] : [], repoId);
      const preferences = patchTreeExpansion(this.readCurrent(repoId), patch);
      const saved = this.saved(this.storage.get<unknown>(this.key(repoId), undefined));
      await this.storage.update(this.key(repoId), {
        ...saved,
        preferences,
        ...(repo ? { name: repo.name, root: repo.root } : {}),
      });
      return preferences;
    });
  }
  reset(repoId: string): Promise<TreeExpansionPreferences> {
    return this.write(async () => {
      await this.migrate([], repoId);
      await this.storage.update(this.key(repoId), undefined);
      return defaultTreeExpansion();
    });
  }
  private async entries(
    repositories: readonly RepositoryMetadata[],
    registrationKnown: boolean,
  ): Promise<LocalCacheEntry[]> {
    const entries: LocalCacheEntry[] = [];
    for (const key of this.records(this.storage)) {
      const raw = this.storage.get<unknown>(key, undefined);
      if (raw === undefined) continue;
      const repoId = this.repoId(key),
        registered = repositories.find((repo) => repo.id === repoId);
      let saved = this.saved(raw);
      if (registered && (saved.name !== registered.name || saved.root !== registered.root)) {
        saved = { ...saved, name: registered.name, root: registered.root };
        await this.storage.update(key, saved);
      }
      const parsed = treeExpansionPreferencesSchema.safeParse(saved.preferences);
      entries.push({
        repoId,
        name: saved.name,
        root: saved.root,
        registered: !!registered,
        ...(!registered && !registrationKnown ? { registrationUnknown: true } : {}),
        directories: parsed.success ? Object.keys(parsed.data.overrides).length : 0,
        mode: parsed.success ? parsed.data.mode : 'auto',
        ...(parsed.success ? {} : { invalid: true }),
      });
    }
    return entries.sort(
      (a, b) =>
        (a.name ?? a.repoId).localeCompare(b.name ?? b.repoId) || a.repoId.localeCompare(b.repoId),
    );
  }
  list(
    repositories: readonly RepositoryMetadata[],
    registrationKnown = true,
  ): Promise<LocalCacheEntry[]> {
    return this.write(async () => {
      await this.migrate(repositories);
      return this.entries(repositories, registrationKnown);
    });
  }
  clear(
    request: LocalCacheClear,
    repositories: readonly RepositoryMetadata[],
    onCleared?: (repoId: string) => void,
    registrationKnown = true,
  ): Promise<LocalCacheEntry[]> {
    return this.write(async () => {
      // Persist before deleting anything, so an unopened workspace cannot later revive its old copy.
      await this.blockLegacyMigration(request);
      await this.migrate(repositories);
      const ids = request.kind === 'repositories' ? new Set(request.repoIds) : undefined;
      for (const key of this.records(this.storage)) {
        const repoId = this.repoId(key);
        if (ids && !ids.has(repoId)) continue;
        await this.storage.update(key, undefined);
        onCleared?.(repoId);
      }
      return this.entries(repositories, registrationKnown);
    });
  }
  hintDismissed(): Promise<boolean> {
    return this.write(async () => this.storage.get<unknown>(hintDismissedKey, false) === true);
  }
  dismissHint(): Promise<true> {
    return this.write(async () => {
      await this.storage.update(hintDismissedKey, true);
      return true as const;
    });
  }
  private write<T>(task: () => Promise<T>): Promise<T> {
    const next = this.pending.catch(() => {}).then(task);
    this.pending = next;
    return next;
  }
}
