import { zoomTree, type TreeCamera } from './treeLayout';
import type { TreeWheelMode } from '../src/protocol/interface-settings';

type TreeWheelInput = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey' | 'shiftKey'>;

export function wheelTree(camera: TreeCamera, event: TreeWheelInput, viewport: { width: number; height: number }, pointer: { x: number; y: number }, mode: TreeWheelMode = 'zoom'): TreeCamera {
  // Wheel deltas can be pixels, lines, or pages. Keep panning in screen pixels
  // so its speed does not depend on the current graph scale.
  const dx = event.deltaX * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.width : 1);
  const dy = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1);
  if (event.ctrlKey || mode === 'zoom' && !event.shiftKey) return zoomTree(camera, Math.exp(-Math.max(-120, Math.min(120, dy)) * .002), pointer.x, pointer.y);
  return { ...camera, x: camera.x - dx - (event.shiftKey ? dy : 0), y: camera.y - (event.shiftKey ? 0 : dy) };
}
