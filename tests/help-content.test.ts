import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { findManualSection, helpTopics, parseManual, topicsFor } from '../webview/help-content';

describe('manual-backed help', () => {
  it('keeps bilingual topic IDs, internal links and packaged screenshot sources valid', () => {
    const imageSets: string[][] = [];
    const screenshotVersions: (string | undefined)[] = [];
    const editions = ['zh-CN', 'en'].map(language => {
      const markdown = readFileSync(resolve(`docs/USER_MANUAL.${language}.md`), 'utf8');
      const manual = parseManual(markdown);
      const aliases = manual.sections.flatMap(section => section.aliases);
      expect(new Set(aliases).size).toBe(aliases.length);
      for (const id of Object.values(helpTopics).flat()) expect(findManualSection(manual, id), id).toBeDefined();
      for (const link of markdown.matchAll(/(?<!!)\[[^\]]+\]\(#([^)]+)\)/g)) expect(findManualSection(manual, link[1]), link[1]).toBeDefined();
      for (const section of manual.sections) for (const block of section.blocks) if (block.kind === 'image') {
        expect(block.source).toMatch(/^images\/user-manual\/figure-\d{2}\.png$/);
        expect(existsSync(resolve('docs', block.source))).toBe(true);
        expect(readFileSync(resolve('docs', block.source)).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      }
      imageSets.push([...new Set([...markdown.matchAll(/!\[[^\]]*\]\((images\/user-manual\/[^)]+)\)/g)].map(match => match[1]))].sort());
      screenshotVersions.push(manual.screenshotNote.match(/\b\d+\.\d+\.\d+\b/)?.[0]);
      expect(screenshotVersions.at(-1)).toBeDefined();
      expect(findManualSection(manual, 'section-01-06')?.id).toBe('quick-start');
      return aliases;
    });
    expect(editions[0]).toEqual(editions[1]);
    expect(screenshotVersions[0]).toBe(screenshotVersions[1]);
    expect(imageSets[0]).toEqual(imageSets[1]);
    expect(imageSets[0]).toEqual(readdirSync(resolve('docs/images/user-manual')).map(name => `images/user-manual/${name}`).sort());
  });

  it('extracts complete sections without treating arbitrary HTML as executable content', () => {
    const manual = parseManual('<a id="chapter"></a>\n## Chapter\n\n<a id="task"></a>\n### Task\n\n<script>alert(1)</script>\n\n1. First\n2. Second\n\n| Name | Value |\n| --- | --- |\n| A | B |\n\n<a id="other"></a>\n### Other\n\nEnd');
    const task = findManualSection(manual, 'task')!;
    expect(task.chapterId).toBe('chapter');
    expect(task.blocks).toEqual([
      { kind: 'paragraph', text: '<script>alert(1)</script>' },
      { kind: 'list', ordered: true, items: ['First', 'Second'] },
      { kind: 'table', rows: [['Name', 'Value'], ['A', 'B']] },
    ]);
    expect(task.searchText).not.toContain('End');
    expect(findManualSection(manual, 'chapter')?.blocks).toContainEqual({ kind: 'paragraph', text: 'End' });
  });

  it('filters task content as well as titles and supports full chapter navigation', () => {
    const manual = parseManual(readFileSync(resolve('docs/USER_MANUAL.en.md'), 'utf8'));
    expect(topicsFor(manual, 'tasks', '  INDEX  ').length).toBeGreaterThan(0);
    expect(topicsFor(manual, 'manual').every(section => section.level === 2)).toBe(true);
    expect(topicsFor(manual, 'questions', 'no-such-topic-12345')).toEqual([]);
  });
});
