<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Service;

use Bolt\Configuration\Config;
use Bolt\Entity\Content;
use Bolt\Entity\Field;
use Bolt\Entity\FieldTranslation;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Throwable;
use Tvondracek\AiAlt\AiAltConfigLoader;

/**
 * Finds images in top-level `image` / `imagelist` fields that have a file but
 * no alt text, for the batch page.
 *
 * @phpstan-type MissingAlt array{
 *     key: string,
 *     contentId: int,
 *     contentType: string,
 *     title: string,
 *     field: string,
 *     fieldLabel: string,
 *     index: int|null,
 *     locale: string,
 *     textLocale: string,
 *     filename: string
 * }
 * @phpstan-type ContentTypeInfo array{
 *     slug: string,
 *     name: string,
 *     defaultLocale: string,
 *     locales: list<string>,
 *     fields: array<string, array{type: string, localized: bool, label: string}>
 * }
 */
class MissingAltFinder
{
    public function __construct(
        private readonly Config $boltConfig,
        private readonly ContentSource $contentSource,
        private readonly FieldMetaProvider $fieldMetaProvider,
        private readonly AiAltConfigLoader $configLoader,
        private readonly ImageFileLocator $fileLocator,
        #[Autowire(param: 'locale')]
        private readonly string $siteDefaultLocale = 'en',
    ) {
    }

    /**
     * ContentTypes the batch page can work on: allowed by config and having
     * at least one image field with an alt text.
     *
     * @return array<string, ContentTypeInfo>
     */
    public function contentTypes(): array
    {
        $config = $this->configLoader->load();
        $result = [];

        $contentTypes = $this->boltConfig->get('contenttypes');
        if (! is_iterable($contentTypes)) {
            return [];
        }

        foreach ($contentTypes as $slug => $contentType) {
            $slug = (string) $slug;

            if (! is_iterable($contentType) || ! $config->isContentTypeAllowed($slug)) {
                continue;
            }

            $definition = is_array($contentType) ? $contentType : iterator_to_array($contentType);
            $fieldDefinitions = $definition['fields'] ?? [];
            $fields = is_iterable($fieldDefinitions) ? $this->fieldMetaProvider->batchableFields($fieldDefinitions) : [];

            if ($fields === []) {
                continue;
            }

            foreach (array_keys($fields) as $name) {
                $fields[$name]['label'] = self::fieldLabel($fieldDefinitions, $name);
            }

            $locales = $definition['locales'] ?? null;

            $result[$slug] = [
                'slug' => $slug,
                'name' => is_string($definition['name'] ?? null) ? $definition['name'] : $slug,
                'defaultLocale' => LocaleResolver::defaultLocale(is_iterable($locales) ? $locales : null, $this->siteDefaultLocale),
                'locales' => self::localeList($locales),
                'fields' => $fields,
            ];
        }

        return $result;
    }

    /**
     * @param string|null $contentType limit to one ContentType slug
     * @param (callable(Content): bool)|null $canEdit only records this returns true for
     * @param bool $withTitles building titles is expensive (`Content::getExtras()`); skip it when only counting
     *
     * @return list<MissingAlt>
     */
    public function find(?string $contentType = null, ?callable $canEdit = null, bool $withTitles = true): array
    {
        $items = [];

        foreach ($this->contentTypes() as $slug => $info) {
            if ($contentType !== null && $contentType !== '' && $slug !== $contentType) {
                continue;
            }

            foreach ($this->contentSource->byContentType($slug) as $content) {
                $found = $this->findInContent($content, $info, $withTitles);

                // Check permissions only for records with work, the voter is not free.
                if ($found !== [] && ($canEdit === null || $canEdit($content))) {
                    array_push($items, ...$found);
                }
            }
        }

        return $items;
    }

    /**
     * @param ContentTypeInfo $info
     *
     * @return list<MissingAlt>
     */
    public function findInContent(Content $content, array $info, bool $withTitles = true): array
    {
        $items = [];
        $contentId = (int) $content->getId();
        $title = null;

        foreach ($info['fields'] as $name => $meta) {
            if (! $content->hasField($name)) {
                continue;
            }

            $field = $content->getField($name);

            foreach (self::relevantTranslations($field, $meta['localized'], $info['locales']) as $translation) {
                $locale = (string) $translation->getLocale();

                foreach (AltValue::missing($meta['type'], $translation->getValue()) as $image) {
                    // Bolt's /thumbs route answers a missing file with a "404" placeholder
                    // (HTTP 200), which the model would happily describe.
                    if (! $this->fileLocator->exists($image['filename'])) {
                        continue;
                    }

                    $title ??= $withTitles ? self::title($content) : '';

                    $items[] = [
                        'key' => implode(':', [$contentId, $name, $image['index'] ?? '-', $locale]),
                        'contentId' => $contentId,
                        'contentType' => $info['slug'],
                        'title' => $title,
                        'field' => $name,
                        'fieldLabel' => $meta['label'],
                        'index' => $image['index'],
                        'locale' => $locale,
                        'textLocale' => LocaleResolver::textLocale($meta['localized'], $locale, $info['defaultLocale']),
                        'filename' => $image['filename'],
                    ];
                }
            }
        }

        return $items;
    }

    /**
     * The translation rows Bolt actually reads for this field: all of them for
     * a localized field, only the default-locale one otherwise
     * (`Field::getValue()` uses `translate($defaultLocale, false)`). Rows in
     * other locales, e.g. left over from when the field was localized, are
     * never shown, so writing an alt there would be pointless.
     *
     * For localized fields, rows of locales the ContentType no longer lists
     * are left out too: Bolt offers no way to edit or show them.
     *
     * @param list<string> $locales the ContentType's `locales`; empty = no restriction
     *
     * @return list<FieldTranslation>
     */
    public static function relevantTranslations(Field $field, bool $localized, array $locales = []): array
    {
        $translations = array_values($field->getTranslations()->toArray());

        if ($localized) {
            return $locales === [] ? $translations : array_values(array_filter(
                $translations,
                static fn (FieldTranslation $translation): bool => in_array($translation->getLocale(), $locales, true)
            ));
        }

        return array_values(array_filter(
            $translations,
            static fn (FieldTranslation $translation): bool => $translation->getLocale() === $field->getDefaultLocale()
        ));
    }

    /**
     * @return list<string>
     */
    public static function localeList(mixed $locales): array
    {
        if (! is_iterable($locales)) {
            return [];
        }

        $list = [];
        foreach ($locales as $locale) {
            if (is_string($locale) && $locale !== '') {
                $list[] = $locale;
            }
        }

        return $list;
    }

    public static function title(Content $content): string
    {
        try {
            $title = $content->getExtras()['title'] ?? '';
        } catch (Throwable) {
            $title = '';
        }

        $title = is_scalar($title) ? trim(strip_tags((string) $title)) : '';

        return $title !== '' ? $title : '#' . $content->getId();
    }

    /**
     * @param iterable<array-key, mixed> $fieldDefinitions
     */
    private static function fieldLabel(iterable $fieldDefinitions, string $name): string
    {
        foreach ($fieldDefinitions as $key => $definition) {
            if ((string) $key === $name && is_iterable($definition)) {
                $definition = is_array($definition) ? $definition : iterator_to_array($definition);

                return is_string($definition['label'] ?? null) ? $definition['label'] : $name;
            }
        }

        return $name;
    }
}
