import type { ActionBlocker } from '../protocol/types';
import { renderMessage, type MessageDescriptor } from '../i18n';

export class GitError extends Error {
  readonly localizedMessage?: MessageDescriptor;
  constructor(message: string | MessageDescriptor, public readonly code: string, public readonly stdout = '', public readonly stderr = '', public readonly details?: ActionBlocker) {
    super(typeof message === 'string' ? message : renderMessage(message)); this.name = 'GitError';
    if (typeof message !== 'string') this.localizedMessage = message;
  }
}

export class GitTerminationError extends GitError {
  readonly terminationUnconfirmed = true;
  constructor(message: string | MessageDescriptor, public readonly pid?: number, public readonly completion: Promise<void> = Promise.resolve(), public readonly triggerCode?: string) { super(message, 'GIT_TERMINATION_UNCONFIRMED'); }
}

export class GitReadTerminationError extends GitError {
  constructor(message: string | MessageDescriptor, code: string, public readonly pid: number | undefined, public readonly completion: Promise<void>) { super(message, code); }
}
