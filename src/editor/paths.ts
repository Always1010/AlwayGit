import { message as localizeMessage, MessageError } from '../i18n/index';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
/** Validate both lexical containment and existing symlink ancestors. */
export async function safeWorkingPath(root: string, relative: string, followLeaf = true): Promise<string> {
  if (!relative || relative.includes('\0') || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) throw new MessageError(localizeMessage("paths.invalidRepositoryRelativeFilePath"));
  const candidate = path.resolve(root, relative);
  const relation = path.relative(root, candidate);
  if (!relation || relation.startsWith(`..${path.sep}`) || relation === '..' || path.isAbsolute(relation)) throw new MessageError(localizeMessage("paths.filePathIsOutsideTheRepository"));
  const canonicalRoot = await realpath(root);
  let probe = followLeaf ? candidate : path.dirname(candidate);
  while (probe !== path.dirname(probe)) {
    try {
      const resolved = await realpath(probe);
      const resolvedRelation = path.relative(canonicalRoot, resolved);
      if (resolvedRelation === '..' || resolvedRelation.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedRelation)) throw new MessageError(localizeMessage("paths.fileResolvesOutsideTheRepository"));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      probe = path.dirname(probe);
    }
  }
  return candidate;
}
