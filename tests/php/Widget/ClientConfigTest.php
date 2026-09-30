<?php

declare(strict_types=1);

namespace Tomvondracek\AiAlt\Tests\Widget;

use PHPUnit\Framework\TestCase;
use Tomvondracek\AiAlt\AiAltConfig;
use Tomvondracek\AiAlt\Tests\Fixtures;
use Tomvondracek\AiAlt\Widget\ClientConfig;

final class ClientConfigTest extends TestCase
{
    public function testEditorConfig(): void
    {
        $config = ClientConfig::forEditor(AiAltConfig::fromArray([]), Fixtures::contentType(), 'en', 'cs', '123');

        self::assertNotNull($config);
        self::assertSame('pages', $config['contentType']);
        self::assertSame('cs', $config['defaultLocale']);
        self::assertSame('cs', $config['uiLocale']);
        self::assertSame('123', $config['assetVersion']);
        self::assertSame('/extensions/ai-alt', $config['assetBase']);
        self::assertSame([
            'image' => ['type' => 'image', 'localized' => false],
            'gallery' => ['type' => 'imagelist', 'localized' => true],
        ], $config['fieldMeta']);
        self::assertTrue($config['autoOnUpload']);
    }

    public function testPathsHonourBoltInASubdirectory(): void
    {
        $config = ClientConfig::forEditor(AiAltConfig::fromArray([]), Fixtures::contentType(), 'en', 'en', '', '/cms/');

        self::assertSame('/cms/extensions/ai-alt', $config['assetBase'] ?? null);
        self::assertSame('/cms/thumbs', $config['thumbsBase'] ?? null);
        self::assertSame('/cms', $config['basePath'] ?? null);
        self::assertSame(['basePath' => '', 'assetBase' => '/extensions/ai-alt', 'thumbsBase' => '/thumbs'], ClientConfig::paths(''));
    }

    public function testEditorConfigWithoutContentTypeLocalesUsesSiteLocale(): void
    {
        $config = ClientConfig::forEditor(AiAltConfig::fromArray([]), Fixtures::contentType(['locales' => []]), 'de', 'en');

        self::assertSame('de', $config['defaultLocale'] ?? null);
    }

    public function testNoEditorConfigWhenNothingToDo(): void
    {
        $enabled = AiAltConfig::fromArray([]);

        self::assertNull(ClientConfig::forEditor(AiAltConfig::fromArray(['enabled' => false]), Fixtures::contentType(), 'en', 'en'));
        self::assertNull(ClientConfig::forEditor($enabled, null, 'en', 'en'));
        self::assertNull(ClientConfig::forEditor(AiAltConfig::fromArray(['contenttypes' => ['exclude' => ['pages']]]), Fixtures::contentType(), 'en', 'en'));
        self::assertNull(ClientConfig::forEditor($enabled, Fixtures::contentType(['fields' => ['title' => ['type' => 'text']]]), 'en', 'en'));
        self::assertNull(ClientConfig::forEditor($enabled, ['name' => 'no slug'], 'en', 'en'));
        self::assertNull(ClientConfig::forEditor($enabled, ['slug' => 'x', 'fields' => 'broken'], 'en', 'en'));
    }

    public function testJsonIsSafeInsideScriptTag(): void
    {
        $json = ClientConfig::toJson(['task' => '<CAPTION>', 'evil' => "</script><script>alert('x')&"]);

        self::assertStringNotContainsString('<', $json);
        self::assertStringNotContainsString('>', $json);
        self::assertStringNotContainsString("'", $json);
        self::assertStringNotContainsString('&', $json);
        self::assertSame(['task' => '<CAPTION>', 'evil' => "</script><script>alert('x')&"], json_decode($json, true));
    }

    public function testBuildMergesExtras(): void
    {
        $config = ClientConfig::build(AiAltConfig::fromArray([]), ['model' => 'override', 'extra' => 1]);

        self::assertSame('override', $config['model']);
        self::assertSame(1, $config['extra']);
    }
}
