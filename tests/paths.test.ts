import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { safeWorkingPath } from '../src/editor/paths';
import { actionSchema, diffSchema, requestSchema } from '../src/protocol/validation';
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
describe('editor file boundary', () => {
  it('allows existing and deleted nested files but rejects absolute and traversal paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'alwaygit-path-')); temporary.push(root);
    await mkdir(path.join(root, 'src')); await writeFile(path.join(root, 'src', 'hello.ts'), 'hello');
    expect(await safeWorkingPath(root, 'src/hello.ts')).toBe(path.join(root, 'src', 'hello.ts'));
    expect(await safeWorkingPath(root, 'src/deleted.ts')).toBe(path.join(root, 'src', 'deleted.ts'));
    await expect(safeWorkingPath(root, '../outside.ts')).rejects.toThrow();
    await expect(safeWorkingPath(root, path.join(root, 'src', 'hello.ts'))).rejects.toThrow();
    await expect(safeWorkingPath(root, 'C:relative')).rejects.toThrow();
  });
  it('rejects symlink ancestors that escape the registered repository', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'alwaygit-path-')); temporary.push(root);
    await mkdir(path.join(root, 'repo')); await mkdir(path.join(root, 'outside'));
    await symlink(path.join(root, 'outside'), path.join(root, 'repo', 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(safeWorkingPath(path.join(root, 'repo'), 'link/file.ts')).rejects.toThrow('outside');
  });
});
describe('webview input validation', () => {
  it('rejects malformed actions, arbitrary commands and excessive inputs', () => {
    expect(actionSchema.safeParse({ type: 'reset', target: 'HEAD', mode: 'hard' }).success).toBe(true);
    expect(actionSchema.safeParse({ type: 'reset', target: 'HEAD', mode: 'invented' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'stage', paths: [] }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'shell', command: 'delete everything' }).success).toBe(false);
    expect(requestSchema.safeParse({ id: '1', method: 'executeCommand' }).success).toBe(false);
    expect(diffSchema.safeParse({ kind: 'change', path: 'file', area: 'conflict' }).success).toBe(true);
  });
});
