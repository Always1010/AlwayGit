import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { safeWorkingPath } from '../editor/paths';
import { message } from '../i18n';
import type { Repository } from '../protocol/types';
import { GitError } from './error';

type Run = (args: string[]) => Promise<{ stdout: Buffer }>;

/** A literal Git pathspec still matches descendants; selected files must stay leaves. */
export async function requireExactFileScope(repo: Repository, names: string[], run: Run, head?: string): Promise<void> {
  if (!names.length) return;
  const selected = new Set(names);
  const outputs = await Promise.all([
    run(['ls-files', '-z']),
    head ? run(['ls-tree', '-r', '--name-only', '-z', head]) : Promise.resolve({ stdout: Buffer.alloc(0) }),
  ]);
  const tracked = new Set(outputs.flatMap(output => output.stdout.toString('utf8').split('\0').filter(Boolean)));
  const blocked = (name: string): never => { throw new GitError(message('paths.selectedFileScopeBlocked', { path: name }), 'FILE_SCOPE_CHANGED'); };
  const parents = new Map<string, Promise<string>>();
  const check = async (name: string) => {
    // Updating an ancestor or descendant can evict an unselected Index/HEAD entry.
    const parts = name.split('/');
    for (let index = 1; index < parts.length; index++) {
      const ancestor = parts.slice(0, index).join('/');
      if (tracked.has(ancestor) && !selected.has(ancestor)) blocked(name);
    }
    const parent = path.dirname(name);
    let checkedParent = parents.get(parent);
    if (!checkedParent) {
      checkedParent = safeWorkingPath(repo.root, name, false).then(filename => path.dirname(filename));
      parents.set(parent, checkedParent);
    }
    const filename = path.join(await checkedParent, path.basename(name));
    try {
      const info = await lstat(filename);
      // Git reports an untracked nested repository as a directory ending in '/'.
      // It is an explicitly selected directory, not a former file; git clean protects it.
      if (info.isDirectory() && !name.endsWith('/')) blocked(name);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  };
  const pending = [...selected];
  for (let offset = 0; offset < pending.length; offset += 32) await Promise.all(pending.slice(offset, offset + 32).map(check));
  // Walk tracked ancestors instead of comparing every selected path with every tracked path.
  for (const name of tracked) {
    if (selected.has(name)) continue;
    const parts = name.split('/');
    for (let index = 1; index < parts.length; index++) if (selected.has(parts.slice(0, index).join('/'))) blocked(parts.slice(0, index).join('/'));
  }
}
