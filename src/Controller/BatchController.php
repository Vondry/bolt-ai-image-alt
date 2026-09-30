<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Controller;

use Bolt\Controller\CsrfTrait;
use Bolt\Entity\Content;
use Bolt\Entity\User;
use Bolt\Extension\ExtensionController;
use Bolt\Security\ContentVoter;
use Doctrine\DBAL\Exception\RetryableException;
use JsonException;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Component\Security\Csrf\CsrfToken;
use Tvondracek\AiAlt\AiAltConfigLoader;
use Tvondracek\AiAlt\Exception\AltAlreadyFilledException;
use Tvondracek\AiAlt\Exception\ImageNotFoundException;
use Tvondracek\AiAlt\Extension;
use Tvondracek\AiAlt\Service\AltWriter;
use Tvondracek\AiAlt\Service\ContentSource;
use Tvondracek\AiAlt\Service\MissingAltFinder;
use Tvondracek\AiAlt\UiTranslations;
use Tvondracek\AiAlt\Widget\ClientConfig;

/**
 * Batch page: fills missing alt texts on existing content. Captioning runs in
 * the editor's browser; this controller only lists work and stores results.
 *
 * Routes live under `/bolt/ai-alt/`, not `/bolt/extensions/ai-alt/`: core's
 * `bolt_extensions_view` route (`/extensions/{name}` with `name: .+`) is
 * registered first and would swallow them.
 */
#[Route('%bolt.backend_url%/ai-alt', name: 'ai_alt_')]
class BatchController extends ExtensionController
{
    use CsrfTrait;

    public const CSRF_TOKEN_ID = 'ai_alt_save';
    public const MAX_ALT_LENGTH = 500;
    private const MAX_LIMIT = 2000;

    #[Route('/batch', name: 'batch', methods: [Request::METHOD_GET])]
    public function batch(Request $request, AiAltConfigLoader $configLoader, MissingAltFinder $finder): Response
    {
        $config = $configLoader->load();
        $this->denyAccessUnlessGranted($config->batchPagePermission);

        // No counting here: that would scan all content, and the page loads the
        // full list from /missing right away anyway (counts are derived there).
        $contentTypes = $finder->contentTypes();

        $uiLocale = $this->uiLocale();
        $clientConfig = ClientConfig::build($config, [
            'defaultLocale' => null,
            'fieldMeta' => [],
            ...ClientConfig::paths($request->getBasePath()),
            'assetVersion' => Extension::assetVersion(),
            'uiLocale' => $uiLocale,
            'batch' => [
                'missingUrl' => $this->generateUrl('ai_alt_missing'),
                'saveUrl' => $this->generateUrl('ai_alt_save'),
                'csrfToken' => $this->csrfTokenManager->getToken(self::CSRF_TOKEN_ID)->getValue(),
                'contentTypes' => array_map(
                    static fn (array $info): array => ['slug' => $info['slug'], 'name' => $info['name']],
                    array_values($contentTypes)
                ),
            ],
        ]);

        return $this->render('@ai-alt/batch.html.twig', [
            'aiAlt' => $clientConfig,
            'configJson' => ClientConfig::toJson($clientConfig),
            'enabled' => $config->enabled,
            'title' => UiTranslations::translate('batchTitle', $uiLocale),
        ]);
    }

    #[Route('/missing', name: 'missing', methods: [Request::METHOD_GET])]
    public function missing(Request $request, AiAltConfigLoader $configLoader, MissingAltFinder $finder): JsonResponse
    {
        $this->denyAccessUnlessGranted($configLoader->load()->batchPagePermission);

        $contentType = $request->query->getString('contenttype') ?: null;
        $offset = max(0, $request->query->getInt('offset'));
        $limit = min(self::MAX_LIMIT, max(1, $request->query->getInt('limit', self::MAX_LIMIT)));

        // Only records the user may edit: saving would be refused anyway, and
        // titles/filenames of other records are none of their business.
        $items = $finder->find($contentType, $this->canEdit(...));
        $page = array_slice($items, $offset, $limit);

        foreach ($page as &$item) {
            $item['editUrl'] = $this->generateUrl('bolt_content_edit', ['id' => $item['contentId'], 'edit_locale' => $item['locale']], UrlGeneratorInterface::ABSOLUTE_PATH);
        }
        unset($item);

        return $this->json([
            'items' => $page,
            'total' => count($items),
            'offset' => $offset,
            'limit' => $limit,
        ]);
    }

