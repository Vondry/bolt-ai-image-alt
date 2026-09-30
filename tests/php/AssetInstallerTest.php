<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Tests;

use PHPUnit\Framework\TestCase;
use RuntimeException;
use Symfony\Component\Filesystem\Filesystem;
use Tvondracek\AiAlt\AssetInstaller;

final class AssetInstallerTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/ai-alt-install-' . bin2hex(random_bytes(4));
        mkdir($this->dir . '/source/ort', 0o777, true);
        mkdir($this->dir . '/web/extensions/ai-alt/chunks', 0o777, true);
        file_put_contents($this->dir . '/source/ai-alt.js', 'new');
        file_put_contents($this->dir . '/source/ort/runtime.wasm', 'wasm');
        file_put_contents($this->dir . '/web/extensions/ai-alt/ai-alt.js', 'old');
        file_put_contents($this->dir . '/web/extensions/ai-alt/chunks/stale-123.js', 'stale');
    }

    protected function tearDown(): void
    {
        (new Filesystem())->remove($this->dir);
    }

    public function testMirrorsAssetsAndRemovesStaleFiles(): void
    {
        $count = (new AssetInstaller())->install($this->dir . '/web/', $this->dir . '/source');

        $target = $this->dir . '/web/extensions/ai-alt';
        self::assertSame(2, $count);
        self::assertSame('new', file_get_contents($target . '/ai-alt.js'));
        self::assertSame('wasm', file_get_contents($target . '/ort/runtime.wasm'));
        self::assertFileDoesNotExist($target . '/chunks/stale-123.js');
    }

    public function testFailsWithoutBuiltAssets(): void
    {
        $this->expectException(RuntimeException::class);

        (new AssetInstaller())->install($this->dir . '/web', $this->dir . '/nope');
    }

    public function testShipsBuiltAssets(): void
    {
        $source = AssetInstaller::sourceDirectory();

        foreach (['ai-alt.js', 'ai-alt-batch.js', 'ai-alt.worker.js', 'ai-alt.css', 'ort/ort-wasm-simd-threaded.asyncify.wasm'] as $file) {
            self::assertFileExists($source . '/' . $file, 'run `npm run build`');
        }
    }
}
