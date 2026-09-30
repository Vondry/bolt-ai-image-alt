<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Tests\Service;

use Bolt\Entity\Content;
use Bolt\Entity\Field;
use Bolt\Entity\FieldTranslation;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\Query;
use Doctrine\ORM\QueryBuilder;
use PHPUnit\Framework\TestCase;
use Tvondracek\AiAlt\Service\DoctrineContentSource;
use Tvondracek\AiAlt\Tests\Fixtures;

final class DoctrineContentSourceTest extends TestCase
{
    public function testDetachesEachRecordWithItsFieldsOnceTheCallerIsDone(): void
    {
        $first = Fixtures::content(1);
        Fixtures::addImagelist($first, 'gallery', [
            'cs' => [['filename' => 'a.jpg']],
            'en' => [['filename' => 'a.jpg']],
        ]);
        $second = Fixtures::content(2);
        Fixtures::addImage($second, 'image', ['cs' => ['filename' => 'b.jpg']], 'cs');

        /** @var list<object> $detached */
        $detached = [];
        $entityManager = $this->entityManager([[1, 2]], [[$first, $second]], $detached);

        $seen = [];
        foreach ((new DoctrineContentSource($entityManager))->byContentType('pages') as $content) {
            self::assertNotContains($content, $detached, 'still managed while the caller works on it');
            $seen[] = $content;
        }

        self::assertSame([$first, $second], $seen);

        $gallery = $first->getField('gallery');
        $image = $second->getField('image');
        self::assertSame([
            $gallery->getTranslations()
                ->get('cs'),
            $gallery->getTranslations()
                ->get('en'),
            $gallery,
            $first,
            $image->getTranslations()
                ->get('cs'),
            $image,
            $second,
        ], $detached);
    }

    /**
     * @param list<list<int>> $idChunks results of the id queries, in order
     * @param list<list<Content>> $contentChunks results of the fetch-join queries, in order
     * @param list<object> $detached
     */
    private function entityManager(array $idChunks, array $contentChunks, array &$detached): EntityManagerInterface
    {
        $entityManager = $this->createMock(EntityManagerInterface::class);

        $query = $this->createMock(Query::class);
        // QueryBuilder::getQuery() chains these; a mock would return a fresh double.
        foreach (['setParameters', 'setFirstResult', 'setMaxResults'] as $setter) {
            $query->method($setter)
                ->willReturnSelf();
        }
        $query->method('getSingleColumnResult')
            ->willReturnOnConsecutiveCalls(...[...$idChunks, []]);
        $query->method('getResult')
            ->willReturnOnConsecutiveCalls(...$contentChunks);

        $entityManager->method('createQueryBuilder')
            ->willReturnCallback(static fn (): QueryBuilder => new QueryBuilder($entityManager));
        $entityManager->method('createQuery')
            ->willReturn($query);
        $entityManager->method('detach')
            ->willReturnCallback(static function (object $entity) use (&$detached): void {
                self::assertThat($entity, self::logicalOr(
                    self::isInstanceOf(Content::class),
                    self::isInstanceOf(Field::class),
                    self::isInstanceOf(FieldTranslation::class),
                ));
                $detached[] = $entity;
            });

        return $entityManager;
    }
}
