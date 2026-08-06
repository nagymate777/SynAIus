export type TranslationParameters = Record<string, string | number>;
export type TranslationDictionary = Record<string, string>;

export function createTranslator(dictionary: TranslationDictionary) {
  return (key: string, parameters: TranslationParameters = {}) => {
    const template = dictionary[key];
    if (template === undefined) return key;
    return Object.entries(parameters).reduce(
      (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)),
      template,
    );
  };
}
