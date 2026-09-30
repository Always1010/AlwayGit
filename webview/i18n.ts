import { useWorkbench } from './store';

export type Language = 'en' | 'zh-CN';
export const translate = (language: Language, english: string, chinese: string = english) => language === 'zh-CN' ? chinese : english;
export function useTranslation() {
  const language = useWorkbench(state => state.language);
  return (english: string, chinese: string = english) => translate(language, english, chinese);
}
