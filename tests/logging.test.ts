import { it, expect } from 'vitest';
import { redactSecrets } from '../src/application/logging';
it('redacts both token-only and password URLs plus authorization headers', () => {
  expect(redactSecrets("fatal: https://user:secret@example.test/repo.git failed\nhttps://token@example.test/x Authorization: Bearer abcdef"))
    .toBe('fatal: https://***@example.test/repo.git failed\nhttps://***@example.test/x Authorization: Bearer ***');
  expect(redactSecrets('origin/main /repo/path')).toBe('origin/main /repo/path');
});
