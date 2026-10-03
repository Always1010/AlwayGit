import { describe, expect, it } from 'vitest';
import { filePathLabel, fileSelectionForClick, fileSelectionTargets, filterFilesByPath, reconcileFileSelection } from '../webview/fileSelection';
import { selectionKeyboardCommand } from '../webview/selectionKeyboard';
import { changeEntries } from '../webview/changeEntries';

it('orders change areas before filenames and keeps both versions independently selectable', () => {
  const changes = ['z.ts','nested/a.ts','a.ts'].map(path => ({path,indexStatus:'M',worktreeStatus:'M',conflict:false,untracked:false}));
  const entries = changeEntries(changes);
  expect(entries.map(({area,file}) => [area,file.path])).toEqual([
    ['unstaged','a.ts'],['unstaged','nested/a.ts'],['unstaged','z.ts'],
    ['staged','a.ts'],['staged','nested/a.ts'],['staged','z.ts'],
  ]);
  expect(new Set(entries.map(entry=>entry.key)).size).toBe(6);
});

describe('file path labels', () => {
  it('keeps the complete repository-relative parent chain at arbitrary depth', () => {
    expect(filePathLabel('packages/client/src/views/settings/components/Editor.tsx')).toEqual({ name: 'Editor.tsx', parent: './packages/client/src/views/settings/components' });
    expect(filePathLabel('src/service.ts')).toEqual({ name: 'service.ts', parent: './src' });
    expect(filePathLabel('README.md')).toEqual({ name: 'README.md', parent: './' });
  });

  it('preserves spaces, Unicode, and literal Git filename characters', () => {
    expect(filePathLabel('资料/我的 项目/a\\b.txt')).toEqual({ name: 'a\\b.txt', parent: './资料/我的 项目' });
  });
});

describe('changed file path filtering',()=>{
  const files=[{path:'src/features/auth/login.ts'},{path:'src/services/auth/login.ts'},{path:'README.md'}];

  it('matches case-insensitive keywords across the complete repository-relative path',()=>{
    expect(filterFilesByPath(files,' FEATURES/AUTH ')).toEqual([files[0]]);
    expect(filterFilesByPath(files,'login.ts')).toEqual(files.slice(0,2));
    expect(filterFilesByPath(files,'src/')).toEqual(files.slice(0,2));
  });

  it('returns all files for an empty query and none for a missing path fragment',()=>{
    expect(filterFilesByPath(files,'  ')).toEqual(files);
    expect(filterFilesByPath(files,'missing/directory')).toEqual([]);
  });
});

describe('file batch selection', () => {
  const order = ['a.txt', 'nested/b.txt', 'nested/c.txt', 'd.txt'];

  it('keeps ordinary preview clicks independent of batch selection while establishing a range anchor', () => {
    expect(fileSelectionForClick(order, { paths: ['d.txt'] }, 'a.txt', {})).toEqual({ paths: ['d.txt'], anchor: 'a.txt' });
    expect(fileSelectionForClick(order, { paths: ['d.txt'] }, 'a.txt', { replace: true })).toEqual({ paths: ['a.txt'], anchor: 'a.txt' });
    expect(fileSelectionForClick(order, { paths: [], anchor: 'a.txt' }, 'nested/c.txt', { range: true })).toEqual({ paths: order.slice(0, 3), anchor: 'a.txt' });
  });

  it('supports toggles, reverse ranges, and additive ranges in visible file order', () => {
    expect(fileSelectionForClick(order, { paths: ['a.txt', 'd.txt'] }, 'a.txt', { toggle: true })).toEqual({ paths: ['d.txt'], anchor: 'a.txt' });
    expect(fileSelectionForClick(order, { paths: ['a.txt'], anchor: 'd.txt' }, 'nested/b.txt', { range: true }).paths).toEqual(order.slice(1));
    expect(fileSelectionForClick(order, { paths: ['d.txt'], anchor: 'a.txt' }, 'nested/b.txt', { toggle: true, range: true }).paths).toEqual(['a.txt', 'nested/b.txt', 'd.txt']);
  });

  it('removes files and anchors that left the current list before calculating operation targets', () => {
    const previous = { paths: ['gone.txt', 'nested/b.txt', 'nested/b.txt'], anchor: 'gone.txt' };
    expect(reconcileFileSelection(order, previous)).toEqual({ paths: ['nested/b.txt'], anchor: undefined });
    expect(fileSelectionForClick(order, previous, 'nested/c.txt', { range: true })).toEqual({ paths: ['nested/c.txt'], anchor: 'nested/c.txt' });
    expect(fileSelectionForClick(order, previous, 'invisible.txt', { toggle: true })).toEqual({ paths: ['nested/b.txt'], anchor: undefined });
    expect(fileSelectionTargets(order, previous, true)).toEqual(['nested/b.txt']);
  });

  it('falls back to all files only for operations explicitly allowing it', () => {
    expect(fileSelectionTargets(order, { paths: [] }, true)).toEqual(order);
    expect(fileSelectionTargets(order, { paths: [] }, false)).toEqual([]);
    expect(fileSelectionTargets(order, { paths: ['gone.txt'] }, false)).toEqual([]);
  });

  it('keeps staged and unstaged entries for the same file separately selectable', () => {
    const staged = JSON.stringify(['staged', 'a.txt']), unstaged = JSON.stringify(['unstaged', 'a.txt']);
    expect(fileSelectionForClick([unstaged, staged], { paths: [staged] }, unstaged, { toggle: true }).paths).toEqual([unstaged, staged]);
    expect(reconcileFileSelection([staged], { paths: [unstaged, staged] }).paths).toEqual([staged]);
  });
});

describe('file list keyboard commands', () => {
  const plain = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

  it('recognizes Windows and macOS select-all and Escape within file lists', () => {
    expect(selectionKeyboardCommand('a', { ...plain, ctrlKey: true }, false)).toBe('all');
    expect(selectionKeyboardCommand('A', { ...plain, metaKey: true }, false)).toBe('all');
    expect(selectionKeyboardCommand('Escape', plain, false)).toBe('clear');
    expect(selectionKeyboardCommand('a', plain, false)).toBeUndefined();
    expect(selectionKeyboardCommand('a', { ...plain, ctrlKey: true, altKey: true }, false)).toBeUndefined();
    expect(selectionKeyboardCommand('a', { ...plain, ctrlKey: true, shiftKey: true }, false)).toBeUndefined();
  });

  it('preserves native editing keys in inputs, textareas, and editable content', () => {
    expect(selectionKeyboardCommand('a', { ...plain, ctrlKey: true }, true)).toBeUndefined();
    expect(selectionKeyboardCommand('a', { ...plain, metaKey: true }, true)).toBeUndefined();
    expect(selectionKeyboardCommand('Escape', plain, true)).toBeUndefined();
  });
});
