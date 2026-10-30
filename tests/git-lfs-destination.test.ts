import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { git, gitFixtures } from './support/git-fixture';
import { captureLfsDestinations, runBoundLfs, type LfsRun } from '../src/git/lfs-destination';
import { runGitProcess } from '../src/git/runner';
const fixtures = gitFixtures('alwaygit-lfs-destination-');
afterEach(fixtures.cleanup);
let installed = false;
try {
  installed = /^git-lfs\//.test(
    execFileSync('git', ['lfs', 'version'], {
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  );
} catch {
  /* Never install a missing prerequisite. */
}
it.skipIf(!installed)(
  'preserves native SSH, URL rewrites, separate push and .lfsconfig source semantics in frozen commands',
  async () => {
    const { root, repo } = await fixtures.setup();
    await git(root, 'remote', 'add', 'origin', 'git@example.test:repo/project.git');
    let output = '';
    const run: LfsRun = async (args, allowFailure, execution) => {
      const result = await runGitProcess({
        args: ['-C', execution?.root ?? root, ...args],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
          ...execution?.env,
        },
        input: execution?.input,
      });
      if (result.code && !allowFailure) throw new Error(result.stderr.toString('utf8'));
      if (args[0] === 'lfs' && args[1] === 'env') output = result.stdout.toString('utf8');
      return result;
    };
    const endpointLines = (value: string) =>
      value.split(/\r?\n/).filter((line) => /^(Endpoint|  SSH=)/.test(line));
    async function compare() {
      const native = await git(root, 'lfs', 'env'),
        captured = await captureLfsDestinations(repo, run);
      await runBoundLfs(repo, run, 'origin', 'fetch', captured.destinations.origin.fetch, [
        'lfs',
        'env',
      ]);
      expect(endpointLines(output)).toEqual(endpointLines(native));
      return captured;
    }
    await compare();
    expect(output).toContain('SSH=git@example.test:repo/project.git');
    await git(root, 'config', 'remote.origin.url', 'ssh://git@example.test:2222/repo/project.git');
    await compare();
    expect(output).toContain('SSH=git@example.test:/repo/project.git');
    await git(
      root,
      'config',
      'remote.origin.pushurl',
      'ssh://git@push.example.test/repo/project.git',
    );
    const push = await compare();
    let frozenPush = '';
    await runBoundLfs(
      repo,
      async (args, allowFailure, execution) => {
        const result = await run(args, allowFailure, execution);
        if (args[0] === 'config' && args.includes('remote.origin.pushurl'))
          frozenPush = result.stdout.toString('utf8').trim();
        return result;
      },
      'origin',
      'push',
      push.destinations.origin.push,
      ['config', '--get', 'remote.origin.pushurl'],
    );
    expect(frozenPush).toBe('ssh://git@push.example.test/repo/project.git');
    await git(root, 'config', 'remote.origin.url', 'https://alias.example.test/repo.git');
    await git(
      root,
      'config',
      'url.https://actual.example.test/.insteadOf',
      'https://alias.example.test/',
    );
    await compare();
    expect(output).toContain('Endpoint=https://actual.example.test/repo.git/info/lfs');
    await git(root, 'config', 'remote.origin.lfsurl', 'https://remote-lfs.example.test/objects');
    await compare();
    expect(output).toContain('Endpoint=https://remote-lfs.example.test/objects');
    await git(root, 'config', 'lfs.url', 'https://explicit-lfs.example.test/objects');
    await compare();
    expect(output).toContain('Endpoint=https://explicit-lfs.example.test/objects');
    await git(root, 'config', '--unset', 'lfs.url');
    await git(root, 'config', '--unset', 'remote.origin.lfsurl');
    await writeFile(
      path.join(root, '.lfsconfig'),
      '[lfs]\nurl = https://file-lfs.example.test/objects\n',
    );
    await compare();
    expect(output).toContain('Endpoint=https://file-lfs.example.test/objects');
    await git(root, 'add', '.lfsconfig');
    await rm(path.join(root, '.lfsconfig'));
    await compare();
    expect(output).toContain('Endpoint=https://file-lfs.example.test/objects');
    await git(root, 'commit', '-m', 'LFS config');
    await git(root, 'rm', '--cached', '.lfsconfig');
    await compare();
    expect(output).toContain('Endpoint=https://file-lfs.example.test/objects');
  },
  60000,
);
it.skipIf(!installed)(
  'isolates live global and system configuration changes made immediately before spawning the bound command',
  async () => {
    const { root, repo } = await fixtures.setup();
    await git(root, 'remote', 'add', 'origin', 'https://git.example.test/repo.git');
    const global = path.join(root, '.git', 'test-global.config'),
      system = path.join(root, '.git', 'test-system.config');
    await writeFile(global, '[lfs]\nurl = https://reviewed.example.test/objects\n');
    await writeFile(system, '[lfs]\npushurl = https://reviewed-push.example.test/objects\n');
    let output = '';
    const run: LfsRun = async (args, allowFailure, execution) => {
      if (execution?.root && args[0] === 'lfs') {
        await writeFile(global, '[lfs]\nurl = https://changed-global.example.test/objects\n');
        await writeFile(system, '[lfs]\nurl = https://changed-system.example.test/objects\n');
      }
      const result = await runGitProcess({
        args: ['-C', execution?.root ?? root, ...args],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
          GIT_CONFIG_GLOBAL: global,
          GIT_CONFIG_SYSTEM: system,
          GIT_CONFIG_NOSYSTEM: '0',
          ...execution?.env,
        },
        input: execution?.input,
      });
      if (result.code && !allowFailure) throw new Error(result.stderr.toString('utf8'));
      if (execution?.root && args[0] === 'lfs') output = result.stdout.toString('utf8');
      return result;
    };
    const captured = await captureLfsDestinations(repo, run);
    await runBoundLfs(repo, run, 'origin', 'fetch', captured.destinations.origin.fetch, [
      'lfs',
      'env',
    ]);
    expect(output).toContain('Endpoint=https://reviewed.example.test/objects');
    expect(output).not.toContain('changed-global.example.test');
    expect(output).not.toContain('changed-system.example.test');
  },
);
