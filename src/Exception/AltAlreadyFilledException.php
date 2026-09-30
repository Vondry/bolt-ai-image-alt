<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Exception;

use RuntimeException;

final class AltAlreadyFilledException extends RuntimeException
{
    public function __construct(string $message = 'The image already has an alt text.')
    {
        parent::__construct($message);
    }
}
