<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Tests\Service;

use Bolt\Configuration\Config;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Filesystem\Filesystem;
use Tvondracek\AiAlt\Service\ImageFileLocator;

final class ImageFileLocatorTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/ai-alt-files-' . bin2hex(random_bytes(4));
        mkdir($this->dir . '/2024/05', 0o777, true);
        touch($this->dir . '/2024/05/dog.jpg');
    }

    protected function tearDown(): void
    {
        (new Filesystem())->remove($this->dir);
    }

    public function testExists(): void
    {
        $boltConfig = $this->createStub(Config::class);
        $boltConfig->method('getPath')
            ->willReturn($this->dir);
        $locator = new ImageFileLocator($boltConfig);

        self::assertTrue($locator->exists('2024/05/dog.jpg'));
        self::assertTrue($locator->exists('/2024/05/dog.jpg'));
        self::assertFalse($locator->exists('2024/05/cat.jpg'));
        self::assertFalse($locator->exists('2024/05'), 'directories are not images');
        self::assertFalse($locator->exists(''));
        self::assertFalse($locator->exists("dog.jpg\0.png"));
        self::assertFalse($locator->exists('2024/../2024/05/dog.jpg'), 'no path traversal');
        self::assertFalse($locator->exists('..\\etc\\passwd'), 'no path traversal');
    }
}
