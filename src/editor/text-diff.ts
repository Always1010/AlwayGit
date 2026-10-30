import { setImmediate } from 'node:timers/promises';
import { message, MessageError } from '../i18n';
import type { DiffChangeRange, DiffChangeSummary, DiffRow, TextDiffHunk } from '../protocol/diff';

const MAX_INDEX_BYTES = 128 * 1024 * 1024;
interface Lines {
  text: string;
  starts: Uint32Array;
  columns: number;
}
interface Segment {
  start: number;
  length: number;
  before: number;
  after: number;
  beforeCount: number;
  afterCount: number;
  changed: boolean;
}

async function lines(text: string, check: () => void): Promise<Lines> {
  let count = text ? 1 : 0;
  // Yield between bounded chunks so cancellation and other panels can run.
  for (let start = 0; start < text.length; start += 262144) {
    const end = Math.min(text.length, start + 262144);
    for (let i = start; i < end; i++) if (text.charCodeAt(i) === 10) count++;
    check();
    await setImmediate();
  }
  if (text.length * 2 + count * 4 > MAX_INDEX_BYTES)
    throw new MessageError(message('documents.textComparisonResourceLimit'));
  const starts = new Uint32Array(count);
  let index = 1,
    columns = 0,
    width = 0;
  for (let start = 0; start < text.length; start += 262144) {
    const end = Math.min(text.length, start + 262144);
    for (let i = start; i < end; i++) {
      const code = text.charCodeAt(i);
      if (code === 10) {
        starts[index++] = i + 1;
        columns = Math.max(columns, width);
        width = 0;
      } else if (code === 9) width += 4 - (width % 4);
      else if (
        code < 0xdc00 ||
        code > 0xdfff ||
        i === 0 ||
        text.charCodeAt(i - 1) < 0xd800 ||
        text.charCodeAt(i - 1) > 0xdbff
      )
        width += code > 0x2ff ? 2 : 1;
    }
    check();
    await setImmediate();
  }
  return { text, starts, columns: Math.max(columns, width) };
}
function getLine(value: Lines, index: number): string {
  const start = value.starts[index],
    end = index + 1 < value.starts.length ? value.starts[index + 1] - 1 : value.text.length;
  return value.text.slice(start, end);
}

/** Compact alignment: unchanged stretches occupy one segment, not one JS object per line. */
export class IndexedTextDiff {
  readonly changes: DiffChangeRange[] = [];
  readonly summary: DiffChangeSummary = { added: 0, modified: 0, removed: 0 };
  readonly columns: number;
  readonly bytes: number;
  readonly rowCount: number;
  private readonly segments: Segment[] = [];
  private constructor(
    private readonly left: Lines,
    private readonly right: Lines,
    hunks: TextDiffHunk[],
  ) {
    this.columns = Math.max(left.columns, right.columns);
    let before = 0,
      after = 0,
      row = 0;
    const append = (beforeCount: number, afterCount: number, changed: boolean) => {
      const length = Math.max(beforeCount, afterCount);
      if (!length) return;
      this.segments.push({ start: row, length, before, after, beforeCount, afterCount, changed });
      if (changed) {
        const previous = this.changes.at(-1);
        if (previous?.end === row - 1) previous.end += length;
        else this.changes.push({ start: row, end: row + length - 1 });
      }
      before += beforeCount;
      after += afterCount;
      row += length;
    };
    for (const hunk of hunks) {
      const a = hunk.beforeStart - (hunk.beforeCount ? 1 : 0),
        b = hunk.afterStart - (hunk.afterCount ? 1 : 0);
      if (
        a < before ||
        b < after ||
        a - before !== b - after ||
        a + hunk.beforeCount > left.starts.length ||
        b + hunk.afterCount > right.starts.length
      )
        throw new MessageError(message('documents.invalidDiffIndex'));
      append(a - before, b - after, false);
      append(hunk.beforeCount, hunk.afterCount, true);
    }
    const remainingLeft = left.starts.length - before,
      remainingRight = right.starts.length - after;
    const common = Math.min(remainingLeft, remainingRight);
    append(common, common, false);
    // Git omits the terminal empty line. Keep it accessible with its real line number.
    append(remainingLeft - common, remainingRight - common, true);
    this.rowCount = row;
    let segmentIndex = 0;
    for (const range of this.changes) {
      let hasBefore = false,
        hasAfter = false;
      while (
        segmentIndex < this.segments.length &&
        this.segments[segmentIndex].start <= range.end
      ) {
        const segment = this.segments[segmentIndex++];
        if (segment.changed && segment.start >= range.start) {
          hasBefore ||= segment.beforeCount > 0;
          hasAfter ||= segment.afterCount > 0;
        }
      }
      if (hasBefore && hasAfter) this.summary.modified++;
      else if (hasAfter) this.summary.added++;
      else this.summary.removed++;
    }
    this.bytes =
      (left.text.length + right.text.length) * 2 +
      left.starts.byteLength +
      right.starts.byteLength +
      this.segments.length * 80 +
      this.changes.length * 32;
    if (this.bytes > MAX_INDEX_BYTES)
      throw new MessageError(message('documents.textComparisonResourceLimit'));
  }
  static async create(
    left: string,
    right: string,
    hunks: TextDiffHunk[],
    check: () => void = () => {},
  ): Promise<IndexedTextDiff> {
    const a = await lines(left, check),
      b = await lines(right, check);
    check();
    return new IndexedTextDiff(a, b, hunks);
  }
  page(start: number, count: number): DiffRow[] {
    const rows: DiffRow[] = [];
    let low = 0,
      high = this.segments.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.segments[mid].start + this.segments[mid].length <= start) low = mid + 1;
      else high = mid;
    }
    const end = Math.min(this.rowCount, start + count);
    for (let i = low; i < this.segments.length && this.segments[i].start < end; i++) {
      const segment = this.segments[i];
      for (
        let row = Math.max(start, segment.start);
        row < Math.min(end, segment.start + segment.length);
        row++
      ) {
        const offset = row - segment.start,
          hasBefore = offset < segment.beforeCount,
          hasAfter = offset < segment.afterCount;
        rows.push({
          changed: segment.changed,
          before: hasBefore ? getLine(this.left, segment.before + offset) : undefined,
          after: hasAfter ? getLine(this.right, segment.after + offset) : undefined,
          beforeLine: hasBefore ? segment.before + offset + 1 : undefined,
          afterLine: hasAfter ? segment.after + offset + 1 : undefined,
        });
      }
    }
    return rows;
  }
}
