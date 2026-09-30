<?php

declare(strict_types=1);

namespace Tomvondracek\AiAlt\Widget;

use Bolt\Configuration\Config;
use Bolt\Entity\Content;
use Bolt\Entity\User;
use Bolt\Widget\BaseWidget;
use Bolt\Widget\Injector\RequestZone;
use Bolt\Widget\Injector\Target;
use Bolt\Widget\RequestAwareInterface;
use Bolt\Widget\TwigAwareInterface;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\Request;
use Throwable;
use Tomvondracek\AiAlt\Extension;

/**
 * Injects the config JSON and the bootstrap script into the content edit page.
 *
 * Injected before `</body>` rather than into an `editcontent_*` zone: those
 * zones live inside the Vue root (`#editor`), and Vue 2 drops `<script>` tags
 * from in-DOM templates. They are also rendered without the record, so the
 * ContentType is resolved from the route parameters either way.
 */
class AiAltWidget extends BaseWidget implements TwigAwareInterface, RequestAwareInterface
{
    public const EDIT_ROUTES = ['bolt_content_edit', 'bolt_content_edit_post', 'bolt_content_duplicate', 'bolt_content_duplicate_post'];
    public const NEW_ROUTE = 'bolt_content_new';

    protected $name = 'AI ALT';
    protected $target = Target::END_OF_BODY;
    protected $priority = 900;
    protected $template = '@ai-alt/widget.html.twig';
    protected $zone = RequestZone::BACKEND;

    /**
     * @param array<string, mixed> $params
     */
    protected function run(array $params = []): ?string
    {
        $extension = $this->getExtension();
        if (! $extension instanceof Extension) {
            return null;
        }

        $config = ClientConfig::forEditor(
            $extension->getAiAltConfig(),
            $this->resolveContentType($this->getRequest(), $extension->getBoltConfig(), $extension->getObjectManager()),
            $extension->getSiteDefaultLocale(),
            $this->uiLocale($extension),
            Extension::assetVersion(),
            $this->getRequest()
                ->getBasePath(),
        );

        if ($config === null) {
            return null;
        }

        return parent::run($params + [
            'config' => $config,
            'configJson' => ClientConfig::toJson($config),
        ]);
    }

    /**
     * @return iterable<array-key, mixed>|null
     */
    public function resolveContentType(Request $request, Config $boltConfig, ?EntityManagerInterface $entityManager): ?iterable
    {
        $route = $request->attributes->get('_route');
        $slug = null;

        if ($route === self::NEW_ROUTE) {
            $slug = $request->attributes->get('contentType');
        } elseif (in_array($route, self::EDIT_ROUTES, true) && $entityManager !== null) {
            $id = $request->attributes->get('id');
            $content = is_numeric($id) ? $entityManager->getRepository(Content::class)->find((int) $id) : null;
            $slug = $content?->getContentType();
        }

        return is_string($slug) && $slug !== '' ? $boltConfig->getContentType($slug) : null;
    }

    private function uiLocale(Extension $extension): string
    {
        try {
            $user = $extension->getService('security.token_storage')?->getToken()?->getUser();
        } catch (Throwable) {
            $user = null;
        }

        return $user instanceof User ? ($user->getLocale() ?: 'en') : 'en';
    }
}
