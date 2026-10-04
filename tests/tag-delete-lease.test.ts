import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/protocol/types';
import { captureTagDeleteLease, completeTagDeleteLease, tagDeleteLeaseProblem, updateTagDeleteLease } from '../webview/tagDeleteLease';
import { tagQueryKey, type TagQuery } from '../webview/tagStatus';

const original: Snapshot = { repository: { id: 'repo', root: '/repo', commonDir: '/repo/.git', name: 'repo' }, branch: 'main', ahead: 0, behind: 0,
  changes: [], refs: [], remotes: ['origin', 'upstream'], remoteDestinations: { origin: 'push-original', upstream: 'push-upstream' },
  remoteReadDestinations: { origin: 'read-original', upstream: 'read-upstream' }, stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 1 };
function queries(snapshot = original, oid = 'original-oid', remote = 'origin'): Record<string, TagQuery> {
  return { [tagQueryKey(snapshot, remote)]: { loading: false, attemptedAt: 1, result: { remote, destination: snapshot.remoteReadDestinations![remote], separatePush: false,
    refs: { 'refs/tags/v1': oid, 'refs/tags/v2': 'second-oid' }, checkedAt: 1 } } };
}

describe('remote tag deletion confirmation', () => {
  it('keeps the dialog destination and OID when newer snapshot and query results arrive', () => {
    const newer = { ...original, remoteDestinations: { ...original.remoteDestinations, origin: 'push-new' } };
    const lease = captureTagDeleteLease(newer, queries(newer, 'new-oid'), 'origin', 'v1', { expectedDestination: 'push-original', expectedRemoteOid: 'original-oid' });
    expect(lease).toMatchObject({ expectedDestination: 'push-original', expectedRemoteOid: 'original-oid' });
    expect(tagDeleteLeaseProblem(lease, newer, queries(newer, 'new-oid'), 'origin', 'v1')).toBe('changed');
    const originalLease = captureTagDeleteLease(original, queries(), 'origin', 'v1');
    expect(completeTagDeleteLease(originalLease, original, queries(original, 'new-oid'))).toBe(originalLease);
    expect(tagDeleteLeaseProblem(originalLease, original, queries(original, 'new-oid'), 'origin', 'v1')).toBe('changed');
  });

  it('rejects changed read addresses and results from a different address or remote', () => {
    const lease = captureTagDeleteLease(original, queries(), 'origin', 'v1');
    const changedRead = { ...original, remoteReadDestinations: { ...original.remoteReadDestinations, origin: 'read-new' } };
    expect(tagDeleteLeaseProblem(lease, changedRead, queries(changedRead), 'origin', 'v1')).toBe('changed');
    for (const mismatch of [{ destination: 'read-other' }, { remote: 'upstream' }]) {
      const mismatched = queries();
      Object.assign(mismatched[tagQueryKey(original, 'origin')].result!, mismatch);
      expect(tagDeleteLeaseProblem(lease, original, mismatched, 'origin', 'v1')).toBe('changed');
    }
    const separate = queries();
    separate[tagQueryKey(original, 'origin')].result!.separatePush = true;
    expect(tagDeleteLeaseProblem(lease, original, separate, 'origin', 'v1')).toBe('separate');
  });

  it('only a different normalized selected tag or remote captures a new confirmation', () => {
    const lease = captureTagDeleteLease(original, queries(), 'origin', 'v1');
    const refreshed = queries(original, 'new-oid');
    expect(updateTagDeleteLease(lease, original, refreshed, ' origin ', 'v1 ')).toBe(lease);
    expect(updateTagDeleteLease(lease, original, refreshed, 'origin', 'v2')).toMatchObject({ name: 'v2', expectedRemoteOid: 'second-oid' });
    expect(updateTagDeleteLease(lease, original, queries(original, 'upstream-oid', 'upstream'), 'upstream', 'v1'))
      .toMatchObject({ remote: 'upstream', expectedRemoteOid: 'upstream-oid', expectedDestination: 'push-upstream' });
  });

  it('accepts the first check for an unchecked target but never advances it on a recheck', () => {
    const unchecked = captureTagDeleteLease(original, {}, 'origin', 'v1');
    expect(tagDeleteLeaseProblem(unchecked, original, {}, 'origin', 'v1')).toBe('unchecked');
    const checked = completeTagDeleteLease(unchecked, original, queries());
    expect(tagDeleteLeaseProblem(checked, original, queries(), 'origin', 'v1')).toBeUndefined();
    expect(completeTagDeleteLease(checked, original, queries(original, 'new-oid'))).toBe(checked);
    const absent = queries();
    delete absent[tagQueryKey(original, 'origin')].result!.refs['refs/tags/v1'];
    const checkedAbsent = completeTagDeleteLease(unchecked, original, absent);
    expect(completeTagDeleteLease(checkedAbsent, original, queries())).toBe(checkedAbsent);
    expect(tagDeleteLeaseProblem(checkedAbsent, original, queries(), 'origin', 'v1')).toBe('unchecked');
  });
});
