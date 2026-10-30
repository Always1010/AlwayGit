import { useEffect, useState } from 'react';
import type { ConflictDetails } from '../src/protocol/conflicts';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { rpc } from './rpc';
import { Button, Modal } from './ui';

export function ConflictWorkflow({ onClose }: { onClose(): void }) {
  const state = useWorkbench(),
    t = useTranslation(),
    repoId = state.repoId,
    conflicts = state.snapshot?.changes.filter((file) => file.conflict) ?? [];
  const [path, setPath] = useState(
    state.diffTarget?.kind === 'change' && state.diffTarget.area === 'conflict'
      ? state.diffTarget.path
      : conflicts[0]?.path,
  );
  const [details, setDetails] = useState<ConflictDetails>(),
    [error, setError] = useState<string>(),
    [loading, setLoading] = useState(false),
    [fallback, setFallback] = useState(false),
    [choice, setChoice] = useState<'ours' | 'theirs'>();
  const current = conflicts.find((file) => file.path === path),
    position = conflicts.findIndex((file) => file.path === path);
  useEffect(() => {
    if (!current) setPath(conflicts[0]?.path);
  }, [repoId, current?.path, state.snapshot?.version]);
  useEffect(() => {
    const controller = new AbortController();
    setDetails(undefined);
    setChoice(undefined);
    setFallback(false);
    setError(undefined);
    if (!repoId || !path || !current) return;
    setLoading(true);
    void rpc<ConflictDetails>('conflictDetails', repoId, { path }, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setDetails(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(String(error instanceof Error ? error.message : error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [repoId, path, current?.path, state.snapshot?.version]);
  function preview(name: string) {
    setPath(name);
    state.selectWorking();
    state.setLayout({ diffCollapsed: false });
    state.selectFile({ kind: 'change', path: name, area: 'conflict' });
  }
  async function openEditor() {
    try {
      const result = await rpc<{ mode: 'merge' | 'text' }>('openMergeEditor', repoId, { path });
      setFallback(result.mode === 'text');
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  const stage = async () => {
    if (!path || !current) return;
    await state.execute({ type: 'resolve-and-stage', paths: [path] });
  };
  const choose = async () => {
    if (!details || !choice) return;
    const token = details.token,
      side = choice;
    setChoice(undefined);
    await state.execute({ type: 'conflict.choose', token, side });
  };
  const label = (side: 'ours' | 'theirs') =>
    t(side === 'ours' ? 'conflicts.ours' : 'conflicts.theirs');
  const status = details?.status;
  const type =
    status === 'AA'
      ? t('conflicts.bothAdded')
      : status === 'DD'
        ? t('conflicts.bothDeleted')
        : status?.includes('D')
          ? t('conflicts.modifyDelete')
          : t('conflicts.contentConflict');
  return (
    <Modal
      title={t('conflicts.title')}
      onClose={onClose}
      busy={state.busy}
      className="conflict-workflow"
      footer={
        <Button onClick={onClose} disabled={state.busy}>
          {t('common.close')}
        </Button>
      }
    >
      <p>{t('conflicts.steps')}</p>
      <p className="muted">{t('conflicts.remaining', { count: conflicts.length })}</p>
      {!!conflicts.length && (
        <>
          <label>
            {t('conflicts.file')}
            <select
              value={path ?? ''}
              disabled={state.busy}
              onChange={(event) => preview(event.target.value)}
            >
              {conflicts.map((file) => (
                <option key={file.path} value={file.path}>
                  {file.path}
                </option>
              ))}
            </select>
          </label>
          <div className="inline-actions">
            <Button
              className="icon-only"
              icon="arrow-up"
              title={t('conflicts.previous')}
              aria-label={t('conflicts.previous')}
              disabled={state.busy || position <= 0}
              onClick={() => preview(conflicts[position - 1].path)}
            />
            <Button
              className="icon-only"
              icon="arrow-down"
              title={t('conflicts.next')}
              aria-label={t('conflicts.next')}
              disabled={state.busy || position < 0 || position >= conflicts.length - 1}
              onClick={() => preview(conflicts[position + 1].path)}
            />
            <Button
              icon="diff"
              disabled={state.busy || !path}
              onClick={() => {
                if (path) preview(path);
                onClose();
              }}
            >
              {t('conflicts.compare')}
            </Button>
          </div>
          {loading && <p role="status">{t('diff.loadingDiff')}</p>}
          {details && (
            <>
              <strong>
                {type} · {details.status}
              </strong>
              <div className="conflict-versions">
                {(['ours', 'theirs'] as const).map((side) => {
                  const version = details[side];
                  return (
                    <div key={side}>
                      <strong>{label(side)}</strong>
                      <code>
                        {(side === 'ours' ? details.head : details.incoming)?.slice(0, 12) ?? ''}
                      </code>
                      <span>
                        {version
                          ? `${version.oid.slice(0, 12)} · ${version.size} B`
                          : t('conflicts.deleted')}
                      </span>
                    </div>
                  );
                })}
              </div>
              {details.operation === 'rebase' && (
                <p className="muted">{t('conflicts.rebaseSides')}</p>
              )}
              <div className="inline-actions">
                <Button
                  icon="git-merge"
                  disabled={state.busy || loading || (!details.canMerge && !details.canEdit)}
                  onClick={() => void openEditor()}
                >
                  {t(details.canMerge ? 'conflicts.openMerge' : 'conflicts.editManually')}
                </Button>
                <Button icon="check" disabled={state.busy || loading} onClick={() => void stage()}>
                  {t('conflicts.stage')}
                </Button>
              </div>
              <p className="muted">{t('conflicts.saveFirst')}</p>
              {fallback && <p role="status">{t('conflicts.fallback')}</p>}
              {details.canChoose ? (
                <div className="inline-actions">
                  {(['ours', 'theirs'] as const).map((side) => (
                    <Button
                      key={side}
                      disabled={state.busy || loading}
                      onClick={() => setChoice(side)}
                    >
                      {t(details[side] ? 'conflicts.useSide' : 'conflicts.acceptSideDeletion', {
                        side: label(side),
                      })}
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="muted">{t('conflicts.manualOnly')}</p>
              )}
              {choice && (
                <div className="conflict-choice" role="alert">
                  <p>{t('conflicts.overwrite', { path: details.path, side: label(choice) })}</p>
                  <Button autoFocus onClick={() => setChoice(undefined)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    className="danger"
                    disabled={state.busy || loading}
                    onClick={() => void choose()}
                  >
                    {t('confirm.proceed')}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {!conflicts.length && (
        <>
          <p>{t('conflicts.reviewNext')}</p>
          {state.snapshot?.operation.kind && (
            <Button
              className="primary"
              onClick={() => {
                const kind = state.snapshot?.operation.kind;
                if (kind) {
                  onClose();
                  void state.execute({ type: 'operation.continue', kind });
                }
              }}
              disabled={state.busy || !state.snapshot.operation.canContinue}
            >
              {t('operations.reviewStagedResult')}
            </Button>
          )}
        </>
      )}
      {(error || state.error) && (
        <p className="form-error" role="alert">
          {error ?? state.error}
        </p>
      )}
    </Modal>
  );
}
