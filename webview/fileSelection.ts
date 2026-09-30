export interface FileSelection { paths: string[]; anchor?: string }

/** Git paths use forward slashes; preserve every parent segment and the original path. */
export function filePathLabel(path: string): { name: string; parent: string } {
  const separator = path.lastIndexOf('/');
  return { name: path.slice(separator + 1), parent: separator < 0 ? '' : path.slice(0, separator) };
}

export function reconcileFileSelection(order: readonly string[], selection: FileSelection): FileSelection {
  const selected = new Set(selection.paths);
  return { paths: [...new Set(order)].filter(path => selected.has(path)), anchor: selection.anchor && order.includes(selection.anchor) ? selection.anchor : undefined };
}

/** An ordinary click changes the preview anchor independently of the checked batch. */
export function fileSelectionForClick(order: readonly string[], selection: FileSelection, path: string, modifiers: { toggle?: boolean; range?: boolean }): FileSelection {
  const current = reconcileFileSelection(order, selection);
  if (!order.includes(path)) return current;
  if (modifiers.range) {
    const anchor = current.anchor ?? path, from = order.indexOf(anchor), to = order.indexOf(path);
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    return reconcileFileSelection(order, { paths: modifiers.toggle ? [...current.paths, ...range] : range, anchor });
  }
  if (modifiers.toggle) return reconcileFileSelection(order, { paths: current.paths.includes(path) ? current.paths.filter(item => item !== path) : [...current.paths, path], anchor: path });
  return { ...current, anchor: path };
}

export function fileSelectionTargets(order: readonly string[], selection: FileSelection, allWhenEmpty: boolean): string[] {
  const selected = reconcileFileSelection(order, selection).paths;
  return selected.length || !allWhenEmpty ? selected : [...new Set(order)];
}

export function fileSelectionKeyboardCommand(key: string, modifiers: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }, editable: boolean): 'all' | 'clear' | undefined {
  if (editable) return;
  if (key === 'Escape') return 'clear';
  if (key.toLowerCase() === 'a' && (modifiers.ctrlKey || modifiers.metaKey) && !modifiers.altKey && !modifiers.shiftKey) return 'all';
}
