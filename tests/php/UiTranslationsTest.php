<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Tvondracek\AiAlt\UiTranslations;

final class UiTranslationsTest extends TestCase
{
    public function testTranslates(): void
    {
        self::assertSame('Doplnění chybějících ALT textů', UiTranslations::translate('batchTitle', 'cs_CZ'));
        self::assertSame('Fehlende ALT-Texte ergänzen', UiTranslations::translate('batchTitle', 'de-AT'));
        self::assertSame('Fill in missing ALT texts', UiTranslations::translate('batchTitle', 'en'));
    }

    public function testFallsBackToEnglish(): void
    {
        self::assertSame('Fill in missing ALT texts', UiTranslations::translate('batchTitle', 'xx'));
        self::assertSame('Fill in missing ALT texts', UiTranslations::translate('batchTitle', null));
        self::assertSame('noSuchKey', UiTranslations::translate('noSuchKey', 'cs'));
    }

    /**
     * @return iterable<string, array{string|null, string}>
     */
    public static function locales(): iterable
    {
        yield 'plain' => ['cs', 'cs'];
        yield 'underscore' => ['cs_CZ', 'cs'];
        yield 'dash' => ['pt-BR', 'pt'];
        yield 'upper case' => ['DE', 'de'];
        yield 'empty' => ['', 'en'];
        yield 'null' => [null, 'en'];
        yield 'path traversal' => ['../../etc/passwd', 'en'];
        yield 'dot' => ['cs.json', 'en'];
    }

    #[DataProvider('locales')]
    public function testLanguage(?string $locale, string $expected): void
    {
        self::assertSame($expected, UiTranslations::language($locale));
    }

    public function testEveryCatalogueHasAllEnglishKeys(): void
    {
        $english = self::read('en');
        $files = glob(UiTranslations::directory() . '/*.json') ?: [];
        self::assertGreaterThanOrEqual(11, count($files));

        foreach ($files as $file) {
            $language = basename($file, '.json');
            self::assertSame(array_keys($english), array_keys(self::read($language)), $language . '.json keys');
        }
    }

    /**
     * @return array<string, string>
     */
    private static function read(string $language): array
    {
        $data = json_decode((string) file_get_contents(UiTranslations::directory() . '/' . $language . '.json'), true, flags: JSON_THROW_ON_ERROR);
        self::assertIsArray($data);

        return $data;
    }
}
