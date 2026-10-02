/** Unknown commands are mutations: cancellation must not weaken write protection. */
export function isReadOnlyGitCommand(args: readonly string[]): boolean {
  if (['status', 'log', 'show', 'ls-tree', 'ls-files', 'for-each-ref', 'rev-parse', 'rev-list', 'cat-file', 'diff', 'diff-tree', 'diff-index', 'merge-base', 'check-ref-format', 'check-attr', 'show-ref'].includes(args[0])) return true;
  if (args[0] === 'config') return ['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--list', '-l'].includes(args[1]);
  if (args[0] === 'remote') return args.length === 1 || args[1] === 'get-url';
  if (args[0] === 'worktree') return args[1] === 'list';
  if (args[0] === 'stash') return ['list', 'show'].includes(args[1]);
  return false;
}
