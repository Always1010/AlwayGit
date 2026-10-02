import { describe, expect, it } from 'vitest';
import { branchNameConflict, branchNameProblem, branchNameProblemMessage } from '../src/protocol/ref-name';

describe('branch name validation', () => {
  it('blocks existing names and both directions of branch path collisions at slash boundaries', () => {
    expect(branchNameConflict('test/b1', ['test/b1'])).toEqual({ kind: 'exists', name: 'test/b1' });
    expect(branchNameConflict('test', ['test/b1'])).toEqual({ kind: 'descendant', name: 'test/b1' });
    expect(branchNameConflict('test/b1/nested', ['test/b1'])).toEqual({ kind: 'ancestor', name: 'test/b1' });
    for (const name of ['test/b2', 'test/b10', 'test2', 'testing/b1']) expect(branchNameConflict(name, ['test/b1'])).toBeUndefined();
  });

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
