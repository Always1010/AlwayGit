import { StringDecoder } from 'node:string_decoder';
import { redactSecrets } from '../application/logging';
import type { NetworkOperationProgress } from '../protocol/types';

type Phase = NetworkOperationProgress['phase'];
const phases: Record<string, Phase> = {
  'Enumerating objects': 'counting', 'Counting objects': 'counting',
  'Compressing objects': 'compressing', 'Writing objects': 'sending',
  'Receiving objects': 'receiving', 'Resolving deltas': 'resolving',
};

/** Git updates lines with CR, and UTF-8 characters can straddle pipe chunks. */
export class NetworkProgressParser {
  private readonly streams = new Map<'stdout' | 'stderr', { decoder: StringDecoder; pending: string; dropping: boolean }>();
  private timer?: ReturnType<typeof setTimeout>;
  private ended = false;
  private state: NetworkOperationProgress;
  constructor(command: NetworkOperationProgress['command'], private readonly emit: (progress: NetworkOperationProgress) => void) {
    this.state = { command, phase: 'connecting', startedAt: Date.now() };
    this.emit({ ...this.state });
  }
  write(chunk: Buffer, stream: 'stdout' | 'stderr' = 'stderr'): void {
    if (this.ended) return;
    this.state.lastOutputAt = Date.now();
    let buffer = this.streams.get(stream);
    if (!buffer) { buffer = { decoder: new StringDecoder('utf8'), pending: '', dropping: false }; this.streams.set(stream, buffer); }
    this.consume(buffer, buffer.decoder.write(chunk));
    this.schedule();
  }
  private consume(buffer: { pending: string; dropping: boolean }, text: string): void {
    for (const part of text.split(/([\r\n])/)) {
      if (part === '\r' || part === '\n') {
        if (!buffer.dropping && buffer.pending) this.line(redactSecrets(buffer.pending));
        buffer.pending = ''; buffer.dropping = false;
      } else if (!buffer.dropping) {
        buffer.pending += part;
        if (buffer.pending.length > 65536) { buffer.pending = ''; buffer.dropping = true; }
      }
    }
  }
  private line(text: string): void {
    const line = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
    const match = /^(remote:\s*)?(Enumerating objects|Counting objects|Compressing objects|Writing objects|Receiving objects|Resolving deltas):\s*(.*)$/.exec(line);
    if (match) {
      const remote = !!match[1], phase = phases[match[2]], detail = match[3];
      const counts = /(\d+)%\s*\((\d+)\s*\/\s*(\d+)\)/.exec(detail);
      const transfer = /(?:^|,)\s*(\d+(?:[.,]\d+)?\s*(?:[KMGT]i?B|bytes))\s*(?:\|\s*(\d+(?:[.,]\d+)?\s*(?:[KMGT]i?B|bytes)\/s))?/i.exec(detail);
      const current = this.state.phase === phase && this.state.remote === remote ? this.state : undefined;
      this.state = { command: this.state.command, startedAt: this.state.startedAt, lastOutputAt: this.state.lastOutputAt, phase, remote,
        ...(counts ? { percent: Math.min(100, Number(counts[1])), completed: Number(counts[2]), total: Number(counts[3]) } : {}),
        transferred: transfer?.[1] ?? current?.transferred ?? (phase === 'resolving' ? this.state.transferred : undefined), speed: transfer?.[2],
      };
      // 100% counts do not mean the write pipe or remote has finished.
      if (phase === 'sending' && /\bdone\.?\s*$/.test(detail)) this.changePhase('waiting');
      else if (phase === 'resolving' && /\bdone\.?\s*$/.test(detail)) this.changePhase(this.state.command === 'push' ? 'waiting' : this.state.command === 'pull' ? 'integrating' : 'updating');
    } else if (this.state.command === 'pull' && /^(?:Updating [0-9a-f]|Fast-forward|Rebasing \(|Successfully rebased|Merge made by|CONFLICT|Auto-merging)/.test(line)) {
      this.changePhase('integrating');
    } else if (this.state.command === 'push' && /^(?:Total \d+|remote:)/.test(line) && this.state.phase === 'sending') {
      this.changePhase('waiting');
    }
  }
  private changePhase(phase: Phase): void {
    this.state = { command: this.state.command, phase, startedAt: this.state.startedAt, lastOutputAt: this.state.lastOutputAt,
      transferred: this.state.transferred };
  }
  private schedule(): void {
    this.timer ??= setTimeout(() => { this.timer = undefined; this.emit({ ...this.state }); }, 150);
  }
  end(): void {
    if (this.ended) return;
    for (const buffer of this.streams.values()) {
      this.consume(buffer, buffer.decoder.end());
      if (!buffer.dropping && buffer.pending) this.line(redactSecrets(buffer.pending));
    }
    this.ended = true; clearTimeout(this.timer); this.timer = undefined;
    this.emit({ ...this.state });
  }
}
