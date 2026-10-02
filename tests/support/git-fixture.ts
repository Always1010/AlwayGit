import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GitService } from '../../src/git/service';

const exec = promisify(execFile);

export async function git(root: string, ...args: string[]): Promise<string> {
  const result = await exec('git', ['-C', root, ...args], {
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' },
  });
  return result.stdout.trim();
}

export async function commitFile(root: string, filename: string, content: string | Buffer, message = filename) {
  await writeFile(path.join(root, filename), content);
  await git(root, 'add', '--', filename);
  await git(root, 'commit', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

/** Each suite owns its temporary roots; cleanup never follows an arbitrary path. */
export function gitFixtures(prefix: string, identity = { name: 'Test User', email: 'test@example.com' }) {
  if (!/^alwaygit-[a-z-]+-$/.test(prefix)) throw new Error('Unsafe fixture prefix');
  const roots: string[] = [];
  return {
    async setup() {
      const root = await mkdtemp(path.join(os.tmpdir(), prefix));
      roots.push(root);
      await git(root, 'init', '-b', 'main');
      await git(root, 'config', 'user.name', identity.name);
      await git(root, 'config', 'user.email', identity.email);
      await git(root, 'config', 'commit.gpgsign', 'false');
      const service = new GitService();
      return { root, service, repo: await service.discover(root) };
    },
    async cleanup() {
      for (const root of roots.splice(0)) {
        const absolute = path.resolve(root);
        if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !path.basename(absolute).startsWith(prefix)) {
          throw new Error('Unsafe cleanup target');
        }
        await rm(absolute, { recursive: true, force: true, maxRetries: 5 });
      }
    },
  };
}
