<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt;

/**
 * Server-side access to the UI strings in `assets/langs/<language>.json`, the
 * same files the browser code uses (see `assets/i18n.ts`). A missing language
 * or key falls back to English.
 */
final class UiTranslations
{
    /** @var array<string, array<string, string>> */
    private static array $catalogues = [];

    public static function directory(): string
    {
        return dirname(__DIR__) . '/assets/langs';
    }

    /**
     * @param string|null $locale e.g. `cs`, `cs_CZ`, `pt-BR`
     */
    public static function translate(string $key, ?string $locale): string
    {
        return self::catalogue(self::language($locale))[$key] ?? self::catalogue('en')[$key] ?? $key;
    }

    /**
     * `cs_CZ` / `cs-CZ` → `cs`; anything that is not a plain language code
     * (and so could point outside the langs folder) → `en`.
     */
    public static function language(?string $locale): string
    {
        $language = mb_strtolower(explode('_', str_replace('-', '_', trim((string) $locale)))[0]);

        return preg_match('/^[a-z]{2,3}$/', $language) === 1 ? $language : 'en';
    }

    /**
     * @return array<string, string>
     */
    private static function catalogue(string $language): array
    {
        if (isset(self::$catalogues[$language])) {
            return self::$catalogues[$language];
        }

        $json = @file_get_contents(self::directory() . '/' . $language . '.json');
        $data = $json === false ? null : json_decode($json, true);

        return self::$catalogues[$language] = is_array($data) ? array_filter($data, is_string(...)) : [];
    }
}
