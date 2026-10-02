import type { ActionBlocker } from '../protocol/types';

export function redactSecrets(value: string): string {
  return value.replace(/(https?:\/\/)[^\s/]*@/gi, '$1***@')
    .replace(/(authorization:\s*(?:basic|bearer)\s+)\S+/gi, '$1***');
}

/** The response and Output channel must use the same sanitized diagnostics. */
export function serializeRequestError(error: unknown): { message: string; code: string; details?: ActionBlocker } {
  const failure = error as { code?: unknown; details?: ActionBlocker } | undefined;
  const details = failure?.details;
  const sanitized = details && 'kind' in details && details.kind === 'stash-apply' && details.output ? { ...details, output: redactSecrets(details.output) } : details;
  return { message: redactSecrets(error instanceof Error ? error.message : String(error)), code: String(failure?.code ?? 'FAILED'), ...(sanitized ? { details: sanitized } : {}) };
}

export function requestErrorText(error: ReturnType<typeof serializeRequestError>): string {
  const output = error.details && 'kind' in error.details && error.details.kind === 'stash-apply' ? error.details.output : undefined;
  return output && output !== error.message ? `${error.message}\n${output}` : error.message;
}