    #[Route('/save', name: 'save', methods: [Request::METHOD_POST])]
    public function save(Request $request, ContentSource $contentSource, AltWriter $writer, AiAltConfigLoader $configLoader): JsonResponse
    {
        // Same gates as the batch page itself.
        $config = $configLoader->load();
        if (! $config->enabled || ! $this->isGranted($config->batchPagePermission)) {
            return $this->error('The AI ALT batch page is disabled or not available to you.', Response::HTTP_FORBIDDEN);
        }

        try {
            $payload = json_decode($request->getContent(), true, 8, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return $this->error('Invalid JSON body.', Response::HTTP_BAD_REQUEST);
        }

        if (! is_array($payload)) {
            return $this->error('Invalid JSON body.', Response::HTTP_BAD_REQUEST);
        }

        $token = $request->headers->get('X-CSRF-Token') ?? ($payload['_csrf_token'] ?? null);
        if (! is_string($token) || ! $this->csrfTokenManager->isTokenValid(new CsrfToken(self::CSRF_TOKEN_ID, $token))) {
            return $this->error('Invalid CSRF token.', Response::HTTP_FORBIDDEN);
        }

        $contentId = $payload['contentId'] ?? null;
        $field = $payload['field'] ?? null;
        $index = $payload['index'] ?? null;
        $locale = $payload['locale'] ?? null;
        $alt = $payload['alt'] ?? null;
        $filename = $payload['filename'] ?? null;

        if (! is_int($contentId) || ! is_string($field) || ! is_string($locale) || ! is_string($alt)
            || ($index !== null && ! is_int($index)) || ($filename !== null && ! is_string($filename))) {
            return $this->error('Missing or invalid parameters.', Response::HTTP_BAD_REQUEST);
        }

        // Checked before sanitising too: the regexes should not chew on megabytes.
        if (mb_strlen($alt) > self::MAX_ALT_LENGTH * 4) {
            return $this->error('The alt text is empty or too long.', Response::HTTP_BAD_REQUEST);
        }

        $alt = self::sanitiseAlt($alt);
        if ($alt === '' || mb_strlen($alt) > self::MAX_ALT_LENGTH) {
            return $this->error('The alt text is empty or too long.', Response::HTTP_BAD_REQUEST);
        }

        $content = $contentSource->find($contentId);
        if ($content === null) {
            return $this->error('Content not found.', Response::HTTP_NOT_FOUND);
        }

        if (! $config->isContentTypeAllowed((string) $content->getContentType())) {
            return $this->error('AI ALT is not enabled for this content type.', Response::HTTP_FORBIDDEN);
        }

        if (! $this->isGranted(ContentVoter::CONTENT_EDIT, $content)) {
            return $this->error('You are not allowed to edit this content.', Response::HTTP_FORBIDDEN);
        }

        try {
            $writer->write($content, $field, $index, $locale, $alt, $filename);
        } catch (AltAlreadyFilledException $e) {
            return $this->error($e->getMessage(), Response::HTTP_CONFLICT);
        } catch (ImageNotFoundException $e) {
            return $this->error($e->getMessage(), Response::HTTP_NOT_FOUND);
        } catch (RetryableException) {
            // Lock wait timeout or deadlock with another save of the same field.
            return $this->error('The record is being saved by someone else, please try again.', Response::HTTP_SERVICE_UNAVAILABLE);
        }

        return $this->json(['status' => 'saved', 'alt' => $alt]);
    }

    /**
     * Removes markup but keeps literal `<` / `>` (strip_tags() would cut
     * "Price < 5 CZK" to "Price "). Output is escaped by Twig anyway.
     * Control characters are turned into spaces like any other whitespace.
     */
    public static function sanitiseAlt(string $alt): string
    {
        $withoutTags = preg_replace('#</?[a-z][^<>]*>|<!--.*?-->#isu', ' ', $alt) ?? '';

        return trim(preg_replace('/[\s\p{Cc}]+/u', ' ', $withoutTags) ?? '');
    }

    private function canEdit(Content $content): bool
    {
        return $this->isGranted(ContentVoter::CONTENT_EDIT, $content);
    }

    private function uiLocale(): string
    {
        $user = $this->getUser();

        return $user instanceof User ? ($user->getLocale() ?: 'en') : 'en';
    }

    private function error(string $message, int $status): JsonResponse
    {
        return $this->json(['status' => 'error', 'message' => $message], $status);
    }
}
