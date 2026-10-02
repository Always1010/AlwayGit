import english from '../docs/USER_MANUAL.en.md?raw';
import chinese from '../docs/USER_MANUAL.zh-CN.md?raw';
import { parseManual } from './help-content';
import type { Language } from './i18n';

export const manuals = { en: parseManual(english), 'zh-CN': parseManual(chinese) };
const images = import.meta.glob<string>('../docs/images/user-manual/*.png', { eager: true, query: '?url', import: 'default' });
export function manualImage(source: string): string | undefined {
  return source.startsWith('images/user-manual/') ? images[`../docs/${source}`] : undefined;
}
export const getManual = (language: Language) => manuals[language];
