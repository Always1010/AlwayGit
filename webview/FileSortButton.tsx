import { useCallback, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FileSort } from '../src/protocol/file-sort';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { useTranslation, type StaticMessageKey } from './i18n';
import { useWorkbenchFields } from './subscriptions';
import { Button } from './ui';

const sortKeys: Record<FileSort['key'], StaticMessageKey> = {
  name: 'details.sortName',
  path: 'details.sortPath',
  extension: 'details.sortExtension',
  status: 'details.sortStatus',
};

export function FileSortButton() {
  const state = useWorkbenchFields('fileSort', 'fileSortSaving', 'setFileSort', 'report'),
    t = useTranslation(),
    id = useId(),
    anchor = useRef<HTMLButtonElement>(null),
    [position, setPosition] = useState<{ x: number; y: number }>(),
    close = useCallback(() => setPosition(undefined), []);
  const label = t('details.sortCurrent', {
    key: t(sortKeys[state.fileSort.key]),
    direction: t(state.fileSort.direction === 'asc' ? 'details.sortAsc' : 'details.sortDesc'),
  });
  const choose = (value: FileSort) => void state.setFileSort(value).catch(state.report);
  const items: MenuItem[] = [
    ...Object.entries(sortKeys).map(([key, message]) => ({
      label: t(message),
      checked: state.fileSort.key === key,
      icon: state.fileSort.key === key ? 'check' : 'blank',
      disabled: state.fileSortSaving,
      run: () => choose({ ...state.fileSort, key: key as FileSort['key'] }),
    })),
    ...(['asc', 'desc'] as const).map((direction) => ({
      label: t(direction === 'asc' ? 'details.sortAsc' : 'details.sortDesc'),
      checked: state.fileSort.direction === direction,
      iconContent: <span className="file-sort-radio" aria-hidden="true" />,
      separatorBefore: direction === 'asc',
      disabled: state.fileSortSaving,
      run: () => choose({ ...state.fileSort, direction }),
    })),
  ];
  return (
    <>
      <Button
        className="icon-only file-sort-button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!position}
        aria-controls={position ? id : undefined}
        aria-busy={state.fileSortSaving}
        onClick={(event) => {
          anchor.current = event.currentTarget;
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition(position ? undefined : { x: rect.right - 240, y: rect.bottom + 4 });
        }}
      >
        <svg
          className="file-sort-icon"
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 4.5h9M2.5 9h6.5M2.5 13.5h4M15.5 3.5v13m-3-3 3 3 3-3" />
        </svg>
      </Button>
      {position &&
        anchor.current &&
        createPortal(
          <ContextMenu
            {...position}
            id={id}
            caption={t('details.sortBy')}
            items={items}
            anchor={anchor.current}
            close={close}
            className="file-sort-menu"
          />,
          anchor.current.closest('.workbench') ?? document.body,
        )}
    </>
  );
}
