import { it, expect } from 'vitest';
import { redactSecrets, requestErrorText, serializeRequestError } from '../src/application/logging';
it('redacts both token-only and password URLs plus authorization headers', () => {
  expect(redactSecrets("fatal: https://user:secret@example.test/repo.git failed\nhttps://token@example.test/x Authorization: Bearer abcdef"))
    .toBe('fatal: https://***@example.test/repo.git failed\nhttps://***@example.test/x Authorization: Bearer ***');
  expect(redactSecrets('origin/main /repo/path')).toBe('origin/main /repo/path');
});

it('keeps underlying Stash diagnostics in both the response and log while hiding credentials', () => {
  const raw = 'error: staged-only.txt would be overwritten\nIndex was not unstashed.\nhttps://user:secret@example.test/repo Authorization: Bearer private-token';
  const details = { kind: 'stash-apply' as const, reason: 'restore-blocked' as const, paths: ['notes.txt'], conflictPaths: [], selector: 'stash@{1}', stashOid: 'saved', stashRetained: true as const, workingTreeUnchanged: true as const, output: raw };
  const response = serializeRequestError(Object.assign(new Error('Stash retained; working state unchanged.'), { code: 'STASH_RESTORE_BLOCKED', details }));
  expect(response).toMatchObject({ message: 'Stash retained; working state unchanged.', code: 'STASH_RESTORE_BLOCKED', details: { output: redactSecrets(raw), paths: ['notes.txt'], conflictPaths: [] } });
  expect(requestErrorText(response)).toBe(`${response.message}\n${redactSecrets(raw)}`);
  expect(requestErrorText(response)).not.toContain('secret'); expect(requestErrorText(response)).not.toContain('private-token');
  expect(details.output).toBe(raw);
});
