import { it, expect } from 'vitest';
import { redactSecrets, requestErrorText, serializeRequestError, SecretRedactor } from '../src/application/logging';
import { parsePushResult } from '../src/git/push-result';
it('redacts both token-only and password URLs plus authorization headers', () => {
  expect(redactSecrets("fatal: https://user:secret@example.test/repo.git failed\nhttps://token@example.test/x Authorization: Bearer abcdef"))
    .toBe('fatal: https://***@example.test/repo.git failed\nhttps://***@example.test/x Authorization: Bearer ***');
  expect(redactSecrets('origin/main /repo/path')).toBe('origin/main /repo/path');
});

it('redacts URL authentication queries including encoded keys while preserving ordinary parameters', () => {
  const value = 'https://user:private@example.test/repo?access_token=first&api_key=second&client_secret=third&access%5Ftoken=fourth&branch=main#section';
  expect(redactSecrets(value)).toBe('https://***@example.test/repo?access_token=***&api_key=***&client_secret=***&access%5Ftoken=***&branch=main#section');
  const pushResult = parsePushResult(`To http://example.test/repo?token=fifth\n*\trefs/tags/v1:refs/tags/v1\t[new tag]`, value, 1);
  const response = serializeRequestError(Object.assign(new Error(value), { pushResult }));
  for (const secret of ['private', 'first', 'second', 'third', 'fourth', 'fifth']) expect(JSON.stringify(response)).not.toContain(secret);
});

it('sanitizes every possible stderr chunk boundary and drains an incomplete final line', () => {
  const raw = Buffer.from('中文 https://user:private@example.test/r?access_token=query-secret\rAuthorization: Bearer header-secret\nhttps://token@example.test/final');
  for (let boundary = 1; boundary < raw.length; boundary++) {
    const output: string[] = [], stream = new SecretRedactor(text => output.push(text));
    stream.write(raw.subarray(0, boundary)); stream.write(raw.subarray(boundary)); stream.end(); stream.end();
    expect(output.join('')).toBe(redactSecrets(raw.toString('utf8')));
  }
  const output: string[] = [], stream = new SecretRedactor(text => output.push(text));
  stream.write(Buffer.from('https://user:')); expect(output).toEqual([]);
  stream.write(Buffer.from('private@example.test/')); stream.end();
  expect(output.join('')).toBe('https://***@example.test/');
  const bounded: string[] = [], large = new SecretRedactor(text => bounded.push(text));
  large.write(Buffer.from('x'.repeat(65537) + 'https://user:private@example.test/')); large.end();
  expect(bounded.join('')).toBe('***');
});

it('preserves partial Push metadata through the error response without leaking URL credentials', () => {
  const pushResult=parsePushResult('To https://user:secret@github.com/acme/repo.git\n*\trefs/heads/main:refs/heads/topic\t[new branch]', 'Authorization: Bearer private-token', 1);
  const response=serializeRequestError(Object.assign(new Error('partial Push'),{code:'PARTIAL_FAILURE',pushResult}));
  expect(response.pushResult?.outcome).toBe('partial');
  expect(response.pushResult?.destinations[0].refs[0].url).toBe('https://github.com/acme/repo/tree/topic');
  expect(JSON.stringify(response)).not.toContain('secret');expect(JSON.stringify(response)).not.toContain('private-token');
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
