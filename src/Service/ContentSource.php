<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Service;

use Bolt\Entity\Content;

/**
 * Where the batch page reads content records from. Abstracted so the finder
 * and writer can be tested without a database.
 */
interface ContentSource
{
    /**
     * @return iterable<Content>
     */
    public function byContentType(string $contentType): iterable;

    public function find(int $id): ?Content;
}
