import type { FieldMeta } from './types';

/**
 * Which language an alt has to be written in. Mirrors
 * `Tvondracek\AiAlt\Service\LocaleResolver` on the PHP side.
 */

/** `cs_CZ` / `cs-CZ` → `cs` (BCP 47 base language, as the Translator API wants it). */
export function baseLanguage(locale: string | null | undefined): string {
    return (locale ?? '').trim().split(/[_-]/)[0]?.toLowerCase() ?? '';
}

/**
 * `fields[gallery][0][alt]` → `gallery`, `collections[blocks][image][2][alt]` → `blocks`.
 * The top-level field decides whether the value is localized.
 */
export function topLevelFieldName(inputName: string): string | null {
    const match = /^[a-z_]+\[([^\]]+)\]/i.exec(inputName);

    return match?.[1] ?? null;
}

export function resolveTargetLocale(
    inputName: string,
    fieldMeta: Record<string, FieldMeta>,
    editLocale: string | null,
    defaultLocale: string | null,
): string {
    const field = topLevelFieldName(inputName);
    const localized = field !== null && fieldMeta[field]?.localized === true;
    const locale = localized && editLocale ? editLocale : defaultLocale || editLocale || 'en';

    return baseLanguage(locale) || 'en';
}

/** The edit locale Bolt puts in the edit form as `<input name="_edit_locale">`. */
export function readEditLocale(root: ParentNode = document): string | null {
    const input = root.querySelector<HTMLInputElement>('input[name="_edit_locale"]');

    return input?.value ? input.value : null;
}
