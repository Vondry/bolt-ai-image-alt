<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Tests;

use Bolt\Configuration\Content\ContentType;
use Bolt\Entity\Content;
use Bolt\Entity\Field;
use Bolt\Entity\Field\ImageField;
use Bolt\Entity\Field\ImagelistField;
use Bolt\Entity\FieldTranslation;
use Tvondracek\AiAlt\Service\ContentSource;

/**
 * Builds real Bolt entities (no database) for tests.
 */
final class Fixtures
{
    /**
     * A ContentType with a non-localized `image`, a localized `gallery`, an
     * `image` with `alt: false` and a text field.
     *
     * @param array<string, mixed> $overrides
     */
    public static function contentType(array $overrides = []): ContentType
    {
        /** @var ContentType $contentType deepMake() returns static */
        $contentType = ContentType::deepMake(array_replace([
            'name' => 'Pages',
            'slug' => 'pages',
            'singular_slug' => 'page',
            'singular_name' => 'Page',
            'locales' => ['cs', 'en'],
            'fields' => [
                'title' => ['type' => 'text', 'label' => 'Title', 'localize' => true],
                'image' => ['type' => 'image', 'label' => 'Main image', 'localize' => false],
                'gallery' => ['type' => 'imagelist', 'label' => 'Gallery', 'localize' => true],
                'logo' => ['type' => 'image', 'label' => 'Logo', 'alt' => false, 'localize' => false],
            ],
        ], $overrides));

        return $contentType;
    }

    public static function content(int $id, ?ContentType $contentType = null): Content
    {
        $contentType ??= self::contentType();

        $content = new Content();
        $content->setId($id);
        $content->setContentType($contentType->getSlug());
        $content->setDefinition($contentType);

        return $content;
    }

    /**
     * @param array<string, array<array-key, mixed>> $valuesByLocale
     */
    public static function addField(Content $content, Field $field, string $name, array $valuesByLocale, ?string $defaultLocale = null): Field
    {
        $field->setName($name);

        if ($defaultLocale !== null) {
            $field->setDefaultLocale($defaultLocale);
        }

        foreach ($valuesByLocale as $locale => $value) {
            $translation = new FieldTranslation();
            $translation->setLocale($locale);
            $translation->setValue($value);
            $field->addTranslation($translation);
        }

        $content->addField($field);

        return $field;
    }

    /**
     * @param array<string, array<array-key, mixed>> $valuesByLocale
     */
    public static function addImage(Content $content, string $name, array $valuesByLocale, ?string $defaultLocale = null): Field
    {
        return self::addField($content, new ImageField(), $name, $valuesByLocale, $defaultLocale);
    }

    /**
     * @param array<string, array<array-key, mixed>> $valuesByLocale
     */
    public static function addImagelist(Content $content, string $name, array $valuesByLocale): Field
    {
        return self::addField($content, new ImagelistField(), $name, $valuesByLocale);
    }

    /**
     * @param list<Content> $contents
     */
    public static function source(array $contents): ContentSource
    {
        return new class($contents) implements ContentSource {
            /**
             * @param list<Content> $contents
             */
            public function __construct(
                private readonly array $contents,
            ) {
            }

            public function byContentType(string $contentType): iterable
            {
                return array_values(array_filter($this->contents, static fn (Content $c): bool => $c->getContentType() === $contentType));
            }

            public function find(int $id): ?Content
            {
                foreach ($this->contents as $content) {
                    if ($content->getId() === $id) {
                        return $content;
                    }
                }

                return null;
            }
        };
    }
}
