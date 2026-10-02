import { describe, expect, it } from 'vitest';
import { branchNameProblem, branchNameProblemMessage } from '../src/protocol/ref-name';

describe('branch name validation', () => {
  it('accepts common hierarchical names', () => {
    expect(branchNameProblem('feature/ux-flow')).toBeUndefined();
    expect(branchNameProblem('release-2026.10')).toBeUndefined();
  });

  it('explains invalid names before Git executes', () => {
    expect(branchNameProblem('bad name')).toBe('space');
    expect(branchNameProblemMessage('space')).toContain('feature/ux-flow');
    expect(branchNameProblem('--bad')).toBe('leading-hyphen');
    expect(branchNameProblem('feature//bad')).toBe('slash');
    expect(branchNameProblem('feature/.hidden')).toBe('dot-component');
    expect(branchNameProblem('feature/bad.lock')).toBe('lock-suffix');
    expect(branchNameProblem('feature@{bad')).toBe('reflog');
  });
});
