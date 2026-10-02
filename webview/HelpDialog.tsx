import { Fragment, useEffect, useRef, useState } from 'react';
import { Button, Icon, Modal } from './ui';

import { useWorkbench } from './store';
import { useTranslation } from './i18n';

import { findManualSection, topicsFor } from './help-content';
import type { HelpCategory, ManualBlock } from './help-content';
import { getManual, manualImage } from './help-manuals';
import './help.css';

/** Only in-manual links are actionable. Git commands, file URLs and raw HTML remain plain text. */
function Inline({ text, navigate }: { text: string; navigate(id: string): void }) {
  const pattern = /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)]+)\)|\*([^*\n]+)\*/g;
  const nodes = []; let end = 0;
  for (const match of text.matchAll(pattern)) {
    nodes.push(text.slice(end, match.index));
    const key = match.index;
    if (match[1]) nodes.push(<strong key={key}>{match[1]}</strong>);
    else if (match[2]) nodes.push(<code key={key}>{match[2]}</code>);
    else if (match[3]) nodes.push(match[4].startsWith('#') ? <button type="button" className="help-link" key={key} onClick={() => navigate(match[4].slice(1))}>{match[3]}</button> : <span key={key}>{match[3]}</span>);
    else nodes.push(<em key={key}>{match[5]}</em>);
    end = match.index! + match[0].length;
  }
  nodes.push(text.slice(end));
  return <>{nodes}</>;
}

function ContentBlock({ block, navigate }: { block: ManualBlock; navigate(id: string): void }) {
  const inline = (text: string) => <Inline text={text} navigate={navigate}/>;
  if (block.kind === 'heading') return <><Anchors ids={block.anchors}/><h3>{inline(block.text)}</h3></>;
  if (block.kind === 'paragraph') return <p>{inline(block.text)}</p>;
  if (block.kind === 'code') return <pre><code>{block.text}</code></pre>;
  if (block.kind === 'list') {
    const items = block.items.map((item, index) => <li key={index}>{inline(item)}</li>);
    return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
  }
  if (block.kind === 'table') return <div className="help-table"><table><thead><tr>{block.rows[0]?.map((cell, index) => <th key={index}>{inline(cell)}</th>)}</tr></thead><tbody>{block.rows.slice(1).map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>;
  const source = manualImage(block.source);
  return source ? <figure><img src={source} alt={block.text} loading="lazy" decoding="async"/><figcaption>{block.text}</figcaption></figure> : <p className="muted">{block.text}</p>;
}

function Anchors({ ids }: { ids: readonly string[] }) {
  return <>{ids.map(id => <span key={id} data-help-anchor={id}/>)}</>;
}

export default function HelpDialog({ onClose }: { onClose(): void }) {
  const language = useWorkbench(state => state.language), t = useTranslation();
  const manual = getManual(language), [category, setCategory] = useState<HelpCategory>('start'), [selected, setSelected] = useState('quick-start'), [query, setQuery] = useState(''), [anchor, setAnchor] = useState<string>();
  const article = useRef<HTMLElement>(null);
  const topics = topicsFor(manual, category, query), section = topics.find(topic => topic.id === selected) ?? topics[0];
  const categories: { id: HelpCategory; label: string; icon: string }[] = [
    { id: 'start', label: t("help.quickStart"), icon: 'rocket' },
    { id: 'tasks', label: t("help.commonTasks"), icon: 'checklist' },
    { id: 'questions', label: t("help.commonQuestions"), icon: 'question' },
    { id: 'manual', label: t("help.fullManual"), icon: 'book' },
  ];
  useEffect(() => {
    const container = article.current;
    if (!container) return;
    container.scrollTop = 0;
    if (anchor) [...container.querySelectorAll<HTMLElement>('[data-help-anchor]')].find(element => element.dataset.helpAnchor === anchor)?.scrollIntoView({ block: 'start' });
  }, [section?.id, language, anchor]);
  const chooseCategory = (next: HelpCategory) => { setCategory(next); setSelected(topicsFor(manual, next)[0]?.id ?? 'quick-start'); setQuery(''); setAnchor(undefined); };
  const navigate = (id: string) => {
    const target = findManualSection(manual, id);
    if (!target) return;
    setCategory('manual'); setQuery(''); setSelected(target.chapterId); setAnchor(id);
  };
  return <Modal title={t("help.helpGuide")} className="help-dialog" onClose={onClose} footer={<><span className="help-footer-note">{t("help.availableOfflineIncludedWithAlwayGit")}</span><Button onClick={onClose}>{t("common.close")}</Button></>}>
    <div className="help-categories" role="group" aria-label={t("help.helpCategories")}>{categories.map(item => <Button key={item.id} icon={item.icon} aria-pressed={category === item.id} className={category === item.id ? 'active' : ''} onClick={() => chooseCategory(item.id)}>{item.label}</Button>)}</div>
    <div className="help-layout">
      <aside className="help-sidebar">
        <label className="help-search"><Icon name="search"/><input type="search" aria-label={t("help.filterHelpTopics")} placeholder={t("help.filterThisCategory")} value={query} onChange={event => setQuery(event.target.value)}/></label>
        <nav aria-label={t("help.helpTopics")}>{topics.map(topic => <button type="button" key={topic.id} className={`help-topic${section?.id === topic.id ? ' selected' : ''}`} aria-current={section?.id === topic.id ? 'page' : undefined} onClick={() => { setSelected(topic.id); setAnchor(undefined); }}>{topic.title}</button>)}</nav>
        {!topics.length && <p className="help-no-results" role="status">{t("help.noMatchingTopicsTryAnotherKeywordOrCategory")}</p>}
      </aside>
      <article className="help-content" ref={article} tabIndex={0} aria-label={section?.title ?? t("help.helpContent")}>
        {section ? <><Anchors ids={section.aliases}/><h2>{section.title}</h2>{section.blocks.some(block => block.kind === 'image') && <div className="help-screenshot-note"><Inline text={manual.screenshotNote} navigate={navigate}/></div>}{section.blocks.map((block, index) => <Fragment key={`${section.id}-${index}`}><ContentBlock block={block} navigate={navigate}/></Fragment>)}{category !== 'manual' && section.level !== 2 && <Button icon="book" className="help-read-more" onClick={() => navigate(section.id)}>{t("help.readTheFullChapter")}</Button>}</> : <p className="muted">{t("help.clearTheFilterToBrowseTheGuide")}</p>}
      </article>
    </div>
  </Modal>;
}
