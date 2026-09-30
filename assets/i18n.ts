import en from './langs/en.json';

/**
 * UI strings live in `langs/<language>.json`, one file per language, like the
 * `langs/` folders of the bolt/redactor and bolt/article extensions. `en.json`
 * is the canonical set; a key missing elsewhere falls back to English. Adding
 * a language = adding a file. The PHP side reads the same files (batch page
 * title, see `Tomvondracek\AiAlt\UiTranslations`).
 */
export type MessageKey = keyof typeof en;

type Catalogue = Partial<Record<MessageKey, string>>;

const catalogues: Record<string, Catalogue> = Object.fromEntries(
    Object.entries(import.meta.glob<Catalogue>('./langs/*.json', { eager: true, import: 'default' })).map(([path, catalogue]) => [
        path.slice(path.lastIndexOf('/') + 1, -'.json'.length),
        catalogue,
    ]),
);

/** Languages with a catalogue, e.g. `['cs', 'de', 'en', …]`. */
export const supportedLanguages = Object.keys(catalogues).sort((a, b) => a.localeCompare(b));

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export function createTranslator(uiLocale: string | null | undefined): Translate {
    const language = (uiLocale ?? 'en').split(/[_-]/)[0]?.toLowerCase() ?? 'en';
    const catalogue = catalogues[language] ?? en;

    return (key, params = {}) =>
        (catalogue[key] ?? en[key]).replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
