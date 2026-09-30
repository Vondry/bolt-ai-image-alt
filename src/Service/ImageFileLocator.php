<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Service;

use Bolt\Configuration\Config;

/**
 * Checks that an image referenced by a field still exists in the files folder.
 */
class ImageFileLocator
{
    public function __construct(
        private readonly Config $boltConfig,
    ) {
    }

    public function exists(string $filename): bool
    {
        $filename = ltrim($filename, '/');

        if ($filename === '' || str_contains($filename, "\0")) {
            return false;
        }

        // Stored field values are editor input: never look outside the files folder.
        if (in_array('..', preg_split('#[/\\\\]#', $filename) ?: [], true)) {
            return false;
        }

        return is_file($this->boltConfig->getPath('files') . DIRECTORY_SEPARATOR . $filename);
    }
}
