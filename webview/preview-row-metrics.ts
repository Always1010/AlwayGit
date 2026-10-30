/** Sparse height corrections keep unvisited, paged rows at their estimated height. */
export class PreviewRowMetrics {
  private heights = new Map<number, number>();
  private tree = new Map<number, number>();

  constructor(
    readonly count: number,
    readonly rowHeight: number,
  ) {}

  size(index: number) {
    return this.heights.get(index) ?? this.rowHeight;
  }

  offset(index: number) {
    let correction = 0;
    for (
      let position = Math.min(this.count, Math.max(0, index));
      position > 0;
      position -= position & -position
    )
      correction += this.tree.get(position) ?? 0;
    return Math.min(this.count, Math.max(0, index)) * this.rowHeight + correction;
  }

  measure(index: number, height: number) {
    if (index < 0 || index >= this.count || !Number.isFinite(height)) return false;
    const next = Math.max(this.rowHeight, Math.ceil(height)),
      delta = next - this.size(index);
    if (!delta) return false;
    if (next === this.rowHeight) this.heights.delete(index);
    else this.heights.set(index, next);
    for (let position = index + 1; position <= this.count; position += position & -position) {
      const value = (this.tree.get(position) ?? 0) + delta;
      if (value) this.tree.set(position, value);
      else this.tree.delete(position);
    }
    return true;
  }

  rowAt(offset: number) {
    let low = 0,
      high = this.count;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.offset(middle + 1) <= offset) low = middle + 1;
      else high = middle;
    }
    return Math.min(Math.max(0, this.count - 1), low);
  }

  anchor(offset: number) {
    const index = this.rowAt(offset);
    return {
      index,
      fraction: Math.max(0, Math.min(1, (offset - this.offset(index)) / this.size(index))),
    };
  }

  restore(anchor: { index: number; fraction: number }) {
    const index = Math.min(Math.max(0, this.count - 1), anchor.index);
    return this.offset(index) + this.size(index) * anchor.fraction;
  }
}
