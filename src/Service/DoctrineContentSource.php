<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Service;

use Bolt\Entity\Content;
use Doctrine\ORM\EntityManagerInterface;

final readonly class DoctrineContentSource implements ContentSource
{
    /**
     * Records loaded per query.
     */
    public const CHUNK_SIZE = 100;

    public function __construct(
        private EntityManagerInterface $entityManager,
    ) {
    }

    /**
     * Loads records in chunks, with their fields and field translations
     * fetch-joined: a plain `findBy()` loads those per record (N+1 queries).
     *
     * Each record is detached once the caller is done with it, so a scan of
     * a large site does not keep every record in the identity map.
     */
    public function byContentType(string $contentType): iterable
    {
        $lastId = 0;

        do {
            /** @var list<int|string> $ids */
            $ids = $this->entityManager->createQueryBuilder()
                ->select('c.id')
                ->from(Content::class, 'c')
                ->where('c.contentType = :contentType')
                ->andWhere('c.id > :lastId')
                ->setParameter('contentType', $contentType)
                ->setParameter('lastId', $lastId)
                ->orderBy('c.id', 'ASC')
                ->setMaxResults(self::CHUNK_SIZE)
                ->getQuery()
                ->getSingleColumnResult();

            if ($ids === []) {
                return;
            }

            /** @var list<Content> $contents */
            $contents = $this->entityManager->createQueryBuilder()
                ->select('c', 'f', 't')
                ->from(Content::class, 'c')
                ->leftJoin('c.fields', 'f')
                ->leftJoin('f.translations', 't')
                ->where('c.id IN (:ids)')
                ->setParameter('ids', $ids)
                ->orderBy('c.id', 'ASC')
                ->getQuery()
                ->getResult();

            foreach ($contents as $content) {
                yield $content;
                $this->detach($content);
            }

            $lastId = (int) end($ids);
        } while (count($ids) === self::CHUNK_SIZE);
    }

    /**
     * Not `clear()`: that would also detach the logged-in user (loaded as an
     * author), which the security token and voters keep using.
     */
    private function detach(Content $content): void
    {
        foreach ($content->getRawFields() as $field) {
            foreach ($field->getTranslations() as $translation) {
                $this->entityManager->detach($translation);
            }
            $this->entityManager->detach($field);
        }

        $this->entityManager->detach($content);
    }

    public function find(int $id): ?Content
    {
        return $this->entityManager->getRepository(Content::class)->find($id);
    }
}
