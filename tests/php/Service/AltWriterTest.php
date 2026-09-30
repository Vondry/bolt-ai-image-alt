<?php

declare(strict_types=1);

namespace Tomvondracek\AiAlt\Tests\Service;

use Bolt\Entity\Content;
use Bolt\Entity\FieldTranslation;
use Bolt\Event\ContentEvent;
use DateTime;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\TestCase;
use Symfony\Contracts\EventDispatcher\EventDispatcherInterface;
use Tomvondracek\AiAlt\Exception\AltAlreadyFilledException;
use Tomvondracek\AiAlt\Exception\ImageNotFoundException;
use Tomvondracek\AiAlt\Service\AltWriter;
use Tomvondracek\AiAlt\Service\FieldMetaProvider;
use Tomvondracek\AiAlt\Tests\Fixtures;

final class AltWriterTest extends TestCase
{
    /** @var list<string> */
    private array $events = [];

    /** @var list<string> entity manager calls, in order */
    private array $calls = [];

    /**
     * @param (callable(FieldTranslation): void)|null $onRefresh simulates what the locked re-read finds in the database
     */
    private function writer(bool $expectFlush = true, ?callable $onRefresh = null): AltWriter
    {
        $entityManager = $this->createMock(EntityManagerInterface::class);
        $entityManager->expects($expectFlush ? self::once() : self::never())->method('flush')
            ->willReturnCallback(function (): void {
                $this->calls[] = 'flush';
            });
        $entityManager->expects($expectFlush ? self::once() : self::never())->method('persist');
        $entityManager->method('beginTransaction')
            ->willReturnCallback(function (): void {
                $this->calls[] = 'begin';
            });
        $entityManager->method('commit')
            ->willReturnCallback(function (): void {
                $this->calls[] = 'commit';
            });
        $entityManager->method('rollback')
            ->willReturnCallback(function (): void {
                $this->calls[] = 'rollback';
            });
        $entityManager->method('refresh')
            ->willReturnCallback(function (object $entity, LockMode|int|null $lockMode) use ($onRefresh): void {
                self::assertInstanceOf(FieldTranslation::class, $entity);
                $this->calls[] = 'refresh:' . ($lockMode === LockMode::PESSIMISTIC_WRITE ? 'write-lock' : 'no-lock');
                if ($onRefresh !== null) {
                    $onRefresh($entity);
                }
            });

        $dispatcher = $this->createStub(EventDispatcherInterface::class);
        $dispatcher->method('dispatch')
            ->willReturnCallback(function (object $event, ?string $name = null): object {
                self::assertInstanceOf(ContentEvent::class, $event);
                $this->events[] = (string) $name;

                return $event;
            });

        return new AltWriter($entityManager, $dispatcher, new FieldMetaProvider());
    }

    private function page(): Content
    {
        $content = Fixtures::content(5);
        Fixtures::addImage($content, 'image', ['cs' => ['filename' => 'a.jpg', 'alt' => '']], 'cs');
        Fixtures::addImagelist($content, 'gallery', [
            'cs' => [['filename' => 'g1.jpg', 'alt' => '']],
            'en' => [['filename' => 'g1.jpg', 'alt' => 'Filled']],
        ]);
        Fixtures::addImage($content, 'logo', ['cs' => ['filename' => 'logo.png']], 'cs');

        return $content;
    }

    public function testWritesImageAltAndDispatchesSaveEvents(): void
    {
        $content = $this->page();
        $content->setModifiedAt(new DateTime('2020-01-01 00:00:00'));

        $this->writer()
            ->write($content, 'image', null, 'cs', 'Bagr na stavbě', 'a.jpg');

        self::assertGreaterThan(new DateTime('-1 minute'), $content->getModifiedAt(), 'modifiedAt is bumped so caches and sitemaps notice');

        self::assertSame('Bagr na stavbě', $content->getField('image')->getTranslations()->get('cs')?->getValue()['alt']);
        self::assertSame([ContentEvent::PRE_SAVE, ContentEvent::POST_SAVE], $this->events);
    }

