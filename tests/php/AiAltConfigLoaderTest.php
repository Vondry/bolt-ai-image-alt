<?php

declare(strict_types=1);

namespace Tomvondracek\AiAlt\Tests;

use Bolt\Configuration\Config;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Filesystem\Filesystem;
use Tomvondracek\AiAlt\AiAltConfigLoader;

final class AiAltConfigLoaderTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/ai-alt-config-' . bin2hex(random_bytes(4));
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        (new Filesystem())->remove($this->dir);
    }

    private function loader(): AiAltConfigLoader
    {
        $boltConfig = $this->createMock(Config::class);
        $boltConfig->expects(self::once())->method('getPath')->with('extensions_config')->willReturn($this->dir);

        return new AiAltConfigLoader($boltConfig);
    }

    public function testFallsBackToShippedDefaults(): void
    {
        self::assertSame(125, $this->loader()->load()->maxLength);
    }

    public function testProjectConfigAndLocalOverride(): void
    {
        file_put_contents($this->dir . '/tomvondracek-aialt.yaml', "max_length: 90\nauto_on_upload: false\n");
        file_put_contents($this->dir . '/tomvondracek-aialt_local.yaml', "max_length: 60\n");

        $loader = $this->loader();
        $config = $loader->load();

        self::assertSame(60, $config->maxLength);
        self::assertFalse($config->autoOnUpload);
        self::assertSame($config, $loader->load(), 'cached per request');
    }

    public function testLocalOverrideAppliesOnTopOfDefaults(): void
    {
        file_put_contents($this->dir . '/tomvondracek-aialt_local.yaml', "enabled: false\n");

        self::assertFalse($this->loader()->load()->enabled);
    }

    public function testParseFilesSkipsMissingAndNonArrayFiles(): void
    {
        file_put_contents($this->dir . '/scalar.yaml', "just a string\n");
        file_put_contents($this->dir . '/a.yaml', "a: 1\nb: 1\n");
        file_put_contents($this->dir . '/b.yaml', "b: 2\n");

        self::assertSame(
            [
                'a' => 1,
                'b' => 2,
            ],
            AiAltConfigLoader::parseFiles([$this->dir . '/missing.yaml', $this->dir . '/scalar.yaml', $this->dir . '/a.yaml', $this->dir . '/b.yaml'])
        );
    }
}
