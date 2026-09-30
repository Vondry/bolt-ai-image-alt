<?php

declare(strict_types=1);

namespace Tomvondracek\AiAlt\Service;

/**
 * Works out which fields of a ContentType carry an image ALT input, and whether
 * those fields are localized.
 *
 * Mirrors Bolt's own rules:
 *  - `image` shows the alt input unless the field sets `alt: false`
 *    (`ImageField::includeAlt()`);
 *  - `imagelist` always shows it (`Imagelist.vue` passes `include-alt="true"`);
 *  - `collection` / `set` fields are reported when they contain such images,
 *    because their sub-fields inherit the parent's `localize`.
 */
final class FieldMetaProvider
{
    public const TYPE_IMAGE = 'image';
    public const TYPE_IMAGELIST = 'imagelist';

    /**
     * @param iterable<array-key, mixed> $fields the `fields` of a ContentType definition
     *
     * @return array<string, array{type: string, localized: bool}>
     */
    public function forFields(iterable $fields): array
    {
        $meta = [];

        foreach ($fields as $name => $definition) {
            if (! is_iterable($definition)) {
                continue;
            }

            $definition = self::toArray($definition);

            if (! self::hasAltImage($definition)) {
                continue;
            }

            $meta[(string) $name] = [
                'type' => is_string($definition['type'] ?? null) ? $definition['type'] : '',
                'localized' => ($definition['localize'] ?? false) === true,
            ];
        }

        return $meta;
    }

    /**
     * Top-level `image` / `imagelist` fields that have an alt input. These are
     * the fields the batch page can fill.
     *
     * @param iterable<array-key, mixed> $fields
     *
     * @return array<string, array{type: string, localized: bool}>
     */
    public function batchableFields(iterable $fields): array
    {
        return array_filter(
            $this->forFields($fields),
            static fn (array $meta): bool => in_array($meta['type'], [self::TYPE_IMAGE, self::TYPE_IMAGELIST], true)
        );
    }

    /**
     * @param array<array-key, mixed> $definition
     */
    public static function includesAlt(array $definition): bool
    {
        $type = $definition['type'] ?? null;

        if ($type === self::TYPE_IMAGELIST) {
            return true;
        }

        if ($type !== self::TYPE_IMAGE) {
            return false;
        }

        return ! array_key_exists('alt', $definition) || $definition['alt'] === true;
    }

    /**
     * @param array<array-key, mixed> $definition
     */
    private static function hasAltImage(array $definition): bool
    {
        if (self::includesAlt($definition)) {
            return true;
        }

        if (! in_array($definition['type'] ?? null, ['collection', 'set'], true)) {
            return false;
        }

        $children = $definition['fields'] ?? [];
        if (! is_iterable($children)) {
            return false;
        }

        foreach ($children as $child) {
            if (is_iterable($child) && self::hasAltImage(self::toArray($child))) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param iterable<array-key, mixed> $value
     *
     * @return array<array-key, mixed>
     */
    private static function toArray(iterable $value): array
    {
        return is_array($value) ? $value : iterator_to_array($value);
    }
}
