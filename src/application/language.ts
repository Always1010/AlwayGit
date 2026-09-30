import * as vscode from 'vscode';

export type Language = 'en' | 'zh-CN';
export function preferredLanguage(): Language {
  const configured = vscode.workspace.getConfiguration('alwaygit').get<string>('language', 'auto');
  return configured === 'zh-CN' || configured === 'auto' && /^zh/i.test(vscode.env.language) ? 'zh-CN' : 'en';
}
export function hostText(english: string, chinese: string, language = preferredLanguage()): string {
  return language === 'zh-CN' ? chinese : english;
}
