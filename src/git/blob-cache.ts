/** Only complete immutable blobs enter this bounded, service-local LRU. */
export class BlobCache {
  private readonly entries = new Map<string, Buffer>();
  private bytes = 0;
  constructor(
    private readonly maxBytes = 32 * 1024 * 1024,
    private readonly maxEntries = 8,
  ) {}
  get(key: string, limit?: number): Buffer | undefined {
    const value = this.entries.get(key);
    if (!value) return;
    this.entries.delete(key);
    this.entries.set(key, value);
    // Consumers may modify returned Buffers. Never expose the retained bytes.
    return Buffer.from(limit === undefined ? value : value.subarray(0, limit));
  }
  remember(key: string, value: Buffer): void {
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.bytes -= previous.length;
    }
    if (value.length > this.maxBytes) return;
    while (
      this.entries.size &&
      (this.bytes + value.length > this.maxBytes || this.entries.size >= this.maxEntries)
    ) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.length;
      this.entries.delete(oldest);
    }
    this.entries.set(key, Buffer.from(value));
    this.bytes += value.length;
  }
}
