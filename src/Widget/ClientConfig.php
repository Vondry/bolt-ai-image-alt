<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Widget;

use Tvondracek\AiAlt\AiAltConfig;
use Tvondracek\AiAlt\Service\FieldMetaProvider;
use Tvondracek\AiAlt\Service\LocaleResolver;

/**
 * Builds the JSON the browser code reads from `#ai-alt-config`.
 */
final class ClientConfig
{
    /**
     * Where `Extension::install()` copies the built assets to.
     */
    public const ASSET_BASE = '/extensions/ai-alt';

    /**
     * @param array<string, mixed> $extra
     *
     * @return array<string, mixed>
     */
    public static function build(AiAltConfig $config, array $extra = []): array
    {
        return array_merge($config->toClientArray(), $extra);
    }

    /**
     * Config for the content edit page, or null when the extension has nothing
     * to do for this ContentType.
     *
     * @param iterable<array-key, mixed>|null $contentType the ContentType definition
     *
     * @return array<string, mixed>|null
     */
    public static function forEditor(
        AiAltConfig $config,
        ?iterable $contentType,
        string $siteDefaultLocale,
        string $uiLocale,
        string $assetVersion = '',
        string $basePath = '',
        FieldMetaProvider $fieldMetaProvider = new FieldMetaProvider(),
    ): ?array {
        if (! $config->enabled || $contentType === null) {
            return null;
        }

        $definition = is_array($contentType) ? $contentType : iterator_to_array($contentType);
        $slug = $definition['slug'] ?? null;

        if (! is_string($slug) || ! $config->isContentTypeAllowed($slug)) {
            return null;
        }

        $fields = $definition['fields'] ?? [];
        $fieldMeta = is_iterable($fields) ? $fieldMetaProvider->forFields($fields) : [];

        if ($fieldMeta === []) {
            return null;
        }

        $locales = $definition['locales'] ?? null;

        return self::build($config, [
            'contentType' => $slug,
            'defaultLocale' => LocaleResolver::defaultLocale(is_iterable($locales) ? $locales : null, $siteDefaultLocale),
            'fieldMeta' => $fieldMeta,
            ...self::paths($basePath),
            'assetVersion' => $assetVersion,
            'uiLocale' => $uiLocale,
        ]);
    }

    /**
     * Public URLs, prefixed with the request's base path so Bolt can live in a
     * subdirectory (`https://example.com/cms/`).
     *
     * @return array{basePath: string, assetBase: string, thumbsBase: string}
     */
    public static function paths(string $basePath): array
    {
        $basePath = mb_rtrim($basePath, '/');

        return [
            // Also used to resolve a path-style `model_host` (`/ai-alt-models`).
            'basePath' => $basePath,
            'assetBase' => $basePath . self::ASSET_BASE,
            'thumbsBase' => $basePath . '/thumbs',
        ];
    }

    /**
     * JSON that is safe to embed in a `<script type="application/json">`.
     *
     * @param array<string, mixed> $config
     */
    public static function toJson(array $config): string
    {
        return json_encode(
            $config,
            JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
        );
    }
}
