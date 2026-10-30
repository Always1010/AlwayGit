import { useEffect, useState } from 'react';
import type { CommitDetails, DiffTarget } from '../src/protocol/types';
import { Button, Empty } from './ui';
import { useTranslation } from './i18n';
import { rpc } from './rpc';
import { DiffPreview } from './DiffPreview';
/** Local inspection never changes Graph/File History selection, drafts or the main Diff. */
export function RevisionInspector({ repoId, oid }: { repoId: string; oid?: string }) {
  const t = useTranslation(),
    [details, setDetails] = useState<CommitDetails>(),
    [parent, setParent] = useState<string>(),
    [file, setFile] = useState<string>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    setParent(undefined);
    setFile(undefined);
  }, [repoId, oid]);
  useEffect(() => {
    const controller = new AbortController();
    setDetails(undefined);
    setError(undefined);
    if (oid)
      void rpc<CommitDetails>(
        'inspectDetails',
        repoId,
        { oid, parent },
        { signal: controller.signal },
      )
        .then((value) => {
          setDetails(value);
          setFile((current) =>
            value.files.some((f) => f.path === current) ? current : value.files[0]?.path,
          );
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(error.message);
        });
    return () => controller.abort();
  }, [repoId, oid, parent]);
  const current = details?.files.find((item) => item.path === file),
    target: DiffTarget | undefined =
      details && current
        ? {
            kind: 'commit',
            oid: details.commit.oid,
            path: current.path,
            previousPath: current.previousPath,
            parent: details.parent,
          }
        : undefined;
  const native = () => {
    if (target) void rpc('diff', repoId, target).catch((error) => setError(error.message));
  };
  const edit = () => {
    if (target)
      void rpc('openFile', repoId, { path: target.path }).catch((error) => setError(error.message));
  };
  return (
    <div className="revision-inspector">
      {error && (
        <p role="alert">
          {!details && t('reflog.missing')} {error}
        </p>
      )}
      {!oid ? (
        <Empty title={t('reflog.inspect')} />
      ) : (
        details && (
          <>
            <strong>{details.commit.subject}</strong>
            <small>
              {details.commit.author} · {details.commit.oid}
            </small>
            <pre className="revision-message">{details.body}</pre>
            {details.commit.parents.length > 1 && (
              <label>
                {t('reflog.parent')}
                <select value={details.parent} onChange={(event) => setParent(event.target.value)}>
                  {details.commit.parents.map((value) => (
                    <option key={value} value={value}>
                      {value.slice(0, 12)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="revision-files" role="group" aria-label={t('reflog.files')}>
              {details.files.map((item) => (
                <button
                  key={item.path}
                  className="button"
                  aria-pressed={item.path === file}
                  onClick={() => setFile(item.path)}
                >
                  {item.status} {item.path}
                </button>
              ))}
            </div>
            <div className="revision-preview">
              <DiffPreview isolated={{ repoId, target }} native={native} edit={edit} />
            </div>
          </>
        )
      )}
    </div>
  );
}
