/** Unknown commands are mutations: cancellation must not weaken write protection. */
export function isReadOnlyGitCommand(args: readonly string[]): boolean {
  if (args[0] === 'symbolic-ref') return args.length === 4 && args[1] === '--quiet' && args[2] === '--short' && args[3] === 'HEAD';
  if (args[0] === 'lfs') return ['version', 'env', 'ls-files', 'status'].includes(args[1]);
  if (args[0] === 'reflog') return args[1] === 'show' || args[1] === 'exists';
  if (args[0] === 'ls-remote') return true;
  if (['status', 'log', 'show', 'ls-tree', 'ls-files', 'for-each-ref', 'rev-parse', 'rev-list', 'cat-file', 'diff', 'diff-tree', 'diff-index', 'merge-base', 'check-ref-format', 'check-attr', 'show-ref'].includes(args[0])) return true;
  if (args[0] === 'config') return ['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--list', '-l'].includes(args[1]);
  if (args[0] === 'remote') return args.length === 1 || args[1] === 'get-url';
  if (args[0] === 'worktree') return args[1] === 'list';
  if (args[0] === 'stash') return ['list', 'show'].includes(args[1]);
  return false;
}
