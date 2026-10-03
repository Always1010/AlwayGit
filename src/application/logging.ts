
import { renderMessage, isMessageDescriptor, type Language, type MessageDescriptor } from '../i18n';
import type { ActionBlocker, PushResult } from '../protocol/types';

export function redactSecrets(value: string): string {
  return value.replace(/(https?:\/\/)[^\s/]*@/gi, '$1***@')
    .replace(/(authorization:\s*(?:basic|bearer)\s+)\S+/gi, '$1***');
}

/** The response and Output channel must use the same sanitized diagnostics. */
export function serializeRequestError(error: unknown, language: Language = 'en'): { message: string; code: string; details?: ActionBlocker; localizedMessage?: MessageDescriptor; pushResult?: PushResult } {
  const failure = error as { code?: unknown; pushResult?: PushResult; details?: ActionBlocker; localizedMessage?: MessageDescriptor } | undefined;
  const details = failure?.details;
  const sanitized = details && 'kind' in details && details.kind === 'stash-apply' && details.output ? { ...details, output: redactSecrets(details.output) } : details;
  const localizedMessage = isMessageDescriptor(failure?.localizedMessage) ? { key: failure.localizedMessage.key, parameters: Object.fromEntries(Object.entries(failure.localizedMessage.parameters ?? {}).map(([key, value]) => [key, typeof value === 'string' ? redactSecrets(value) : value])) } : undefined;
  return { message: redactSecrets(localizedMessage ? renderMessage(localizedMessage, language) : error instanceof Error ? error.message : String(error)), code: String(failure?.code ?? 'FAILED'), ...(sanitized ? { details: sanitized } : {}), ...(localizedMessage ? { localizedMessage } : {}), ...(failure?.pushResult ? { pushResult: failure.pushResult } : {}) };
}

export function requestErrorText(error: ReturnType<typeof serializeRequestError>): string {
  const output = error.details && 'kind' in error.details && error.details.kind === 'stash-apply' ? error.details.output : undefined;
  return output && output !== error.message ? `${error.message}
${output}` : error.message;
}
