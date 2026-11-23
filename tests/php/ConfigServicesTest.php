<?php

declare(strict_types=1);

namespace Tomvondracek\AiAlt\Tests;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Yaml\Yaml;
use Tomvondracek\AiAlt\Widget\AiAltWidget;

/**
 * Guards config/services.yaml, which `extensions:configure` copies into the project.
 */
final class ConfigServicesTest extends TestCase
{
    private const VENDOR_PATH = '%kernel.project_dir%/vendor/tomvondracek/bolt-ai-image-alt';

    public function testPackageNameMatchesThePathInTheConfig(): void
    {
        $composer = json_decode((string) file_get_contents(dirname(__DIR__, 2) . '/composer.json'), true, flags: JSON_THROW_ON_ERROR);
        self::assertIsArray($composer);
        $name = $composer['name'] ?? null;
        self::assertIsString($name);

        self::assertSame(self::VENDOR_PATH, '%kernel.project_dir%/vendor/' . $name);
    }

    public function testTwigNamespaceIsRegisteredForTheShippedTemplates(): void
    {
        $config = Yaml::parseFile(dirname(__DIR__, 2) . '/config/services.yaml');
        self::assertIsArray($config);

        self::assertSame([
            'paths' => [
                self::VENDOR_PATH . '/templates' => 'ai-alt',
            ],
        ], $config['twig'] ?? null);

        foreach (['widget.html.twig', 'batch.html.twig'] as $template) {
            self::assertFileExists(dirname(__DIR__, 2) . '/templates/' . $template);
        }

        self::assertSame('@ai-alt/widget.html.twig', (new AiAltWidget())->getTemplate());
    }
}
