import { useWorkbench } from './store';
import { translator } from '../src/i18n';

export { translate } from '../src/i18n';
export type { Language, MessageKey, StaticMessageKey, Translator } from '../src/i18n';
export { uiText } from './text';
export function useTranslation() {
  const language = useWorkbench(state => state.language);
  return translator(language);
}
