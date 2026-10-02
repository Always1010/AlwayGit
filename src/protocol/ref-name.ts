export type BranchNameProblem = 'empty' | 'leading-hyphen' | 'space' | 'control' | 'invalid-character' | 'double-dot' | 'reflog' | 'slash' | 'dot-component' | 'lock-suffix' | 'trailing-dot' | 'single-at';

export function branchNameProblem(value: string): BranchNameProblem | undefined {
  if (!value) return 'empty';
  if (value.startsWith('-')) return 'leading-hyphen';
  if (value === '@') return 'single-at';
  if (/\s/.test(value)) return /[\u0000-\u001f\u007f]/.test(value) ? 'control' : 'space';
  if ([...'~^:?*[\\'].some(character => value.includes(character))) return 'invalid-character';
  if (value.includes('..')) return 'double-dot';
  if (value.includes('@{')) return 'reflog';
  if (value.startsWith('/') || value.endsWith('/') || value.includes('//')) return 'slash';
  const parts = value.split('/');
  if (parts.some(part => part.startsWith('.'))) return 'dot-component';
  if (parts.some(part => part.toLowerCase().endsWith('.lock'))) return 'lock-suffix';
  if (value.endsWith('.')) return 'trailing-dot';
  return undefined;
}

export function branchNameProblemMessage(problem: BranchNameProblem): string {
  switch (problem) {
    case 'empty': return 'Enter a branch name.';
    case 'leading-hyphen': return 'Branch names cannot start with a hyphen.';
    case 'space': return 'Branch names cannot contain spaces. Try feature/ux-flow.';
    case 'control': return 'Branch names cannot contain control characters.';
    case 'invalid-character': return 'Branch names cannot contain ~, ^, :, ?, *, [, or backslash.';
    case 'double-dot': return 'Branch names cannot contain two consecutive dots.';
    case 'reflog': return 'Branch names cannot contain @{.';
    case 'slash': return 'Branch names cannot start or end with a slash, or contain consecutive slashes.';
    case 'dot-component': return 'Branch name segments cannot start with a dot.';
    case 'lock-suffix': return 'Branch name segments cannot end with .lock.';
    case 'trailing-dot': return 'Branch names cannot end with a dot.';
    case 'single-at': return 'A branch name cannot be only @.';
  }
}
