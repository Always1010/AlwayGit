import path from 'node:path';
import { realpath } from 'node:fs/promises';
/** Validate both lexical containment and existing symlink ancestors. */
export async function safeWorkingPath(root: string, relative: string, followLeaf = true): Promise<string> {
  if (!relative || relative.includes('\0') || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) throw new Error('Invalid repository-relative file path.');
  const candidate = path.resolve(root, relative);
  const relation = path.relative(root, candidate);
  if (!relation || relation.startsWith(`..${path.sep}`) || relation === '..' || path.isAbsolute(relation)) throw new Error('File path is outside the repository.');
  const canonicalRoot = await realpath(root);
  let probe = followLeaf ? candidate : path.dirname(candidate);
  while (probe !== path.dirname(probe)) {
    try {
      const resolved = await realpath(probe);
      const resolvedRelation = path.relative(canonicalRoot, resolved);
      if (resolvedRelation === '..' || resolvedRelation.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedRelation)) throw new Error('File resolves outside the repository.');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      probe = path.dirname(probe);
    }
  }
  return candidate;
}
