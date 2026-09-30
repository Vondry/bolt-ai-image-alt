<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Service;

use Tvondracek\AiAlt\Exception\AltAlreadyFilledException;
use Tvondracek\AiAlt\Exception\ImageNotFoundException;

/**
 * Pure helpers over the raw JSON value Bolt stores for `image` and `imagelist`
 * fields (one value per `bolt_field_translation` row).
 *
 *  - image:     {"filename": "2024/05/foo.jpg", "alt": "", "media": 12, ...}
 *  - imagelist: [{"filename": "...", "alt": ""}, {"filename": "...", "alt": "..."}]
 */
final class AltValue
{
    /**
     * Formats Bolt's `/thumbs` route renders (`ImageController::isImage()`),
     * minus SVG, which has no raster data for the model. Anything else gets
     * Bolt's "404" placeholder image.
     */
    public const CAPTIONABLE_EXTENSIONS = ['gif', 'png', 'jpg', 'jpeg', 'avif', 'webp'];

    /**
     * Images in the value that have a filename but no alt text.
     *
     * @param array<array-key, mixed> $value
     *
     * @return list<array{index: int|null, filename: string}>
     */
    public static function missing(string $type, array $value): array
    {
        $missing = [];

        foreach (self::images($type, $value) as $index => $image) {
            $filename = self::filename($image);

            if ($filename === '' || ! self::isCaptionable($filename) || ! self::isAltEmpty($image)) {
                continue;
            }

            $missing[] = [
                'index' => $type === FieldMetaProvider::TYPE_IMAGELIST ? $index : null,
                'filename' => $filename,
            ];
        }

        return $missing;
    }

    /**
     * Returns a copy of `$value` with the alt set on the given image.
     *
     * @param array<array-key, mixed> $value
     * @param int|null $index position in an imagelist; ignored for an image field
     * @param string|null $expectedFilename when given, the image must still have this filename
     *
     * @throws ImageNotFoundException when there is no (matching) image at that position
     * @throws AltAlreadyFilledException when the image already has an alt
     *
     * @return array<array-key, mixed>
     */
    public static function withAlt(string $type, array $value, ?int $index, string $alt, ?string $expectedFilename = null): array
    {
        if ($type === FieldMetaProvider::TYPE_IMAGELIST) {
            if ($index === null || ! is_array($value[$index] ?? null)) {
                throw new ImageNotFoundException();
            }

            self::assertWritable($value[$index], $expectedFilename);
            $value[$index]['alt'] = $alt;

            return $value;
        }

        if ($type !== FieldMetaProvider::TYPE_IMAGE) {
            throw new ImageNotFoundException(sprintf('Fields of type "%s" have no alt text.', $type));
        }

        self::assertWritable($value, $expectedFilename);

        // Bolt sometimes stores a stray `0` key next to the image data.
        unset($value[0]);
        $value['alt'] = $alt;

        return $value;
    }

    public static function isCaptionable(string $filename): bool
    {
        $extension = mb_strtolower(pathinfo($filename, PATHINFO_EXTENSION));

        return in_array($extension, self::CAPTIONABLE_EXTENSIONS, true);
    }

    /**
     * @param array<array-key, mixed> $image
     */
    private static function assertWritable(array $image, ?string $expectedFilename): void
    {
        $filename = self::filename($image);

        if ($filename === '') {
            throw new ImageNotFoundException();
        }

        if ($expectedFilename !== null && $filename !== $expectedFilename) {
            throw new ImageNotFoundException('The image was replaced in the meantime.');
        }

        if (! self::isAltEmpty($image)) {
            throw new AltAlreadyFilledException();
        }
    }

    /**
     * @param array<array-key, mixed> $value
     *
     * @return array<int, array<array-key, mixed>> imagelist items keyed by position; a single
     *                                             entry at 0 for an image field
     */
    private static function images(string $type, array $value): array
    {
        if ($type === FieldMetaProvider::TYPE_IMAGE) {
            return [0 => $value];
        }

        if ($type !== FieldMetaProvider::TYPE_IMAGELIST) {
            return [];
        }

        $list = [];
        foreach ($value as $index => $image) {
            if (is_int($index) && is_array($image)) {
                $list[$index] = $image;
            }
        }

        return $list;
    }

    /**
     * @param array<array-key, mixed> $image
     */
    private static function filename(array $image): string
    {
        $filename = $image['filename'] ?? '';

        return is_string($filename) ? trim($filename) : '';
    }

    /**
     * @param array<array-key, mixed> $image
     */
    private static function isAltEmpty(array $image): bool
    {
        $alt = $image['alt'] ?? '';

        return ! is_string($alt) || trim($alt) === '';
    }
}
