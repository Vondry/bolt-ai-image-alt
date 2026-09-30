<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Tests\Menu;

use Knp\Menu\MenuFactory;
use Knp\Menu\MenuItem;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Component\Security\Core\Authorization\AuthorizationCheckerInterface;
use Tvondracek\AiAlt\AiAltConfig;
use Tvondracek\AiAlt\AiAltConfigLoader;
use Tvondracek\AiAlt\Menu\AiAltMenu;

final class AiAltMenuTest extends TestCase
{
    /**
     * @param array<string, mixed> $config
     */
    private function menu(array $config, bool $granted): MenuItem
    {
        $urlGenerator = $this->createStub(UrlGeneratorInterface::class);
        $urlGenerator->method('generate')
            ->willReturn('/bolt/ai-alt/batch');

        $authorization = $this->createMock(AuthorizationCheckerInterface::class);
        $authorization->method('isGranted')
            ->with('ROLE_EDITOR')
            ->willReturn($granted);

        $loader = $this->createStub(AiAltConfigLoader::class);
        $loader->method('load')
            ->willReturn(AiAltConfig::fromArray($config));

        $menu = new MenuItem('root', new MenuFactory());
        (new AiAltMenu($urlGenerator, $authorization, $loader))->addItems($menu);

        return $menu;
    }

    public function testAddsBatchPageLink(): void
    {
        $item = $this->menu([], true)->getChild('AI ALT');

        self::assertNotNull($item);
        self::assertSame('/bolt/ai-alt/batch', $item->getUri());
        self::assertSame('fa-magic', $item->getExtra('icon'));
    }

    public function testHiddenWithoutPermission(): void
    {
        self::assertNull($this->menu([], false)->getChild('AI ALT'));
    }

    public function testHiddenWhenDisabled(): void
    {
        self::assertNull($this->menu(['enabled' => false], true)->getChild('AI ALT'));
    }
}
