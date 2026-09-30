<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Exception;

use RuntimeException;

final class ImageNotFoundException extends RuntimeException
{
    public function __construct(string $message = 'No image found at that position.')
    {
        parent::__construct($message);
    }
}
