<?php

declare(strict_types=1);

namespace Tomvondracek\AiAlt\Tests\Service;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Tomvondracek\AiAlt\Exception\AltAlreadyFilledException;
use Tomvondracek\AiAlt\Exception\ImageNotFoundException;
use Tomvondracek\AiAlt\Service\AltValue;

final class AltValueTest extends TestCase
{
    public function testImageWithoutAltIsMissing(): void
    {
        self::assertSame(
            [['index' => null, 'filename' => 'stock/dog.jpg']],
            AltValue::missing('image', ['filename' => ' stock/dog.jpg ', 'alt' => '', 'media' => 3])
        );
    }

    /**
     * @param array<array-key, mixed> $value
     */
    #[DataProvider('imagesNotMissing')]
    public function testImagesThatAreNotMissing(array $value): void
    {
        self::assertSame([], AltValue::missing('image', $value));
    }

    /**
     * @return iterable<string, array{array<array-key, mixed>}>
     */
    public static function imagesNotMissing(): iterable
    {
        yield 'has alt' => [['filename' => 'dog.jpg', 'alt' => 'A dog']];
        yield 'no file' => [['filename' => '', 'alt' => '']];
        yield 'empty value' => [[]];
        yield 'filename not a string' => [['filename' => 5]];
        yield 'svg' => [['filename' => 'logo.SVG', 'alt' => '']];
        yield 'svgz' => [['filename' => 'logo.svgz']];
        yield 'bmp' => [['filename' => 'scan.bmp']];
        yield 'tiff' => [['filename' => 'scan.TIFF']];
        yield 'no extension' => [['filename' => 'photo']];
    }

    public function testWhitespaceOrNonStringAltCountsAsEmpty(): void
    {
        self::assertCount(1, AltValue::missing('image', ['filename' => 'a.jpg', 'alt' => '   ']));
        self::assertCount(1, AltValue::missing('image', ['filename' => 'a.jpg', 'alt' => null]));
        self::assertCount(1, AltValue::missing('image', ['filename' => 'a.jpg']));
    }

    public function testImagelistReportsEachMissingItemWithIndex(): void
    {
        $value = [
            ['filename' => 'a.jpg', 'alt' => ''],
            ['filename' => 'b.jpg', 'alt' => 'B'],
            ['filename' => 'c.png'],
            ['filename' => 'd.svg', 'alt' => ''],
            'junk',
            'key' => ['filename' => 'e.jpg'],
        ];

        self::assertSame(
            [['index' => 0, 'filename' => 'a.jpg'], ['index' => 2, 'filename' => 'c.png']],
            AltValue::missing('imagelist', $value)
        );
    }

    public function testOtherFieldTypesHaveNothingMissing(): void
    {
        self::assertSame([], AltValue::missing('text', ['filename' => 'a.jpg']));
    }

    public function testWithAltOnImage(): void
    {
        $value = AltValue::withAlt('image', ['filename' => 'a.jpg', 'alt' => '', 'media' => 4, 0 => ''], null, 'A cat');

        self::assertSame(['filename' => 'a.jpg', 'alt' => 'A cat', 'media' => 4], $value);
    }

    public function testWithAltOnImagelistChangesOnlyThatItem(): void
    {
        $value = [
            ['filename' => 'a.jpg', 'alt' => 'A'],
            ['filename' => 'b.jpg', 'alt' => '', 'title' => 'x'],
        ];

        self::assertSame([
            ['filename' => 'a.jpg', 'alt' => 'A'],
            ['filename' => 'b.jpg', 'alt' => 'B', 'title' => 'x'],
        ], AltValue::withAlt('imagelist', $value, 1, 'B'));
    }

    public function testWithAltRefusesFilledAlt(): void
    {
        $this->expectException(AltAlreadyFilledException::class);

        AltValue::withAlt('image', ['filename' => 'a.jpg', 'alt' => 'Typed by editor'], null, 'AI');
    }

    public function testWithAltRefusesFilledImagelistItem(): void
    {
        $this->expectException(AltAlreadyFilledException::class);

        AltValue::withAlt('imagelist', [['filename' => 'a.jpg', 'alt' => 'x']], 0, 'AI');
    }

    /**
     * @param array<array-key, mixed> $value
     */
    #[DataProvider('notFound')]
    public function testWithAltImageNotFound(string $type, array $value, ?int $index, ?string $expectedFilename): void
    {
        $this->expectException(ImageNotFoundException::class);

        AltValue::withAlt($type, $value, $index, 'AI', $expectedFilename);
    }

    /**
     * @return iterable<string, array{string, array<array-key, mixed>, int|null, string|null}>
     */
    public static function notFound(): iterable
    {
        yield 'image without file' => ['image', ['filename' => ''], null, null];
        yield 'imagelist index out of range' => ['imagelist', [['filename' => 'a.jpg']], 3, null];
        yield 'imagelist without index' => ['imagelist', [['filename' => 'a.jpg']], null, null];
        yield 'imagelist item not an array' => ['imagelist', ['a.jpg'], 0, null];
        yield 'image replaced meanwhile' => ['image', ['filename' => 'new.jpg'], null, 'old.jpg'];
        yield 'imagelist item replaced' => ['imagelist', [['filename' => 'new.jpg']], 0, 'old.jpg'];
        yield 'unsupported type' => ['file', ['filename' => 'a.pdf'], null, null];
    }

    public function testWithAltAcceptsMatchingExpectedFilename(): void
    {
        self::assertSame('AI', AltValue::withAlt('image', ['filename' => 'a.jpg'], null, 'AI', 'a.jpg')['alt']);
    }

    public function testIsCaptionable(): void
    {
        self::assertTrue(AltValue::isCaptionable('photo.JPG'));
        self::assertTrue(AltValue::isCaptionable('photo.webp'));
        self::assertFalse(AltValue::isCaptionable('icon.svg'));
        foreach (['a.gif', 'a.png', 'a.jpeg', 'a.AVIF'] as $file) {
            self::assertTrue(AltValue::isCaptionable($file), $file);
        }
        self::assertFalse(AltValue::isCaptionable('photo.heic'), 'Bolt serves its placeholder for it');
    }
}
