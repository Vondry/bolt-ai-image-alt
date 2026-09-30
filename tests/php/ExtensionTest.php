<?php

declare(strict_types=1);

namespace Tomvondracek\AiAlt\Tests;

use Bolt\Configuration\Config;
use Bolt\Widgets;
use PHPUnit\Framework\TestCase;
use Symfony\Component\DependencyInjection\Container;
use Symfony\Component\Filesystem\Filesystem;
use Tomvondracek\AiAlt\AssetInstaller;
use Tomvondracek\AiAlt\Extension;
use Tomvondracek\AiAlt\Widget\AiAltWidget;
use Twig\Environment;
use Twig\Loader\FilesystemLoader;

final class ExtensionTest extends TestCase
{
    public function testName(): void
    {
        self::assertSame('AI ALT', (new Extension())->getName());
        self::assertSame('ai-alt', (new Extension())->getSlug());
    }

    public function testAssetVersionFollowsBuild(): void
    {
        self::assertSame((string) filemtime(AssetInstaller::sourceDirectory() . '/ai-alt.js'), Extension::assetVersion());
    }

    public function testSiteDefaultLocaleFromContainer(): void
    {
        $container = new Container();
        $container->setParameter('locale', 'cs');

        $extension = new Extension();
        $extension->injectObjects([
            'manager' => null,
            'query' => null,
            'container' => $container,
        ]);

        self::assertSame('cs', $extension->getSiteDefaultLocale());
    }

    public function testSiteDefaultLocaleFallsBackToEnglish(): void
    {
        $extension = new Extension();
        $extension->injectObjects([
            'manager' => null,
            'query' => null,
            'container' => new Container(),
        ]);

        self::assertSame('en', $extension->getSiteDefaultLocale());
    }

    private function extensionWithServices(string $dir, ?Widgets $widgets = null, ?Environment $twig = null): Extension
    {
        $boltConfig = $this->createStub(Config::class);
        $boltConfig->method('getPath')
            ->willReturnCallback(static fn (string $name): string => $dir . '/' . $name);

        $container = new Container();
        $container->set(Config::class, $boltConfig);
        $container->set(Widgets::class, $widgets ?? $this->createStub(Widgets::class));
        $container->set('twig', $twig ?? new Environment(new FilesystemLoader()));

        $extension = new Extension();
        $extension->injectObjects([
            'manager' => null,
            'query' => null,
            'container' => $container,
        ]);

        return $extension;
    }

    public function testInitializeRegistersTwigNamespaceAndWidget(): void
    {
        $dir = sys_get_temp_dir() . '/ai-alt-ext-' . bin2hex(random_bytes(4));
        mkdir($dir . '/extensions_config', 0o777, true);

        try {
            $widgets = $this->createMock(Widgets::class);
            $widgets->expects(self::once())->method('registerWidget')->with(self::isInstanceOf(AiAltWidget::class));
            $loader = new FilesystemLoader();

            $extension = $this->extensionWithServices($dir, $widgets, new Environment($loader));
            $extension->initialize();

            self::assertContains(dirname(__DIR__, 2) . '/templates', $loader->getPaths('ai-alt'));
            self::assertFileExists($dir . '/extensions_config/tomvondracek-aialt.yaml', 'default config copied to the project');
            self::assertSame(125, $extension->getAiAltConfig()->maxLength);
        } finally {
            (new Filesystem())->remove($dir);
        }
    }

    public function testInitializeSkipsWidgetWhenDisabled(): void
    {
        $dir = sys_get_temp_dir() . '/ai-alt-ext-' . bin2hex(random_bytes(4));
        mkdir($dir . '/extensions_config', 0o777, true);
        file_put_contents($dir . '/extensions_config/tomvondracek-aialt.yaml', "enabled: false\n");

        try {
            $widgets = $this->createMock(Widgets::class);
            $widgets->expects(self::never())->method('registerWidget');

            $this->extensionWithServices($dir, $widgets)
                ->initialize();
        } finally {
            (new Filesystem())->remove($dir);
        }
    }

    public function testInstallCopiesAssetsToWebRoot(): void
    {
        $dir = sys_get_temp_dir() . '/ai-alt-ext-' . bin2hex(random_bytes(4));
        mkdir($dir . '/web', 0o777, true);

        try {
            $this->extensionWithServices($dir)
                ->install();

            self::assertFileEquals(AssetInstaller::sourceDirectory() . '/ai-alt.js', $dir . '/web/extensions/ai-alt/ai-alt.js');
            self::assertFileExists($dir . '/web/extensions/ai-alt/ort/ort-wasm-simd-threaded.wasm');
        } finally {
            (new Filesystem())->remove($dir);
        }
    }
}
