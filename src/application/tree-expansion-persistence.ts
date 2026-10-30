import { defaultTreeExpansion, patchTreeExpansion, treeExpansionPreferencesSchema, type TreeExpansionPatch, type TreeExpansionPreferences } from '../protocol/tree-expansion';

interface WorkspaceMemory { get<T>(key: string, fallback: T): T; update(key: string, value: unknown): PromiseLike<void> }
/** A single host queue merges each panel's path patch with the latest stored preferences. */
export class TreeExpansionMemory {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: WorkspaceMemory) {}
  private key(repoId: string) { return `alwaygit.treeExpansion.${encodeURIComponent(repoId)}`; }
  private readCurrent(repoId: string): TreeExpansionPreferences {
    return treeExpansionPreferencesSchema.parse(this.storage.get(this.key(repoId), defaultTreeExpansion()));
  }
  async read(repoId: string): Promise<TreeExpansionPreferences> {
    await this.pending.catch(() => {});
    return this.readCurrent(repoId);
  }
  patch(repoId: string, patch: TreeExpansionPatch): Promise<TreeExpansionPreferences> {
    return this.write(async () => {
      const preferences = patchTreeExpansion(this.readCurrent(repoId), patch);
      await this.storage.update(this.key(repoId), preferences);
      return preferences;
    });
  }
  reset(repoId: string): Promise<TreeExpansionPreferences> {
    return this.write(async () => { await this.storage.update(this.key(repoId), undefined); return defaultTreeExpansion(); });
  }
  private write(task: () => Promise<TreeExpansionPreferences>): Promise<TreeExpansionPreferences> {
    const next = this.pending.catch(() => {}).then(task);
    this.pending = next;
    return next;
  }
}
