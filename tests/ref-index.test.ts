import { expect, it } from 'vitest';
import type { GitRef } from '../src/protocol/types';
import { indexRefs } from '../webview/refIndex';

it('indexes a large shared ref list once and preserves all labels on the same commit', () => {
  const refs: GitRef[] = Array.from({ length: 10000 }, (_, i) => ({ name: `branch-${i}`, fullName: `refs/heads/branch-${i}`, kind: 'local', oid: String(i % 100) }));
  const index = indexRefs(refs);
  expect(indexRefs(refs)).toBe(index);
  expect(index.byName.get('refs/heads/branch-9999')).toBe(refs[9999]);
  expect(index.byOid.get('99')).toHaveLength(100);
  expect(index.local).toHaveLength(10000);
  const moved = refs.map((ref, i) => i === 9999 ? { ...ref, oid: 'new' } : ref);
  expect(indexRefs(moved).byOid.get('new')).toEqual([moved[9999]]);
  expect(indexRefs(moved).byOid.get('99')).toHaveLength(99);
  expect(index.byOid.get('99')).toHaveLength(100);
});
