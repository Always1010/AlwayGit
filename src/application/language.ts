import * as vscode from 'vscode';
import { translate, type Language, type MessageArgs, type MessageKey } from '../i18n';

export type { Language } from '../i18n';
export function preferredLanguage(): Language {
  const configured = vscode.workspace.getConfiguration('alwaygit').get<string>('language', 'auto');
  return configured === 'zh-CN' || configured === 'auto' && /^zh/i.test(vscode.env.language) ? 'zh-CN' : 'en';
}
export function hostText<K extends MessageKey>(language: Language | undefined, key: K, ...args: MessageArgs<K>): string {
  return translate(language ?? preferredLanguage(), key, ...args);
}
