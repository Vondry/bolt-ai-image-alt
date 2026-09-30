<?php

declare(strict_types=1);

namespace Tomvondracek\AiAlt\Menu;

use Bolt\Menu\ExtensionBackendMenuInterface;
use Knp\Menu\MenuItem;
use Symfony\Component\DependencyInjection\Attribute\AutoconfigureTag;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Component\Security\Core\Authorization\AuthorizationCheckerInterface;
use Tomvondracek\AiAlt\AiAltConfigLoader;

/**
 * Adds "AI ALT" to the backend sidebar, linking to the batch page.
 */
#[AutoconfigureTag('bolt.extension_backend_menu')]
class AiAltMenu implements ExtensionBackendMenuInterface
{
    public function __construct(
        private readonly UrlGeneratorInterface $urlGenerator,
        private readonly AuthorizationCheckerInterface $authorizationChecker,
        private readonly AiAltConfigLoader $configLoader,
    ) {
    }

    public function addItems(MenuItem $menu): void
    {
        $config = $this->configLoader->load();

        if (! $config->enabled || ! $this->authorizationChecker->isGranted($config->batchPagePermission)) {
            return;
        }

        $menu->addChild('AI ALT', [
            'uri' => $this->urlGenerator->generate('ai_alt_batch'),
            'extras' => [
                'name' => 'AI ALT',
                'icon' => 'fa-magic',
                'slug' => 'ai-alt',
            ],
        ]);
    }
}
