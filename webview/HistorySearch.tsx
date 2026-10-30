import { useEffect, useState } from 'react';
import { historySearchSchema, type HistorySearchFilters } from '../src/protocol/history-search';
import { Button } from './ui';
import { useTranslation } from './i18n';

export function HistorySearch({
  value,
  onApply,
}: {
  value?: HistorySearchFilters;
  onApply(value?: HistorySearchFilters): void;
}) {
  const t = useTranslation(),
    [draft, setDraft] = useState<HistorySearchFilters>(value ?? {}),
    [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(value ?? {});
    setInvalid(false);
  }, [value]);
  const labels = {
    author: t('history.search.author'),
    committerAfter: t('history.search.committerAfter'),
    committerBefore: t('history.search.committerBefore'),
    path: t('history.search.path'),
    code: t('history.search.code'),
    commitId: t('history.search.commitId'),
  };
  const field = (
    key: 'author' | 'committerAfter' | 'committerBefore' | 'path' | 'code' | 'commitId',
    type = 'text',
  ) => (
    <label>
      <span>{labels[key]}</span>
      <input
        type={type}
        value={draft[key] ?? ''}
        maxLength={key === 'path' ? 4096 : 1000}
        onChange={(event) => {
          setInvalid(false);
          setDraft({ ...draft, [key]: event.target.value || undefined });
        }}
      />
    </label>
  );
  return (
    <form
      className="history-search-filters"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = historySearchSchema.safeParse(draft);
        if (!parsed.success) {
          setInvalid(true);
          return;
        }
        onApply(parsed.data);
        setInvalid(false);
      }}
    >
      <p className="history-search-help">{t('history.search.help')}</p>
      <div className="history-search-grid">
        {field('author')}
        {field('path')}
        {field('committerAfter', 'date')}
        {field('committerBefore', 'date')}
        {field('code')}
        {field('commitId')}
      </div>
      <div className="inline-actions">
        <label className="history-code-regex">
          <input
            type="checkbox"
            checked={!!draft.codeRegex}
            onChange={(event) => setDraft({ ...draft, codeRegex: event.target.checked })}
          />
          {t('history.search.regex')}
        </label>
        <Button type="submit" icon="search">
          {t('history.search.apply')}
        </Button>
        <Button
          type="button"
          icon="clear-all"
          className="icon-only"
          title={t('history.search.clear')}
          aria-label={t('history.search.clear')}
          onClick={() => {
            setDraft({});
            setInvalid(false);
            onApply(undefined);
          }}
        />
      </div>
      {invalid && <p role="alert">{t('history.search.invalid')}</p>}
    </form>
  );
}
