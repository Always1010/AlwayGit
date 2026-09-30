import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GitError, GitService } from '../src/git/service';
import { discoverRepositories } from '../src/repositories/discovery';

vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, readdir: vi.fn(fs.readdir) };
});
const exec = promisify(execFile);
const roots: string[] = [];
const git = async (root: string, ...args: string[]) => exec('git', ['-C', root, ...args], { windowsHide: true });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-discovery-')); roots.push(root); return root;
}
async function repository(root: string, relative: string) {
  const directory = path.join(root, relative); await mkdir(directory, { recursive: true }); await git(directory, 'init', '-b', 'main'); return directory;
}
afterEach(async () => {
  vi.restoreAllMocks(); vi.mocked(readdir).mockClear();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('alwaygit-discovery-')) throw new Error('Unsafe cleanup target');
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

describe('recursive repository discovery', () => {
  it('finds repositories at arbitrary category depths and prunes valid repository contents', async () => {
    const root = await fixture();
    const a = await repository(root, 'A'), b = await repository(root, 'work/B');
    const c = await repository(root, `${Array.from({ length: 12 }, (_, n) => `category${n}`).join('/')}/项目 C`);
    await repository(a, 'node_modules/nested'); await repository(b, 'submodule');
    await mkdir(path.join(root, 'empty/documents'), { recursive: true });
    const service = new GitService(), discover = vi.spyOn(service, 'discover'), onProgress = vi.fn();
    const result = await discoverRepositories(root, service, { onProgress });
    expect(result.repositories.map(r => r.root).sort()).toEqual((await Promise.all([a, b, c].map(p => realpath(p)))).sort());
    expect(result).toMatchObject({ found: 3, cancelled: false, issues: [] });
    expect(discover).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls.at(-1)?.[0]).toEqual({ scanned: result.scanned, found: 3 });
    expect(await discoverRepositories(a, service)).toMatchObject({ scanned: 1, found: 1 });
  });

  it('discovers a .git file Worktree separately from its main repository', async () => {
    const root = await fixture(), main = await repository(root, 'main');
    await git(main, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Initial');
    const worktree = path.join(root, 'category/worktree'); await mkdir(path.dirname(worktree));
    await git(main, 'worktree', 'add', '--detach', worktree);
    const result = await discoverRepositories(root, new GitService());
    expect(result.found).toBe(2); expect(result.issues).toEqual([]);
    expect(result.repositories[0].commonDir).toBe(result.repositories[1].commonDir);
    expect(new Set(result.repositories.map(r => r.id)).size).toBe(2);
  });

  it('skips invalid markers and unreadable directories while continuing other branches', async () => {
    const root = await fixture(), denied = path.join(root, 'denied'), broken = path.join(root, 'broken');
    await mkdir(denied); await mkdir(path.join(broken, '.git'), { recursive: true });
    const healthy = await repository(root, 'healthy'), nested = await repository(broken, 'nested');
    // A damaged marker must neither stop traversal nor expose Git metadata as repositories.
    await repository(broken, '.git/hidden');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(readdir).mockImplementation((async (directory, options) => {
      if (String(directory) === await realpath(denied)) throw Object.assign(new Error('Access denied'), { code: 'EACCES' });
      return actual.readdir(directory, options as { withFileTypes: true });
    }) as typeof readdir);
    try {
      const result = await discoverRepositories(root, new GitService());
      expect(result.found).toBe(2); expect(result.issues.map(issue => issue.path).sort()).toEqual((await Promise.all([broken, denied].map(p => realpath(p)))).sort());
      expect(result.repositories.map(r => r.root).sort()).toEqual((await Promise.all([healthy, nested].map(p => realpath(p)))).sort());
    } finally { vi.mocked(readdir).mockImplementation(actual.readdir); }
  });

  it('does not follow directory links outside the root or junction cycles', async () => {
    const root = await fixture(), outside = await fixture();
    await repository(root, 'inside'); await repository(outside, 'outside');
    await symlink(outside, path.join(root, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
    await symlink(root, path.join(root, 'loop'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(await discoverRepositories(root, new GitService())).toMatchObject({ scanned: 2, found: 1, issues: [] });
  });

  it('reports cancellation after an in-flight discovery and stops visiting siblings', async () => {
    const root = await fixture(); await repository(root, 'A'); await repository(root, 'B');
    const service = new GitService(), original = service.discover.bind(service); let cancelled = false;
    const discover = vi.spyOn(service, 'discover').mockImplementation(async directory => {
      const repo = await original(directory); cancelled = true; return repo;
    });
    expect(await discoverRepositories(root, service, { isCancelled: () => cancelled })).toMatchObject({ cancelled: true, found: 0, repositories: [] });
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it('returns an empty result for ordinary folders, rather than registering their ancestor', async () => {
    const root = await fixture(), main = await repository(root, 'main');
    const folder = path.join(main, 'ordinary'); await mkdir(folder);
    const service = new GitService(), discover = vi.spyOn(service, 'discover');
    expect(await discoverRepositories(folder, service)).toMatchObject({ scanned: 1, found: 0, issues: [], cancelled: false });
    expect(discover).not.toHaveBeenCalled();
  });

  it('fails clearly when Git is unavailable instead of skipping every candidate', async () => {
    const root = await fixture(); await repository(root, 'A');
    await expect(discoverRepositories(root, { discover: async () => { throw new GitError('Cannot run Git', 'GIT_UNAVAILABLE'); } })).rejects.toMatchObject({ code: 'GIT_UNAVAILABLE' });
  });
});
