import { translate, type Language, type MessageArgs, type MessageKey } from '../src/i18n';
export { translate } from '../src/i18n';

let languageReader: () => Language = () => 'en';
/** Installed once by this Webview's store; pure presenters also work without a browser bridge. */
export function setLanguageReader(reader: () => Language): void { languageReader = reader; }
export function uiText<K extends MessageKey>(key: K, ...args: MessageArgs<K>): string {
  return translate(languageReader(), key, ...args);
}
