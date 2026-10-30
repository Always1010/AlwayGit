import { useEffect, useState } from 'react';
import type { GitAction, Snapshot } from '../src/protocol/types';
import type { LfsStatus, LfsTrackPreview } from '../src/protocol/lfs';
import { useTranslation } from './i18n';
import { Button, Modal } from './ui';
import { rpc } from './rpc';
import { captureActionContext, isActionContextCurrent, useWorkbench } from './store';
import './revision-tools.css';
import './lfs.css';

export function LfsDialog({
  repoId,
  snapshot,
  onClose,
}: {
  repoId: string;
  snapshot: Snapshot;
  onClose(): void;
}) {
  const t = useTranslation(),
    repositoryBusy = useWorkbench((state) => state.busy);
  const [status, setStatus] = useState<LfsStatus>(),
    [error, setError] = useState<string>(),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string[]>([]),
    [remote, setRemote] = useState(snapshot.remotes?.[0] ?? ''),
    [pattern, setPattern] = useState(''),
    [literal, setLiteral] = useState(true),
    [operation, setOperation] = useState<'track' | 'untrack'>('track'),
    [preview, setPreview] = useState<LfsTrackPreview>();
  const disabled =
    loading ||
    busy ||
    repositoryBusy ||
    (!!status && (status.head !== snapshot.head || status.branch !== snapshot.branch));
  useEffect(() => {
    if (!snapshot.remotes?.includes(remote)) setRemote(snapshot.remotes?.[0] ?? '');
  }, [snapshot.remotes, remote]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    setStatus(undefined);
    setSelected([]);
    setPreview(undefined);
    void rpc<LfsStatus>('lfsStatus', repoId, {}, { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        if (value.head !== snapshot.head || value.branch !== snapshot.branch)
          throw new Error(t('lfs.previewChanged'));
        setStatus(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [repoId, snapshot.head, snapshot.branch, version]);
  async function execute(action: GitAction) {
    const context = captureActionContext();
    if (context.repoId !== repoId) return;
    setBusy(true);
    setError(undefined);
    try {
      const success = await useWorkbench.getState().execute(action, context);
      if (!isActionContextCurrent(context)) return;
      if (success) {
        setPreview(undefined);
        setVersion((value) => value + 1);
      } else setError(useWorkbench.getState().error);
    } finally {
      if (isActionContextCurrent(context)) setBusy(false);
    }
  }
  async function prepare() {
    const context = captureActionContext();
    if (context.repoId !== repoId) return;
    setLoading(true);
    setError(undefined);
    setPreview(undefined);
    try {
      const value = await rpc<LfsTrackPreview>('lfsTrackPreview', repoId, {
        pattern,
        literal,
        operation,
      });
      if (!isActionContextCurrent(context)) return;
      if (value.head !== snapshot.head || value.branch !== snapshot.branch)
        throw new Error(t('lfs.previewChanged'));
      setPreview(value);
    } catch (error) {
      if (isActionContextCurrent(context)) setError((error as Error).message);
    } finally {
      if (isActionContextCurrent(context)) setLoading(false);
    }
  }
  const context = { expectedHead: status?.head ?? '', expectedBranch: status?.branch ?? '' },
    fetchDestination = status?.destinations[remote]?.fetch,
    pushDestination = status?.destinations[remote]?.push;
  return (
    <Modal
      className="revision-dialog lfs-dialog"
      title={t('lfs.title')}
      busy={busy}
      onClose={onClose}
    >
      <p>{t('lfs.hint')}</p>
      <div className="revision-controls">
        <Button
          icon="refresh"
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
          disabled={disabled}
          onClick={() => setVersion((value) => value + 1)}
        />
        {status && (
          <>
            <span>{status.available ? status.version : t('lfs.missingTool')}</span>
            <span>{status.filterConfigured ? t('lfs.configured') : t('lfs.notConfigured')}</span>
            <small>{new Date(status.checkedAt).toLocaleString()}</small>
          </>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {status?.available && (
        <>
          <div className="revision-controls">
            <label>
              {t('lfs.remote')}
              <select
                value={remote}
                disabled={disabled}
                onChange={(event) => setRemote(event.target.value)}
              >
                {(snapshot.remotes ?? []).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <Button
              icon="cloud-download"
              title={t('lfs.fetchHint')}
              disabled={disabled || !fetchDestination || !status.head}
              onClick={() =>
                void execute({
                  type: 'lfs.fetch',
                  remote,
                  expectedDestination: fetchDestination!,
                  ...context,
                })
              }
            >
              {t('lfs.fetch')}
            </Button>
            <Button
              icon="cloud-download"
              title={t('lfs.selectedHint')}
              disabled={disabled || !fetchDestination || !selected.length || !status.head}
              onClick={() =>
                void execute({
                  type: 'lfs.fetch',
                  remote,
                  expectedDestination: fetchDestination!,
                  oids: [
                    ...new Set(
                      status.files
                        .filter((file) => selected.includes(file.path))
                        .map((file) => file.oid),
                    ),
                  ],
                  ...context,
                })
              }
            >
              {t('lfs.fetchSelected')}
            </Button>
            <Button
              icon="archive"
              title={t('lfs.checkoutHint')}
              disabled={disabled}
              onClick={() => void execute({ type: 'lfs.checkout', ...context })}
            >
              {t('lfs.checkout')}
            </Button>
            <Button
              icon="arrow-down"
              title={t('lfs.pullHint')}
              disabled={disabled || !fetchDestination || !status.branch || !status.head}
              onClick={() =>
                void execute({
                  type: 'lfs.pull',
                  remote,
                  expectedDestination: fetchDestination!,
                  ...context,
                })
              }
            >
              {t('lfs.pull')}
            </Button>
            <Button
              icon="cloud-upload"
              title={t('lfs.pushHint')}
              disabled={disabled || !pushDestination || !status.branch || !status.head}
              onClick={() =>
                void execute({
                  type: 'lfs.push',
                  remote,
                  expectedDestination: pushDestination!,
                  ...context,
                })
              }
            >
              {t('lfs.push')}
            </Button>
          </div>
          {status.truncated && <p>{t('lfs.cap')}</p>}
          <div className="lfs-files" aria-busy={loading}>
            <table>
              <thead>
                <tr>
                  <th aria-label={t('lfs.selection')} />
                  <th>{t('lfs.path')}</th>
                  <th>{t('lfs.object')}</th>
                  <th>{t('lfs.worktree')}</th>
                  <th>{t('lfs.cache')}</th>
                  <th>{t('lfs.changes')}</th>
                </tr>
              </thead>
              <tbody>
                {status.files.map((file) => (
                  <tr key={file.path}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={t('lfs.selectFile', { path: file.path })}
                        checked={selected.includes(file.path)}
                        disabled={disabled}
                        onChange={(event) =>
                          setSelected((value) =>
                            event.target.checked
                              ? [...value, file.path]
                              : value.filter((path) => path !== file.path),
                          )
                        }
                      />
                    </td>
                    <td>{file.path}</td>
                    <td>
                      <code>{file.oid}</code>
                      <small>
                        {file.size.toLocaleString()} {t('lfs.bytes')}
                      </small>
                    </td>
                    <td>
                      {t(
                        file.worktree === 'pointer'
                          ? 'lfs.pointer'
                          : file.worktree === 'content'
                            ? 'lfs.content'
                            : file.worktree === 'missing'
                              ? 'lfs.missing'
                              : 'lfs.unknown',
                      )}
                    </td>
                    <td>
                      {t(
                        file.localObject === 'available'
                          ? 'lfs.available'
                          : file.localObject === 'missing'
                            ? 'lfs.missing'
                            : 'lfs.unknown',
                      )}
                    </td>
                    <td>
                      {[file.staged ? t('lfs.staged') : '', file.unstaged ? t('lfs.unstaged') : '']
                        .filter(Boolean)
                        .join(' / ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!status.files.length && <p>{t('lfs.empty')}</p>}
          </div>
          <details>
            <summary>{t('lfs.statusTitle')}</summary>
            <p>{t('lfs.pendingHint')}</p>
            <pre>{status.statusText}</pre>
          </details>
        </>
      )}
      <div className="revision-controls">
        <label>
          {t('lfs.pattern')}
          <input
            value={pattern}
            disabled={disabled}
            onChange={(event) => {
              setPattern(event.target.value);
              setPreview(undefined);
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={literal}
            disabled={disabled}
            onChange={(event) => {
              setLiteral(event.target.checked);
              setPreview(undefined);
            }}
          />
          {t('lfs.literal')}
        </label>
        <select
          aria-label={t('lfs.operation')}
          value={operation}
          disabled={disabled}
          onChange={(event) => {
            setOperation(event.target.value as 'track' | 'untrack');
            setPreview(undefined);
          }}
        >
          <option value="track">{t('lfs.track')}</option>
          <option value="untrack">{t('lfs.untrack')}</option>
        </select>
        <Button icon="preview" disabled={disabled || !pattern} onClick={() => void prepare()}>
          {t('lfs.preview')}
        </Button>
      </div>
      <p>{t('lfs.trackHint')}</p>
      {preview && preview.head === snapshot.head && preview.branch === snapshot.branch && (
        <>
          <div className="lfs-attributes">
            <div>
              <strong>{t('lfs.before')}</strong>
              <pre>{preview.before}</pre>
            </div>
            <div>
              <strong>{t('lfs.after')}</strong>
              <pre>{preview.after}</pre>
            </div>
          </div>
          <Button
            disabled={disabled || preview.before === preview.after}
            onClick={() => void execute({ type: 'lfs.track', token: preview.token })}
          >
            {t('lfs.apply')}
          </Button>
        </>
      )}
    </Modal>
  );
}
