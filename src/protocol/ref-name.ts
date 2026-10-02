import { translate } from '../i18n/index';
export type BranchNameProblem = 'empty' | 'leading-hyphen' | 'space' | 'control' | 'invalid-character' | 'double-dot' | 'reflog' | 'slash' | 'dot-component' | 'lock-suffix' | 'trailing-dot' | 'single-at';

export interface BranchNameConflict { kind: 'exists' | 'ancestor' | 'descendant'; name: string }

/** Only names in refs/heads belong to the local branch namespace. */
export function branchNameConflict(name: string, localNames: readonly string[]): BranchNameConflict | undefined {
  if (localNames.includes(name)) return { kind: 'exists', name };
  for (const other of localNames) {
    if (name.startsWith(`${other}/`)) return { kind: 'ancestor', name: other };
    if (other.startsWith(`${name}/`)) return { kind: 'descendant', name: other };
  }
  return undefined;
}

export function branchNameConflictMessage(name: string, conflict: BranchNameConflict): string {
  return conflict.kind === 'exists' ? translate('en', "refName.localBranchAlreadyExistsChooseAnotherBranchName", { name: (name) }) : translate('en', "refName.localBranchNamesConflictAndChooseAnotherBranchName", { name: (name), name2: (conflict.name) });
}

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
    case 'empty': return translate('en', "refName.enterABranchName");
    case 'leading-hyphen': return translate('en', "refName.branchNamesCannotStartWithAHyphen");
    case 'space': return translate('en', "refName.branchNamesCannotContainSpacesTryFeatureUxFlow");
    case 'control': return translate('en', "refName.branchNamesCannotContainControlCharacters");
    case 'invalid-character': return translate('en', "refName.branchNamesCannotContainOrBackslash");
    case 'double-dot': return translate('en', "refName.branchNamesCannotContainTwoConsecutiveDots");
    case 'reflog': return translate('en', "refName.branchNamesCannotContain");
    case 'slash': return translate('en', "refName.branchNamesCannotStartOrEndWithASlash");
    case 'dot-component': return translate('en', "refName.branchNameSegmentsCannotStartWithADot");
    case 'lock-suffix': return translate('en', "refName.branchNameSegmentsCannotEndWithLock");
    case 'trailing-dot': return translate('en', "refName.branchNamesCannotEndWithADot");
    case 'single-at': return translate('en', "refName.aBranchNameCannotBeOnly");
  }
}
