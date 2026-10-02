import type { SessionState } from '../protocol/session';

function changedEntries<T>(current: Record<string, T> = {}, next: Record<string, T> = {}, baseline: Record<string, T> = {}): Record<string, T> {
  const result = { ...current };
  for (const key of new Set([...Object.keys(next), ...Object.keys(baseline)])) {
    if (JSON.stringify(next[key]) === JSON.stringify(baseline[key])) continue;
    if (Object.hasOwn(next, key)) result[key] = next[key]; else delete result[key];
  }
  return result;
}

/** Apply only this panel's changes; activating an old panel must not roll back another panel's drafts. */
export function mergeSessionBaseline(current: SessionState, next: SessionState, panelBaseline?: SessionState, blank = false): SessionState {
  if (!panelBaseline) return next;
  if (blank && !next.repoId) return { ...next, repoId: current.repoId, drafts: current.drafts, views: current.views };
  return { ...next, drafts: changedEntries(current.drafts, next.drafts, panelBaseline.drafts), views: changedEntries(current.views, next.views, panelBaseline.views) };
}

/** One host writer orders panel baselines; a failed write never poisons later saves. */
export class SessionWriter {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly write: (session: SessionState) => PromiseLike<void>) {}
  save(session: SessionState | (() => SessionState)): Promise<void> {
    const next = this.pending.catch(() => {}).then(() => this.write(typeof session === 'function' ? session() : session));
    this.pending = next;
    return next;
  }
}
