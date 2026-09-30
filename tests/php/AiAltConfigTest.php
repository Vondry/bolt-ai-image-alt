<?php

declare(strict_types=1);

namespace Tomvondracek\AiAlt\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Tomvondracek\AiAlt\AiAltConfig;
use Tomvondracek\AiAlt\AiAltConfigLoader;

final class AiAltConfigTest extends TestCase
{
    public function testDefaultsForEmptyConfig(): void
    {
        $config = AiAltConfig::fromArray([]);

        self::assertTrue($config->enabled);
        self::assertTrue($config->autoOnUpload);
        self::assertTrue($config->prewarmModel);
        self::assertSame('onnx-community/Florence-2-base-ft', $config->model);
        self::assertSame('<CAPTION>', $config->task);
        self::assertSame('https://huggingface.co', $config->modelHost);
        self::assertSame('768×768×max', $config->thumbnail);
        self::assertSame(125, $config->maxLength);
        self::assertSame(AiAltConfig::DEFAULT_MAX_LENGTHS, $config->maxLengths);
        self::assertSame(AiAltConfig::FALLBACK_EMPTY, $config->fallbackWithoutTranslator);
        self::assertSame([], $config->includeContentTypes);
        self::assertSame([], $config->excludeContentTypes);
        self::assertSame('ROLE_EDITOR', $config->batchPagePermission);
    }

    public function testShippedConfigFileMatchesDefaults(): void
    {
        $shipped = AiAltConfig::fromArray(AiAltConfigLoader::parseFiles([AiAltConfigLoader::defaultConfigFile()]));

        self::assertEquals(AiAltConfig::fromArray([]), $shipped);
    }

    public function testReadsAllValues(): void
    {
        $config = AiAltConfig::fromArray([
            'enabled' => false,
            'auto_on_upload' => 'no',
            'prewarm_model' => 0,
            'model' => ' onnx-community/Florence-2-large-ft ',
            'task' => '<DETAILED_CAPTION>',
            'model_host' => '/models/',
            'thumbnail' => '512×512×max',
            'max_length' => '80',
            'fallback_without_translator' => 'english',
            'contenttypes' => ['include' => ['pages', 'entries'], 'exclude' => 'blocks'],
            'permissions' => ['batch_page' => 'ROLE_ADMIN'],
        ]);

        self::assertFalse($config->enabled);
        self::assertFalse($config->autoOnUpload);
        self::assertFalse($config->prewarmModel);
        self::assertSame('onnx-community/Florence-2-large-ft', $config->model);
        self::assertSame('<DETAILED_CAPTION>', $config->task);
        self::assertSame('/models', $config->modelHost);
        self::assertSame('512×512×max', $config->thumbnail);
        self::assertSame(80, $config->maxLength);
        self::assertSame([
            '<CAPTION>' => 125,
            '<DETAILED_CAPTION>' => 80,
            '<MORE_DETAILED_CAPTION>' => 400,
        ], $config->maxLengths, 'a number limits the default task only');
        self::assertSame(AiAltConfig::FALLBACK_ENGLISH, $config->fallbackWithoutTranslator);
        self::assertSame(['pages', 'entries'], $config->includeContentTypes);
        self::assertSame(['blocks'], $config->excludeContentTypes);
        self::assertSame('ROLE_ADMIN', $config->batchPagePermission);
    }

    public function testMaxLengthPerTask(): void
    {
        $config = AiAltConfig::fromArray([
            'task' => '<DETAILED_CAPTION>',
            'max_length' => [
                '<CAPTION>' => 100,
                '<DETAILED_CAPTION>' => '300',
                '<MORE_DETAILED_CAPTION>' => 'long',
                '<OD>' => 50,
            ],
        ]);

        self::assertSame(300, $config->maxLength);
        self::assertSame([
            '<CAPTION>' => 100,
            '<DETAILED_CAPTION>' => 300,
            '<MORE_DETAILED_CAPTION>' => 400,
        ], $config->maxLengths);
    }

