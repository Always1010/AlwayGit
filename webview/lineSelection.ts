import type { PatchLine } from '../src/protocol/diff';

export interface LineSelection { ids: string[]; anchor?: string }
export function selectPatchLine(lines: readonly PatchLine[], current: LineSelection, id: string, modifiers: { shift: boolean; additive: boolean }): LineSelection {
  const target = lines.find(line => line.id === id); if (!target) return current;
  const anchor = lines.find(line => line.id === current.anchor);
  if (modifiers.shift && anchor?.side === target.side) {
    const minimum = Math.min(anchor.line, target.line), maximum = Math.max(anchor.line, target.line);
    const range = lines.filter(line => line.side === target.side && line.line >= minimum && line.line <= maximum).map(line => line.id);
    return { ids: [...new Set([...(modifiers.additive ? current.ids : []), ...range])], anchor: anchor.id };
  }
  const selected = new Set(modifiers.additive ? current.ids : []);
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  return { ids: [...selected], anchor: id };
}
