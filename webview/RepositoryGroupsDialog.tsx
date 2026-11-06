import { useState } from 'react';
import type { RepositoryGroup } from '../src/protocol/repositories';
import { Button, Modal } from './ui';
import { useTranslation } from './i18n';
import { rpc } from './rpc';
import { useWorkbench } from './store';

export function RepositoryGroupsDialog({
  groups,
  onClose,
}: {
  groups: RepositoryGroup[];
  onClose(): void;
}) {
  const state = useWorkbench(),
    t = useTranslation(),
    [changes, setChanges] = useState<Record<string, boolean>>({}),
    [search, setSearch] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const collections = state.repositoryCollections,
    pending = Object.entries(changes).map(([collectionId, included]) => ({
      collectionId,
      included,
    }));
  const initial = (id: string) => {
    const count = groups.filter((group) => group.collectionIds.includes(id)).length;
    return count === groups.length ? true : count === 0 ? false : 'mixed';
  };
  const apply = async () => {
    if (busy || !pending.length) return;
    setBusy(true);
    setError(undefined);
    try {
      await rpc<number>('updateRepositoryMemberships', undefined, {
        keys: [...new Set(groups.map((group) => group.key))],
        changes: pending,
      });
      await state.initialize();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('repositoryGroups.title')}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            className="primary"
            disabled={busy || !pending.length}
            onClick={() => void apply()}
          >
            {t('common.apply')}
          </Button>
        </>
      }
    >
      <p>
        {groups.length === 1
          ? groups[0].name
          : t('repositoryGroups.selected', { count: groups.length })}
      </p>
      <p className="muted" id="repository-groups-hint">
        {t('repositoryGroups.hint')}
      </p>
      {groups.length > 1 && <p className="muted">{t('repositoryGroups.mixedHint')}</p>}
      {collections.length > 8 && (
        <input
          type="search"
          aria-label={t('repositoryGroups.search')}
          placeholder={t('repositoryGroups.search')}
          value={search}
          disabled={busy}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}
      <div className="repository-membership-list" aria-describedby="repository-groups-hint">
        {collections
          .filter((collection) =>
            collection.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
          )
          .map((collection) => {
            const checked = Object.hasOwn(changes, collection.id)
              ? changes[collection.id]
              : initial(collection.id);
            return (
              <label key={collection.id}>
                <input
                  type="checkbox"
                  data-autofocus={
                    collections.length <= 8 && collection.id === collections[0]?.id
                      ? 'true'
                      : undefined
                  }
                  checked={checked === true}
                  aria-checked={checked}
                  ref={(input) => {
                    if (input) input.indeterminate = checked === 'mixed';
                  }}
                  disabled={busy}
                  onChange={(event) => {
                    const included = event.target.checked;
                    setChanges((current) => {
                      const next = { ...current };
                      if (included === initial(collection.id)) delete next[collection.id];
                      else next[collection.id] = included;
                      return next;
                    });
                  }}
                />
                <span>{collection.name}</span>
              </label>
            );
          })}
        {!collections.length && <p className="muted">{t('repositoryGroups.empty')}</p>}
        {!!collections.length &&
          !collections.some((collection) =>
            collection.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
          ) && <p className="muted">{t('repositoryGroups.noMatches')}</p>}
      </div>
      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
        </div>
      )}
    </Modal>
  );
}