    /**
     * @param array<string, mixed> $raw
     */
    #[DataProvider('invalidValues')]
    public function testInvalidValuesFallBackToDefaults(array $raw, string $property, mixed $expected): void
    {
        self::assertSame($expected, AiAltConfig::fromArray($raw)->{$property});
    }

    /**
     * @return iterable<string, array{array<string, mixed>, string, mixed}>
     */
    public static function invalidValues(): iterable
    {
        yield 'unknown task' => [['task' => '<OD>'], 'task', '<CAPTION>'];
        yield 'unknown fallback' => [['fallback_without_translator' => 'german'], 'fallbackWithoutTranslator', 'empty'];
        yield 'non-numeric max length' => [['max_length' => 'long'], 'maxLength', 125];
        yield 'too small max length' => [['max_length' => 3], 'maxLength', 16];
        yield 'max length map without the default task' => [['max_length' => ['<DETAILED_CAPTION>' => 200]], 'maxLength', 125];
        yield 'max length as a list' => [['max_length' => [80]], 'maxLengths', AiAltConfig::DEFAULT_MAX_LENGTHS];
        yield 'empty model' => [['model' => '  '], 'model', 'onnx-community/Florence-2-base-ft'];
        yield 'non-string model' => [['model' => ['x']], 'model', 'onnx-community/Florence-2-base-ft'];
        yield 'empty permission' => [['permissions' => ['batch_page' => '']], 'batchPagePermission', 'ROLE_EDITOR'];
        yield 'permissions not an array' => [['permissions' => 'ROLE_ADMIN'], 'batchPagePermission', 'ROLE_EDITOR'];
        yield 'contenttypes not an array' => [['contenttypes' => 'pages'], 'includeContentTypes', []];
        yield 'include with junk' => [['contenttypes' => ['include' => ['pages', '', 5, null]]], 'includeContentTypes', ['pages']];
        yield 'include as int' => [['contenttypes' => ['include' => 5]], 'includeContentTypes', []];
        yield 'bool as string' => [['enabled' => 'false'], 'enabled', false];
        yield 'bool as yes' => [['auto_on_upload' => 'yes'], 'autoOnUpload', true];
    }

    public function testContentTypeAllowList(): void
    {
        $all = AiAltConfig::fromArray([]);
        self::assertTrue($all->isContentTypeAllowed('pages'));

        $include = AiAltConfig::fromArray(['contenttypes' => ['include' => ['pages']]]);
        self::assertTrue($include->isContentTypeAllowed('pages'));
        self::assertFalse($include->isContentTypeAllowed('entries'));

        $exclude = AiAltConfig::fromArray(['contenttypes' => ['exclude' => ['pages']]]);
        self::assertFalse($exclude->isContentTypeAllowed('pages'));
        self::assertTrue($exclude->isContentTypeAllowed('entries'));

        $both = AiAltConfig::fromArray(['contenttypes' => ['include' => ['pages'], 'exclude' => ['pages']]]);
        self::assertFalse($both->isContentTypeAllowed('pages'), 'exclude wins');
    }

    public function testClientArrayExposesOnlyBrowserSettings(): void
    {
        $client = AiAltConfig::fromArray(['permissions' => ['batch_page' => 'ROLE_ADMIN']])->toClientArray();

        self::assertSame([
            'enabled' => true,
            'autoOnUpload' => true,
            'prewarmModel' => true,
            'model' => 'onnx-community/Florence-2-base-ft',
            'task' => '<CAPTION>',
            'modelHost' => 'https://huggingface.co',
            'thumbnail' => '768×768×max',
            'maxLength' => 125,
            'maxLengths' => AiAltConfig::DEFAULT_MAX_LENGTHS,
            'fallbackWithoutTranslator' => 'empty',
        ], $client);
    }
}
