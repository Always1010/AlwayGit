import { message as localizeMessage } from '../i18n/index';
import { GitError } from './error';

// Leave room below Windows' 32,767 UTF-16 command-line limit. This deliberately
// overestimates quoting/backslash expansion and is safe on other platforms too.
export const gitArgumentBudget = 24000;
function estimatedLength(executable: string, args: readonly string[]): number {
  return [executable, ...args].reduce((size, argument) => size + argument.length * 2 + 3, 1);
}
export function assertGitArgumentBudget(executable: string, args: readonly string[]): void {
  if (estimatedLength(executable, args) > gitArgumentBudget) throw new GitError(localizeMessage("arguments.gitCommandArgumentsAreTooLongSelectFewerItems"), 'ARGUMENT_LIMIT');
}

export function prepareGitArguments(args: string[], input?: Buffer): { args: string[]; input?: Buffer } {
  if (input !== undefined) return { args, input };
  if (['add', 'restore', 'rm'].includes(args[0])) {
    const separator = args.indexOf('--');
    if (separator !== -1 && separator + 1 < args.length) {
      return { args: [...args.slice(0, separator), '--pathspec-from-file=-', '--pathspec-file-nul'], input: Buffer.from(`${args.slice(separator + 1).join('\0')}\0`, 'utf8') };
    }
  }
  if (['commit', 'tag'].includes(args[0])) {
    const message = args.indexOf('-m');
    if (message !== -1 && message + 1 < args.length) {
      if (args[message + 1].includes('\0')) throw new GitError(localizeMessage("arguments.messagesCannotContainNULCharacters"), 'INVALID_ARGUMENT');
      return { args: [...args.slice(0, message), '--file=-', ...args.slice(message + 2)], input: Buffer.from(args[message + 1], 'utf8') };
    }
  }
  return { args, input };
}

/** Builds and validates every batch before the first destructive clean starts. */
export function splitCleanArguments(executable: string, prefix: string[], args: string[]): string[][] {
  const separator = args.indexOf('--');
  if (args[0] !== 'clean' || separator < 0 || separator + 1 === args.length) return [args];
  const fixed = args.slice(0, separator + 1), result: string[][] = [];
  let batch = fixed.slice();
  for (const name of args.slice(separator + 1)) {
    // Prove each path can fit by itself before allowing any batch to execute.
    assertGitArgumentBudget(executable, [...prefix, ...fixed, name]);
    if (estimatedLength(executable, [...prefix, ...batch, name]) > gitArgumentBudget) { result.push(batch); batch = fixed.slice(); }
    batch.push(name);
  }
  if (batch.length > fixed.length) result.push(batch);
  return result;
}
