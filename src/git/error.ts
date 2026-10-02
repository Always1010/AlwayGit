import type { ActionBlocker } from '../protocol/types';

export class GitError extends Error {
  constructor(message: string, public readonly code: string, public readonly stdout = '', public readonly stderr = '', public readonly details?: ActionBlocker) { super(message); this.name = 'GitError'; }
}

export class GitTerminationError extends GitError {
  readonly terminationUnconfirmed = true;
  constructor(message: string, public readonly pid?: number, public readonly completion: Promise<void> = Promise.resolve(), public readonly triggerCode?: string) { super(message, 'GIT_TERMINATION_UNCONFIRMED'); }
}
