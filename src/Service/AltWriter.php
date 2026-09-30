<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Service;

use Bolt\Entity\Content;
use Bolt\Entity\FieldTranslation;
use Bolt\Event\ContentEvent;
use Doctrine\DBAL\Exception\RetryableException;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Contracts\EventDispatcher\EventDispatcherInterface;
use Throwable;
use Tvondracek\AiAlt\Exception\AltAlreadyFilledException;
use Tvondracek\AiAlt\Exception\ImageNotFoundException;

/**
 * Persists one alt text into a stored `image` / `imagelist` field value.
 */
class AltWriter
{
    public function __construct(
        private readonly EntityManagerInterface $entityManager,
        private readonly EventDispatcherInterface $dispatcher,
        private readonly FieldMetaProvider $fieldMetaProvider,
    ) {
    }

    /**
     * @throws ImageNotFoundException when the field, locale or image does not exist (any more)
     * @throws AltAlreadyFilledException when someone filled the alt in the meantime
     * @throws RetryableException when another save holds the lock too long, or deadlocks with this one
     */
    public function write(Content $content, string $fieldName, ?int $index, string $locale, string $alt, ?string $expectedFilename = null): void
    {
        $definition = $content->getDefinition();
        $fieldDefinitions = $definition?->get('fields');
        $meta = is_iterable($fieldDefinitions) ? $this->fieldMetaProvider->batchableFields($fieldDefinitions) : [];

        if (! isset($meta[$fieldName]) || ! $content->hasField($fieldName)) {
            throw new ImageNotFoundException(sprintf('Field "%s" is not an image field with an alt text.', $fieldName));
        }

        $field = $content->getField($fieldName);
        $locales = MissingAltFinder::localeList($definition?->get('locales'));
        $translation = $this->findTranslation(MissingAltFinder::relevantTranslations($field, $meta[$fieldName]['localized'], $locales), $locale);

        // The whole field value is one row: a save of a sibling imagelist item
        // that committed after this request loaded the record would be undone
        // by writing our stale copy back. Re-read the row under a write lock.
        // Not wrapInTransaction(): it closes the EntityManager on any exception.
        $this->entityManager->beginTransaction();

        try {
            $this->entityManager->refresh($translation, LockMode::PESSIMISTIC_WRITE);
            $translation->setValue(AltValue::withAlt($meta[$fieldName]['type'], $translation->getValue(), $index, $alt, $expectedFilename));

            // Only the translation row changes otherwise, so Content's PreUpdate
            // callbacks (modifiedAt, title) would not run: sitemaps, caches and
            // "recently modified" lists would miss the change.
            $content->updateModifiedAt();

            // Same events as a save from the edit screen, so caches and other
            // extensions stay consistent.
            $this->dispatcher->dispatch(new ContentEvent($content), ContentEvent::PRE_SAVE);
            $this->entityManager->persist($content);
            $this->entityManager->flush();
            $this->entityManager->commit();
        } catch (Throwable $e) {
            $this->entityManager->rollback();

            throw $e;
        }

        $this->dispatcher->dispatch(new ContentEvent($content), ContentEvent::POST_SAVE);
    }

    /**
     * @param list<FieldTranslation> $translations
     */
    private function findTranslation(array $translations, string $locale): FieldTranslation
    {
        foreach ($translations as $translation) {
            if ($translation->getLocale() === $locale) {
                return $translation;
            }
        }

        throw new ImageNotFoundException(sprintf('No value stored for locale "%s".', $locale));
    }
}
