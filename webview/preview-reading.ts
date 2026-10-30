import type { TreePreviewState } from '../src/protocol/tree';

export interface PreviewReading {
  value?: TreePreviewState;
  onChange(value: Omit<TreePreviewState, 'key'>): void;
}
