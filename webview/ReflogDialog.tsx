import { useEffect, useState } from 'react';
import type { Snapshot } from '../src/protocol/types';
import type { ReflogPage } from '../src/protocol/reflog';
import { useTranslation } from './i18n';
import { Button, Modal } from './ui';
import { rpc } from './rpc';
import { useWorkbench } from './store';
import { RevisionInspector } from './RevisionInspector';
import './revision-tools.css';
function reflogFingerprint(snapshot: Snapshot, ref: string): string {
  return JSON.stringify(
    ref === 'HEAD' ? [snapshot.head, snapshot.branch, snapshot.refs] : snapshot.refs,
  );
}
export function ReflogDialog({
  repoId,
  snapshot,
  onClose,
}: {
  repoId: string;
  snapshot: Snapshot;
  onClose(): void;
}) {
  const t = useTranslation(),
    [ref, setRef] = useState('HEAD'),
    [page, setPage] = useState<ReflogPage>(),
    [selected, setSelected] = useState<string>(),
    [name, setName] = useState(''),
    [checkout, setCheckout] = useState(false),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>(),
    [loading, setLoading] = useState(false),
    [version, setVersion] = useState(0),
    [busy, setBusy] = useState(false),
    [capturedFingerprint, setCapturedFingerprint] = useState('');
  useEffect(() => {
    const controller = new AbortController(),
      fingerprint = reflogFingerprint(snapshot, ref);
    setLoading(true);
    setError(undefined);
    setPage(undefined);
    setSelected(undefined);
    void rpc<ReflogPage>('reflog', repoId, { ref }, { signal: controller.signal })
      .then((value) => {
        setPage(value);
        setCapturedFingerprint(fingerprint);
        setSelected(value.entries[0]?.oid ?? value.recoveries[0]?.oid);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [repoId, ref, version]);
  async function more() {
    if (!page) return;
    setLoading(true);
    setError(undefined);
    try {
      const next = await rpc<ReflogPage>('reflog', repoId, {
        ref,
        token: page.token,
        offset: page.nextOffset,
      });
      setPage({ ...next, entries: [...page.entries, ...next.entries] });
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function recover() {
    if (!selected || !name.trim()) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const success = await useWorkbench
        .getState()
        .execute({ type: 'branch.create', name: name.trim(), start: selected, checkout });
      if (success) setNotice(t('reflog.recovered', { name: name.trim() }));
      else setError(useWorkbench.getState().error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal className="revision-dialog" title={t('reflog.title')} busy={busy} onClose={onClose}>
      <p>{t('reflog.hint')}</p>
      <div className="revision-controls">
        <label>
          {t('reflog.scope')}
          <select
            value={ref}
            disabled={loading || busy}
            onChange={(event) => setRef(event.target.value)}
          >
            <option value="HEAD">HEAD</option>
            {snapshot.refs
              .filter((item) => item.kind === 'local')
              .map((item) => (
                <option key={item.fullName} value={item.fullName}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <Button
          icon="refresh"
          aria-label={t('common.refresh')}
          title={t('common.refresh')}
          disabled={loading || busy}
          onClick={() => setVersion((value) => value + 1)}
        />
        {page && <small>{new Date(page.checkedAt).toLocaleString()}</small>}
      </div>
      {page && capturedFingerprint !== reflogFingerprint(snapshot, ref) && (
        <p role="status">{t('reflog.changed')}</p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {page?.truncated && <p>{t('reflog.cap')}</p>}
      <div className="revision-columns">
        <div className="reflog-list" aria-busy={loading}>
          {page?.recoveries.length ? (
            <>
              <strong>{t('reflog.backups')}</strong>
              {page.recoveries.map((item) => (
                <button
                  className="button"
                  key={item.ref}
                  aria-pressed={selected === item.oid}
                  onClick={() => setSelected(item.oid)}
                >
                  {item.ref.replace('refs/alwaygit/rebase-backups/', '')} · {item.oid.slice(0, 8)}
                </button>
              ))}
            </>
          ) : null}
          {page?.entries.map((entry, index) => (
            <button
              className="button reflog-entry"
              key={`${index}:${entry.selector}`}
              aria-pressed={selected === entry.oid}
              onClick={() => setSelected(entry.oid)}
            >
              <strong>{entry.description}</strong>
              <small>
                {entry.date} · {entry.oid.slice(0, 8)} · {entry.actor}
              </small>
            </button>
          ))}
          {page && !page.entries.length && <p>{t('reflog.empty')}</p>}
          {page?.hasMore && (
            <Button disabled={loading} onClick={() => void more()}>
              {t('history.loadMore')}
            </Button>
          )}
        </div>
        <RevisionInspector repoId={repoId} oid={selected} />
      </div>
      <div className="revision-controls">
        <label>
          {t('reflog.branchName')}
          <input value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <input
            type="checkbox"
            checked={checkout}
            disabled={busy}
            onChange={(event) => setCheckout(event.target.checked)}
          />
          {t('reflog.checkout')}
        </label>
        <Button
          icon="git-branch"
          disabled={!selected || !name.trim() || busy}
          onClick={() => void recover()}
        >
          {t('reflog.recover')}
        </Button>
        <Button
          icon="copy"
          title={t('reflog.copy')}
          aria-label={t('reflog.copy')}
          disabled={!selected}
          onClick={() =>
            void rpc('copyText', repoId, { text: selected }).catch((error) =>
              setError(error.message),
            )
          }
        />
      </div>
    </Modal>
  );
}
