import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WindowBridge, canonicalPath, windowMatch, projectRequestSchema, type ProjectRequest } from '../src/application/window-bridge';

const directories: string[] = [], bridges: WindowBridge[] = [];
afterEach(async () => {
  await Promise.all(bridges.splice(0).map(bridge => bridge.close()));
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('alwaygit-window-test-')) throw new Error('Unsafe test cleanup target');
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'alwaygit-window-test-')); directories.push(directory);
  const root = path.join(directory, 'project'), other = path.join(directory, 'other');
  await Promise.all([mkdir(root), mkdir(other)]);
  return { directory, root, other, registry: path.join(directory, 'registry') };
}
async function start(registry: string, roots: string[], execute: (request: ProjectRequest) => Promise<void> = async () => {}) {
  const bridge = new WindowBridge(registry, execute); bridges.push(bridge); await bridge.start(roots); return bridge;
}
describe('Project window routing', () => {
  it('validates file/diff targets and rejects arbitrary commands at the IPC boundary', async () => {
    const { root } = await setup();
    expect(projectRequestSchema.safeParse({ root, action: 'file', path: 'sample.ts' }).success).toBe(true);
    expect(projectRequestSchema.safeParse({ root, action: 'diff', target: { kind: 'change', path: 'sample.ts', area: 'staged' } }).success).toBe(true);
    expect(projectRequestSchema.safeParse({ root, action: 'workbench' }).success).toBe(true);
    expect(projectRequestSchema.safeParse({ root, action: 'file', path: '../outside.ts' }).success).toBe(false);
    expect(projectRequestSchema.safeParse({ root, action: 'command', command: 'workbench.action.closeWindow' }).success).toBe(false);
    expect(projectRequestSchema.safeParse({ root, action: 'diff', target: { kind: 'change', path: 'sample.ts', area: 'invalid' } }).success).toBe(false);
  });
  it('delivers only to the project workspace, not a different active window', async () => {
    const { registry, root, other } = await setup(), received: ProjectRequest[] = [];
    const source = await start(registry, [other]), target = await start(registry, [root], async request => { received.push(request); });
    await source.update([other], true);
    const candidates = await source.candidates(root);
    expect(candidates.map(window => window.id)).toEqual([target.record.id]);
    await WindowBridge.send(candidates[0], { root, action: 'project' });
    await WindowBridge.send(candidates[0], { root, action: 'workbench' });
    expect(received).toEqual([{ root: await canonicalPath(root), action: 'project' }, { root: await canonicalPath(root), action: 'workbench' }]);
  });
  it('prefers an exact project root over a parent and supports multi-root workspaces', async () => {
    const { registry, directory, root, other } = await setup();
    const parent = await start(registry, [directory]), exact = await start(registry, [other, root]);
    await parent.update([directory], true);
    expect((await parent.candidates(root)).map(window => window.id)).toEqual([exact.record.id, parent.record.id]);
  });
  it('does not confuse sibling worktrees or common path prefixes', async () => {
    const { registry, root, other } = await setup();
    const bridge = await start(registry, [root]);
    expect(await bridge.candidates(other)).toEqual([]);
    expect(windowMatch(bridge.record, await canonicalPath(root) + '-worktree')).toBe(-1);
  });
  it('uses recent focus to choose between two windows for the same project', async () => {
    const { registry, root } = await setup();
    const first = await start(registry, [root]), second = await start(registry, [root]);
    await first.update([root], true);
    expect((await second.candidates(root))[0].id).toBe(first.record.id);
  });
  it('rejects unauthorized requests without executing them', async () => {
    const { registry, root } = await setup(); let calls = 0;
    const bridge = await start(registry, [root], async () => { calls++; });
    await expect(WindowBridge.send({ ...bridge.record, token: '0'.repeat(64) }, { root, action: 'project' }, 300)).rejects.toThrow();
    expect(calls).toBe(0);
  });
  it('rechecks workspace membership when a registered window changes project', async () => {
    const { registry, root, other } = await setup(); let calls = 0;
    const bridge = await start(registry, [root], async () => { calls++; });
    await bridge.update([other], false);
    await expect(WindowBridge.send(bridge.record, { root, action: 'project' })).rejects.toThrow('no longer open');
    expect(calls).toBe(0);
  });
  it('propagates execution failure instead of reporting a successful open', async () => {
    const { registry, root } = await setup();
    const bridge = await start(registry, [root], async () => { throw new Error('Workspace is untrusted'); });
    await expect(WindowBridge.send(bridge.record, { root, action: 'project' })).rejects.toThrow('untrusted');
  });
  it('ignores corrupt and expired registry files and cleans up its own endpoint', async () => {
    const { registry, root } = await setup();
    const bridge = await start(registry, [root]);
    await writeFile(path.join(registry, 'a'.repeat(32) + '.json'), '{bad');
    await writeFile(path.join(registry, 'b'.repeat(32) + '.json'), JSON.stringify({ ...bridge.record, id: 'b'.repeat(32), updatedAt: 0 }));
    expect((await bridge.candidates(root)).map(window => window.id)).toEqual([bridge.record.id]);
    await bridge.close();
    expect(await readdir(registry)).not.toContain(bridge.record.id + '.json');
    await expect(WindowBridge.send(bridge.record, undefined, 300)).rejects.toThrow('unavailable');
  });
  it('isolates different VS Code user data/profile registries', async () => {
    const { registry, directory, root } = await setup();
    const first = await start(registry, [root]), second = await start(path.join(directory, 'another-profile'), [root]);
    expect((await first.candidates(root)).map(window => window.id)).toEqual([first.record.id]);
    expect((await second.candidates(root)).map(window => window.id)).toEqual([second.record.id]);
  });
});
