<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Service;

/**
 * Decides which language an alt text has to be written in.
 *
 * Keep in sync with `assets/locale.ts`, which applies the same rules in the
 * editor.
 */
final class LocaleResolver
{
    /**
     * The language of non-localized fields: the ContentType's first locale if
     * it defines `locales`, otherwise the site default (`%locale%`).
     *
     * @param iterable<array-key, mixed>|null $contentTypeLocales
     */
    public static function defaultLocale(?iterable $contentTypeLocales, string $siteDefaultLocale): string
    {
        foreach ($contentTypeLocales ?? [] as $locale) {
            if (is_string($locale) && $locale !== '') {
                return $locale;
            }
        }

        return $siteDefaultLocale;
    }

    /**
     * @param string $storageLocale the locale the value is stored under
     */
    public static function textLocale(bool $localized, string $storageLocale, string $defaultLocale): string
    {
        return $localized && $storageLocale !== '' ? $storageLocale : $defaultLocale;
    }

    /**
     * `cs_CZ` / `cs-CZ` → `cs`, the form the Translator API expects.
     */
    public static function baseLanguage(string $locale): string
    {
        $base = preg_split('/[_-]/', mb_trim($locale))[0] ?? '';

        return mb_strtolower($base);
    }
}
