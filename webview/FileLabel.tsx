import type { FilePathDisplay } from '../src/protocol/session';
import { filePathLabel } from './fileSelection';

export function FileLabel({ path, display }: { path: string; display: FilePathDisplay }) {
  const label = filePathLabel(path);
  return (
    <span className="file-label" data-path-display={display}>
      <span className="file-basename">{label.name}</span>
      {display !== 'name-only' && <span className="file-parent-path">{label.parent}</span>}
    </span>
  );
}