    public function testWritesImagelistItemInGivenLocale(): void
    {
        $content = $this->page();

        $this->writer()
            ->write($content, 'gallery', 0, 'cs', 'Pes');

        $translations = $content->getField('gallery')
            ->getTranslations();
        self::assertSame('Pes', $translations->get('cs')?->getValue()[0]['alt']);
        self::assertSame('Filled', $translations->get('en')?->getValue()[0]['alt']);
    }

    public function testRefusesAlreadyFilledAlt(): void
    {
        $this->expectException(AltAlreadyFilledException::class);

        $this->writer(false)
            ->write($this->page(), 'gallery', 0, 'en', 'Overwrite');
    }

    public function testRefusesUnknownLocale(): void
    {
        $this->expectException(ImageNotFoundException::class);
        $this->expectExceptionMessage('No value stored for locale "de".');

        $this->writer(false)
            ->write($this->page(), 'gallery', 0, 'de', 'Hund');
    }

    public function testRefusesFieldsWithoutAlt(): void
    {
        $this->expectException(ImageNotFoundException::class);

        $this->writer(false)
            ->write($this->page(), 'logo', null, 'cs', 'Logo');
    }

    public function testRefusesUndefinedField(): void
    {
        $this->expectException(ImageNotFoundException::class);

        $this->writer(false)
            ->write($this->page(), 'nope', null, 'cs', 'x');
    }

    public function testRefusesReplacedImage(): void
    {
        $this->expectException(ImageNotFoundException::class);

        $this->writer(false)
            ->write($this->page(), 'image', null, 'cs', 'x', 'other.jpg');
    }

    public function testRefusesLocalesTheContentTypeNoLongerHas(): void
    {
        $content = Fixtures::content(6);
        Fixtures::addImagelist($content, 'gallery', ['de' => [['filename' => 'a.jpg']]]);

        $this->expectException(ImageNotFoundException::class);

        $this->writer(false)
            ->write($content, 'gallery', 0, 'de', 'Hund');
    }

    public function testRereadsTheValueUnderAWriteLockInsideATransaction(): void
    {
        $this->writer()
            ->write($this->page(), 'image', null, 'cs', 'Bagr', 'a.jpg');

        self::assertSame(['begin', 'refresh:write-lock', 'flush', 'commit'], $this->calls);
    }

    public function testKeepsAnImagelistItemSavedConcurrentlyBySomeoneElse(): void
    {
        $content = Fixtures::content(7);
        Fixtures::addImagelist($content, 'gallery', [
            'cs' => [['filename' => 'g1.jpg', 'alt' => ''], ['filename' => 'g2.jpg', 'alt' => '']],
        ]);

        // Another request filled item 1 after this one loaded the record.
        $this->writer(true, static function (FieldTranslation $translation): void {
            $translation->setValue([['filename' => 'g1.jpg', 'alt' => ''], ['filename' => 'g2.jpg', 'alt' => 'Kočka']]);
        })->write($content, 'gallery', 0, 'cs', 'Pes', 'g1.jpg');

        $value = $content->getField('gallery')
            ->getTranslations()
            ->get('cs')?->getValue();
        self::assertIsArray($value);
        self::assertSame('Pes', $value[0]['alt']);
        self::assertSame('Kočka', $value[1]['alt'], 'the concurrent save is not overwritten');
    }

    public function testRollsBackWhenTheLockedReadShowsTheAltWasFilledMeanwhile(): void
    {
        $writer = $this->writer(false, static function (FieldTranslation $translation): void {
            $translation->setValue(['filename' => 'a.jpg', 'alt' => 'Filled by someone else']);
        });

        try {
            $writer->write($this->page(), 'image', null, 'cs', 'Bagr', 'a.jpg');
            self::fail('Expected AltAlreadyFilledException');
        } catch (AltAlreadyFilledException) {
        }

        self::assertSame(['begin', 'refresh:write-lock', 'rollback'], $this->calls);
        self::assertSame([], $this->events, 'no save events for a write that did not happen');
    }
}
