/** Keeps the panel's local copy immediate, and acknowledges serialized host writes. */
export class SessionPersistence<T> {
  private desired?: { value: T; serialized: string };
  private local = '';
  private acknowledged = '';
  private writing = false;
  private failures = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private onError?: (error: Error) => void;

  constructor(private readonly saveLocal: (value: T) => void, private readonly saveHost: (value: T) => Promise<void>) {}

  save(value: T, onError?: (error: Error) => void): void {
    this.onError = onError;
    const serialized = JSON.stringify(value);
    if (serialized === this.local) return;
    // Detach mutable per-repository views from a request already being persisted.
    const copy = JSON.parse(serialized) as T;
    try { this.saveLocal(copy); this.local = serialized; }
    catch (error) { onError?.(error instanceof Error ? error : new Error(String(error))); }
    this.desired = { value: copy, serialized };
    this.failures = 0;
    if (!this.writing) this.schedule(200);
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, delay);
  }

  /** Closing an editor sends its pending draft without waiting for the debounce. */
  flushNow(): void {
    clearTimeout(this.timer);
    void this.flush();
  }

  private async flush(): Promise<void> {
    const next = this.desired;
    if (this.writing || !next || next.serialized === this.acknowledged) return;
    this.writing = true;
    let failed = false;
    try { await this.saveHost(next.value); this.acknowledged = next.serialized; this.failures = 0; }
    catch (error) {
      failed = true;
      if (this.desired === next && ++this.failures > 2) this.onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.writing = false;
      if (this.desired !== next) this.schedule(0);
      else if (failed && this.failures <= 2) this.schedule(500 * this.failures);
    }
  }
}
