import type { SessionState } from '../protocol/session';

/** One host writer orders panel baselines; a failed write never poisons later saves. */
export class SessionWriter {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly write: (session: SessionState) => PromiseLike<void>) {}
  save(session: SessionState): Promise<void> {
    const next = this.pending.catch(() => {}).then(() => this.write(session));
    this.pending = next;
    return next;
  }
}
