
import { renderMessage, isMessageDescriptor, type Language, type MessageDescriptor } from '../i18n';
import { StringDecoder } from 'node:string_decoder';
import type { ActionBlocker, PushResult } from '../protocol/types';

export function redactSecrets(value: string): string {
  return value.replace(/(https?:\/\/)[^\s/]*@/gi, '$1***@')
    .replace(/([?&])([^=\s&#"'<>]+)=([^\s&#"'<>]*)/g, (match, separator: string, key: string) => {
      let decoded = key;
      try { decoded = decodeURIComponent(key.replace(/\+/g, ' ')); } catch { /* Keep malformed keys conservative. */ }
      return /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|oauth[_-]?token|private[_-]?token|auth[_-]?token|token|api[_-]?key|client[_-]?secret|password|passwd|secret|authorization|auth|signature|sig|x-amz-(?:credential|signature|security-token)|x-goog-(?:credential|signature))$/i.test(decoded) ? `${separator}${key}=***` : match;
    })
    .replace(/(authorization:\s*(?:basic|bearer)\s+)\S+/gi, '$1***');
}

/** One instance per process: never publish a URL or header before its line is complete. */
export class SecretRedactor {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';
  private dropping = false;
  private ended = false;
  constructor(private readonly emit: (text: string) => void) {}
  write(chunk: Buffer): void {
    if (!this.ended) this.consume(this.decoder.write(chunk));
  }
  private consume(text: string): void {
    for (const part of text.split(/([\r\n])/)) {
      if (part === '\r' || part === '\n') {
        this.emit((this.dropping ? '***' : redactSecrets(this.pending)) + part);
        this.pending = ''; this.dropping = false;
      } else if (!this.dropping) {
        this.pending += part;
        // A hostile command can emit an unlimited line. Omit it rather than
        // splitting a secret across independently sanitized log fragments.
        if (this.pending.length > 65536) { this.pending = ''; this.dropping = true; }
      }
    }
  }
  end(): void {
    if (this.ended) return;
    this.consume(this.decoder.end()); this.ended = true;
    if (this.pending || this.dropping) this.emit(this.dropping ? '***' : redactSecrets(this.pending));
    this.pending = ''; this.dropping = false;
  }
}

function sanitizedPush(result: PushResult): PushResult {
  // Diagnostics and URLs can be carried in nested destination/ref metadata too.
  const sanitize = (value: unknown): unknown => typeof value === 'string' ? redactSecrets(value)
    : Array.isArray(value) ? value.map(sanitize)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)])) : value;
  return sanitize(result) as PushResult;
}

/** The response and Output channel must use the same sanitized diagnostics. */
export function serializeRequestError(error: unknown, language: Language = 'en'): { message: string; code: string; details?: ActionBlocker; localizedMessage?: MessageDescriptor; pushResult?: PushResult } {
  const failure = error as { code?: unknown; pushResult?: PushResult; details?: ActionBlocker; localizedMessage?: MessageDescriptor } | undefined;
  const details = failure?.details;
  const sanitized = details && 'kind' in details && details.kind === 'stash-apply' && details.output ? { ...details, output: redactSecrets(details.output) } : details;
  const localizedMessage = isMessageDescriptor(failure?.localizedMessage) ? { key: failure.localizedMessage.key, parameters: Object.fromEntries(Object.entries(failure.localizedMessage.parameters ?? {}).map(([key, value]) => [key, typeof value === 'string' ? redactSecrets(value) : value])) } : undefined;
  return { message: redactSecrets(localizedMessage ? renderMessage(localizedMessage, language) : error instanceof Error ? error.message : String(error)), code: String(failure?.code ?? 'FAILED'), ...(sanitized ? { details: sanitized } : {}), ...(localizedMessage ? { localizedMessage } : {}), ...(failure?.pushResult ? { pushResult: sanitizedPush(failure.pushResult) } : {}) };
}

export function requestErrorText(error: ReturnType<typeof serializeRequestError>): string {
  const output = error.details && 'kind' in error.details && error.details.kind === 'stash-apply' ? error.details.output : undefined;
  return output && output !== error.message ? `${error.message}
${output}` : error.message;
}
