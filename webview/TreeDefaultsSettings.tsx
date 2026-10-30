import { useState } from 'react';
import { readTreeDefaults, type TreeDefaults } from '../src/protocol/tree-settings';
import type { CommitTreeViewState } from '../src/protocol/tree';
import { useTranslation } from './i18n';
import { Button, Modal } from './ui';
import { rpc } from './rpc';

export function TreeDefaultsEditor({
  value,
  onChange,
  current,
  comparison = false,
}: {
  value: TreeDefaults;
  onChange(value: TreeDefaults): void;
  current?: CommitTreeViewState;
  comparison?: boolean;
}) {
  const t = useTranslation();
  const update = (patch: Partial<TreeDefaults>) => onChange({ ...value, ...patch });
  return (
    <section className="settings-page tree-defaults-editor" aria-label={t('treeSettings.title')}>
      <section className="settings-section">
        <h3>{t('treeSettings.opening')}</h3>
        <label>
          {t('treeSettings.newPages')}
          <select
            value={value.opening}
            onChange={(event) => update({ opening: event.target.value as TreeDefaults['opening'] })}
          >
            <option value="recent">{t('treeSettings.rememberRecent')}</option>
            <option value="defaults">{t('treeSettings.useDefaults')}</option>
          </select>
        </label>
        <p className="settings-page-copy">{t('treeSettings.explanation')}</p>
      </section>
      <section className="settings-section">
        <h3>{t('treeSettings.defaults')}</h3>
        <div className="settings-grid">
          <label>
            {t('treeViews.presentation')}
            <select
              value={value.viewMode}
              onChange={(event) =>
                update({ viewMode: event.target.value as TreeDefaults['viewMode'] })
              }
            >
              <option value="list">{t('treeViews.list')}</option>
              <option value="horizontal">{t('treeViews.horizontal')}</option>
              <option value="radial">{t('treeViews.radial')}</option>
              <option value="vertical">{t('treeViews.vertical')}</option>
            </select>
          </label>
          <label>
            {t('treeSettings.wheel')}
            <select
              value={value.wheelMode}
              onChange={(event) =>
                update({ wheelMode: event.target.value as TreeDefaults['wheelMode'] })
              }
            >
              <option value="zoom">{t('treeViews.wheelZoom')}</option>
              <option value="scroll">{t('treeViews.wheelScroll')}</option>
            </select>
          </label>
          <label>
            {t('treeSettings.expansion')}
            <select
              value={value.expansion}
              onChange={(event) =>
                update({ expansion: event.target.value as TreeDefaults['expansion'] })
              }
            >
              <option value="remember">{t('treeSettings.rememberFolders')}</option>
              <option value="auto">{t('localCache.automatic')}</option>
              <option value="expanded">{t('localCache.expanded')}</option>
              <option value="collapsed">{t('localCache.collapsed')}</option>
            </select>
          </label>
        </div>
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={value.previewOpen}
            onChange={(event) => update({ previewOpen: event.target.checked })}
          />
          {t('treeSettings.preview')}
        </label>
      </section>
      {(['single', 'comparison'] as const).map((kind) => (
        <section className="settings-section" key={kind}>
          <h3>{t(kind === 'single' ? 'treeSettings.single' : 'treeSettings.comparison')}</h3>
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={value[kind].showChanges}
              onChange={(event) =>
                update({
                  [kind]: {
                    showChanges: event.target.checked,
                    changesOnly: event.target.checked && value[kind].changesOnly,
                  },
                })
              }
            />
            {t('tree.changeMarkers')}
          </label>
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={value[kind].changesOnly}
              onChange={(event) =>
                update({
                  [kind]: {
                    changesOnly: event.target.checked,
                    showChanges: event.target.checked || value[kind].showChanges,
                  },
                })
              }
            />
            {t('tree.expandChanges')}
          </label>
        </section>
      ))}
      <div className="inline-actions">
        {current && (
          <Button
            icon="copy"
            title={t('treeSettings.copyCurrent')}
            onClick={() =>
              update({
                opening: 'defaults',
                viewMode: current.viewMode ?? value.viewMode,
                wheelMode: current.wheelMode ?? value.wheelMode,
                previewOpen: current.previewOpen ?? value.previewOpen,
                [comparison ? 'comparison' : 'single']: {
                  showChanges: !!current.showChanges,
                  changesOnly: !!current.changesOnly,
                },
              })
            }
          >
            {t('treeSettings.copyCurrent')}
          </Button>
        )}
        <Button
          className="icon-only"
          icon="discard"
          title={t('treeSettings.reset')}
          aria-label={t('treeSettings.reset')}
          onClick={() => onChange(readTreeDefaults())}
        />
      </div>
    </section>
  );
}

export function TreeDefaultsDialog({
  draft,
  onChange,
  onClose,
  current,
  comparison,
}: {
  draft: TreeDefaults;
  onChange(value: TreeDefaults): void;
  onClose(): void;
  current: CommitTreeViewState;
  comparison: boolean;
}) {
  const t = useTranslation(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const apply = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await rpc('saveInterfaceSettings', undefined, { treeDefaults: draft });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('treeSettings.title')}
      className="tree-defaults-modal"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button className="primary" disabled={busy} onClick={() => void apply()}>
            {t('common.apply')}
          </Button>
        </>
      }
    >
      <fieldset disabled={busy} className="tree-defaults-fields">
        <TreeDefaultsEditor
          value={draft}
          onChange={onChange}
          current={current}
          comparison={comparison}
        />
      </fieldset>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </Modal>
  );
}
