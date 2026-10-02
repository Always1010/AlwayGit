import { createInstance } from 'i18next';
import { catalog, type MessageParameters } from './generated';

export type Language = 'en' | 'zh-CN';
export type MessageKey = keyof MessageParameters;
export type StaticMessageKey = { [K in MessageKey]: keyof MessageParameters[K] extends never ? K : never }[MessageKey];
export type ParameterValue = string | number | boolean | null | undefined;
export type MessageArgs<K extends MessageKey> = keyof MessageParameters[K] extends never ? [] : [parameters: MessageParameters[K]];
export type Translator = <K extends MessageKey>(key: K, ...args: MessageArgs<K>) => string;
export interface MessageDescriptor { key: MessageKey; parameters?: Record<string, ParameterValue> }

const resources: Record<Language, { translation: Record<string, string> }> = { en: { translation: {} }, 'zh-CN': { translation: {} } };
for (const [key, entry] of Object.entries(catalog)) {
  for (const language of ['en', 'zh-CN'] as const) {
    const value: string | Record<string, string> = entry[language];
    if (typeof value === 'string') resources[language].translation[key] = value;
    else for (const [form, text] of Object.entries(value)) resources[language].translation[`${key}_${form}`] = text;
  }
}
const engine = createInstance();
void engine.init({ resources, lng: 'en', fallbackLng: 'en', supportedLngs: ['en', 'zh-CN'], initAsync: false, keySeparator: false, nsSeparator: false, interpolation: { escapeValue: false, skipOnVariables: true } });

function render(key: MessageKey, parameters: Record<string, ParameterValue> | undefined, language: Language): string {
  const entry = catalog[key];
  // Untranslated English plurals still follow English rules in the Chinese UI.
  const locale = typeof entry.en !== 'string' && JSON.stringify(entry.en) === JSON.stringify(entry['zh-CN']) ? 'en' : language;
  return engine.t(key, { ...parameters, lng: locale });
}
export function isMessageDescriptor(value: unknown): value is MessageDescriptor {
  return !!value && typeof value === 'object' && 'key' in value && typeof value.key === 'string' && Object.hasOwn(catalog, value.key);
}

/** Every call carries its language; one panel cannot change another panel's locale. */
export function translate<K extends MessageKey>(language: Language, key: K, ...args: MessageArgs<K>): string {
  return render(key, args[0], language);
}
export function translator(language: Language): Translator {
  return ((key: MessageKey, parameters?: Record<string, ParameterValue>) => render(key, parameters, language)) as Translator;
}
export function message<K extends MessageKey>(key: K, ...args: MessageArgs<K>): MessageDescriptor {
  return { key, ...(args[0] ? { parameters: args[0] } : {}) };
}
export function renderMessage(value: MessageDescriptor, language: Language = 'en'): string {
  return render(value.key, value.parameters, language);
}
export class MessageError extends Error {
  constructor(public readonly localizedMessage: MessageDescriptor) { super(renderMessage(localizedMessage)); this.name = 'MessageError'; }
}
