<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt;

use FilesystemIterator;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use RuntimeException;
use Symfony\Component\Filesystem\Filesystem;
use Tvondracek\AiAlt\Widget\ClientConfig;

/**
 * Copies the prebuilt browser assets (`public/` of this package) into the
 * project's web root, so hosting needs no Node.js.
 */
final readonly class AssetInstaller
{
    public function __construct(
        private Filesystem $filesystem = new Filesystem(),
    ) {
    }

    public static function sourceDirectory(): string
    {
        return dirname(__DIR__) . '/public';
    }

    /**
     * @return int number of files installed
     */
    public function install(string $webRoot, ?string $source = null): int
    {
        $source ??= self::sourceDirectory();

        if (! is_dir($source)) {
            throw new RuntimeException(sprintf('AI ALT assets not found in "%s". Run `npm run build` in the extension.', $source));
        }

        $target = mb_rtrim($webRoot, '/\\') . ClientConfig::ASSET_BASE;

        // `delete` removes stale files from previous versions (old ORT builds).
        $this->filesystem->mirror($source, $target, null, [
            'override' => true,
            'delete' => true,
        ]);

        return iterator_count(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($target, FilesystemIterator::SKIP_DOTS)));
    }
}
