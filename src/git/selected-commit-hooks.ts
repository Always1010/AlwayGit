import { chmod, mkdtemp, readdir, rm, stat, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { translate } from '../i18n';
import type { GitResult } from './runner';
import type { StashExecution } from './stash';

const shellQuote = (value: string) => "'" + (process.platform === 'win32' ? value.replace(/\\/g, '/') : value).replace(/'/g, "'\"'\"'") + "'";

/** Delegate existing hooks, then validate the candidate tree before Git publishes HEAD. */
export async function selectedCommitHooks(run: (args: string[], execution?: StashExecution) => Promise<GitResult>, indexPath: string, head: string | undefined, paths: string[], executable: string) {
  const original = (await run(['rev-parse', '--path-format=absolute', '--git-path', 'hooks'])).stdout.toString('utf8').trim();
  const reference = (await run(['symbolic-ref', '-q', 'HEAD'], { allowFailure: true })).stdout.toString('utf8').trim() || 'HEAD';
  const parent = path.dirname(indexPath);
  const directory = await mkdtemp(path.join(parent, 'alwaygit-selected-hooks-'));
  const cleanup = async () => {
    if (path.dirname(path.resolve(directory)) !== path.resolve(parent)) throw new Error(translate('en', 'service.filePathsMustStayInsideTheRepository'));
    await rm(directory, { recursive: true, force: true });
  };
  const rejected = path.join(directory, 'scope-rejected');
  try {
    let names: string[];
    try { names = await readdir(original); }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      names = [];
    }
    for (const name of names.filter(name => /^[a-z][a-z0-9-]*$/.test(name) && name !== 'reference-transaction')) {
      const source = path.join(original, name), info = await stat(source);
      if (!info.isFile() || process.platform !== 'win32' && !(info.mode & 0o111)) continue;
      const target = path.join(directory, name);
      await writeFile(target, '#!/bin/sh\nexec ' + shellQuote(source) + ' "$@"\n');
      await chmod(target, 0o755);
    }
    const manifest = path.join(directory, 'paths');
    await writeFile(manifest, Buffer.from(paths.length ? paths.join('\0') + '\0' : '', 'utf8'));
    const project = 'GIT_INDEX_FILE=' + shellQuote(path.join(directory, 'projection.index')) + ' ' + shellQuote(executable) + ' -c core.hooksPath=/dev/null --literal-pathspecs ';
    const referenceHook = shellQuote(path.join(original, 'reference-transaction'));
    const hook = path.join(directory, 'reference-transaction');
    await writeFile(hook, [
      '#!/bin/sh',
      'if [ "$1" != prepared ]; then',
      '  if [ -x ' + referenceHook + ' ]; then exec ' + referenceHook + ' "$@"; fi',
      '  exit 0',
      'fi',
      'task_refs=$(cat) || exit 1',
      'if [ -x ' + referenceHook + ' ]; then',
      '  printf "%s\\n" "$task_refs" | ' + referenceHook + ' "$@" || exit $?',
      'fi',
      'task_seen=',
      'printf "%s\\n" "$task_refs" | while read -r task_old task_new task_ref; do',
      // Both symbolic HEAD and its resolved branch can appear in a transaction.
      '  [ "$task_ref" = HEAD ] || [ "$task_ref" = ' + shellQuote(reference) + ' ] || continue',
      '  case "$task_new" in ""|*[!0-9a-f]*) continue ;; esac',
      '  [ "$task_new" = "$task_seen" ] && continue',
      '  task_seen=$task_new',
      '  ' + project + (head ? 'read-tree ' + shellQuote(head) : 'read-tree --empty') + ' || exit 1',
      ...(paths.length ? ['  ' + project + 'reset -q "$task_new" --pathspec-from-file=' + shellQuote(manifest) + ' --pathspec-file-nul || exit 1'] : []),
      '  task_projected=$(' + project + 'write-tree) || exit 1',
      '  task_actual=$(' + project + 'rev-parse "$task_new^{tree}") || exit 1',
      '  if [ "$task_projected" != "$task_actual" ]; then',
      '    : > ' + shellQuote(rejected),
      '    printf "%s\\n" ' + shellQuote(translate('en', 'commit.hookScopeChanged')) + ' >&2',
      '    exit 1',
      '  fi',
      'done',
      '',
    ].join('\n'));
    await chmod(hook, 0o755);
    return { directory, cleanup, async rejected() {
      try { await access(rejected); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    } };
  } catch (error) { await cleanup(); throw error; }
}
