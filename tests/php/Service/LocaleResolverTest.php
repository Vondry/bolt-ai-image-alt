<?php

declare(strict_types=1);

namespace Tomvondracek\AiAlt\Tests\Service;

use Illuminate\Support\Collection;
use PHPUnit\Framework\TestCase;
use Tomvondracek\AiAlt\Service\LocaleResolver;

final class LocaleResolverTest extends TestCase
{
    public function testDefaultLocaleIsFirstContentTypeLocale(): void
    {
        self::assertSame('cs', LocaleResolver::defaultLocale(['cs', 'en'], 'en'));
        self::assertSame('nl', LocaleResolver::defaultLocale(new Collection(['nl', 'en']), 'en'));
    }

    public function testDefaultLocaleFallsBackToSiteLocale(): void
    {
        self::assertSame('en', LocaleResolver::defaultLocale(null, 'en'));
        self::assertSame('de', LocaleResolver::defaultLocale([], 'de'));
        self::assertSame('de', LocaleResolver::defaultLocale(['', null], 'de'));
    }

    public function testTextLocale(): void
    {
        self::assertSame('en', LocaleResolver::textLocale(true, 'en', 'cs'), 'localized field uses its own locale');
        self::assertSame('cs', LocaleResolver::textLocale(false, 'en', 'cs'), 'non-localized field uses the default');
        self::assertSame('cs', LocaleResolver::textLocale(true, '', 'cs'));
    }

    public function testBaseLanguage(): void
    {
        self::assertSame('cs', LocaleResolver::baseLanguage('cs_CZ'));
        self::assertSame('pt', LocaleResolver::baseLanguage('pt-BR'));
        self::assertSame('en', LocaleResolver::baseLanguage(' EN '));
        self::assertSame('', LocaleResolver::baseLanguage(''));
    }
}
