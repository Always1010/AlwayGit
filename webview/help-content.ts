/** The manual uses a small Markdown subset. Content is rendered as React text, never as HTML. */
export type ManualBlock =
  | { kind: 'heading'; level: number; text: string; anchors: string[] }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'image'; text: string; source: string }
  | { kind: 'code'; text: string };

export interface ManualSection {
  id: string;
  aliases: string[];
  title: string;
  level: number;
  chapterId: string;
  blocks: ManualBlock[];
  searchText: string;
}
export interface Manual { sections: ManualSection[]; screenshotNote: string }
export type HelpCategory = 'start' | 'tasks' | 'questions' | 'manual';

/** IDs are shared by both editions and do not depend on translated titles or chapter ordering. */
export const helpTopics: Record<Exclude<HelpCategory, 'manual'>, readonly string[]> = {
  start: ['quick-start', 'section-01-02', 'workbench-locations', 'workbench-instances', 'section-01-04', 'section-01-05', 'help-guide', 'section-12-01'],
  tasks: ['section-02-01', 'section-02-02', 'file-list-modes', 'section-03-01', 'section-03-02', 'section-03-04', 'selected-file-commit', 'section-03-05', 'section-03-06', 'section-04-01', 'section-04-02', 'section-04-04', 'section-04-05', 'section-05-02', 'section-05-03', 'section-08-02', 'section-08-03', 'section-07-02', 'section-07-03', 'section-06-02', 'section-06-03', 'section-09-01', 'tag-status', 'section-09-02', 'section-09-03', 'section-10-01', 'section-13-01', 'section-13-02', 'section-11-01', 'shortcut-settings'],
  questions: ['section-11-04', 'section-11-02', 'section-07-04', 'section-07-06', 'section-11-05', 'workbench-instances', 'section-13-02', 'help-guide'],
};

export function blockText(block: ManualBlock): string {
  if (block.kind === 'list') return block.items.join(' ');
  if (block.kind === 'table') return block.rows.flat().join(' ');
  return block.text;
}

export function parseManual(markdown: string): Manual {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: ManualBlock[] = [];
  let anchors: string[] = [];
  const isBoundary = (line: string) => !line.trim() || /^(?:<a id=|#{1,6} |!\[|\||\d+\. |[-*] |```)/.test(line);
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const anchor = line.match(/^<a id="([a-zA-Z0-9_-]+)"><\/a>$/);
    if (anchor) { anchors.push(anchor[1]); index++; continue; }
    const heading = line.match(/^(#{1,6}) (.+)$/);
    if (heading) { blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2], anchors }); anchors = []; index++; continue; }
    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) { blocks.push({ kind: 'image', text: image[1], source: image[2] }); index++; continue; }
    if (line.startsWith('```')) {
      const code: string[] = []; index++;
      while (index < lines.length && !lines[index].startsWith('```')) code.push(lines[index++]);
      index++; blocks.push({ kind: 'code', text: code.join('\n') }); continue;
    }
    if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index].startsWith('|')) {
        const row = lines[index++].trim();
        if (!/^\|(?:\s*:?-+:?\s*\|)+$/.test(row)) rows.push(row.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()));
      }
      blocks.push({ kind: 'table', rows }); continue;
    }
    const list = line.match(/^(\d+\.|[-*]) (.+)$/);
    if (list) {
      const ordered = /^\d/.test(list[1]), items: string[] = [];
      const pattern = ordered ? /^\d+\. (.+)$/ : /^[-*] (.+)$/;
      while (index < lines.length) { const item = lines[index].match(pattern); if (!item) break; items.push(item[1]); index++; }
      blocks.push({ kind: 'list', ordered, items }); continue;
    }
    const paragraph = [line.trim()]; index++;
    while (index < lines.length && !isBoundary(lines[index])) paragraph.push(lines[index++].trim());
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }
  const sections: ManualSection[] = [];
  let chapterId = '';
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.kind !== 'heading' || !block.anchors.length) continue;
    if (block.level === 2) chapterId = block.anchors[0];
    let end = index + 1;
    while (end < blocks.length) { const next = blocks[end]; if (next.kind === 'heading' && next.level <= block.level) break; end++; }
    const content = blocks.slice(index + 1, end);
    sections.push({ id: block.anchors[0], aliases: block.anchors, title: block.text, level: block.level, chapterId, blocks: content, searchText: [block.text, ...content.map(blockText)].join(' ').toLocaleLowerCase() });
  }
  const note = blocks.find(block => block.kind === 'paragraph' && /\*\*(截图说明|About the screenshots)/.test(block.text));
  return { sections, screenshotNote: note && note.kind === 'paragraph' ? note.text : '' };
}

export function findManualSection(manual: Manual, id: string): ManualSection | undefined {
  return manual.sections.find(section => section.aliases.includes(id));
}

export function topicsFor(manual: Manual, category: HelpCategory, query = ''): ManualSection[] {
  const topics = category === 'manual'
    ? manual.sections.filter(section => section.level === 2)
    : helpTopics[category].flatMap(id => { const section = findManualSection(manual, id); return section ? [section] : []; });
  const normalized = query.trim().toLocaleLowerCase();
  return normalized ? topics.filter(section => section.searchText.includes(normalized)) : topics;
}
