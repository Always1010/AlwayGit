import type { ActionBlocker } from '../src/protocol/types';
import { renderMessage, isMessageDescriptor, type Language, type MessageDescriptor } from '../src/i18n';

export class RpcError extends Error {
  constructor(message: string | MessageDescriptor, public code?: string, public details?: ActionBlocker, public localizedMessage?: MessageDescriptor) { super(typeof message === 'string' ? message : renderMessage(message)); this.name = 'RpcError'; if (typeof message !== 'string') this.localizedMessage = message; }
}

export function errorMessage(error: unknown, language: Language): string {
  const descriptor = (error as { localizedMessage?: MessageDescriptor } | undefined)?.localizedMessage;
  return isMessageDescriptor(descriptor) ? renderMessage(descriptor, language) : error instanceof Error ? error.message : String(error);
}
