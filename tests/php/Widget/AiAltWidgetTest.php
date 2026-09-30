<?php

declare(strict_types=1);

namespace Tomvondracek\AiAlt\Tests\Widget;

use Bolt\Configuration\Config;
use Bolt\Configuration\Content\ContentType;
use Bolt\Entity\Content;
use Bolt\Entity\User;
use Bolt\Extension\BaseExtension;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityRepository;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorage;
use Symfony\Component\Security\Core\Authentication\Token\UsernamePasswordToken;
use Tomvondracek\AiAlt\AiAltConfig;
use Tomvondracek\AiAlt\Extension;
use Tomvondracek\AiAlt\Tests\Fixtures;
use Tomvondracek\AiAlt\Widget\AiAltWidget;
use Twig\Environment;
use Twig\Loader\FilesystemLoader;

final class AiAltWidgetTest extends TestCase
{
    private function boltConfig(): Config
    {
        $boltConfig = $this->createStub(Config::class);
        $boltConfig->method('getContentType')
            ->willReturnCallback(
                static fn (string $slug): mixed => $slug === 'pages' ? Fixtures::contentType() : null
            );

        return $boltConfig;
    }

    private function entityManager(?Content $content): EntityManagerInterface
    {
        $repository = $this->createStub(EntityRepository::class);
        $repository->method('find')
            ->willReturn($content);

        $entityManager = $this->createStub(EntityManagerInterface::class);
        $entityManager->method('getRepository')
            ->willReturn($repository);

        return $entityManager;
    }

    /**
     * @param array<string, mixed> $attributes
     */
    private static function request(string $route, array $attributes = []): Request
    {
        $request = new Request();
        $request->attributes->add(['_route' => $route] + $attributes);

        return $request;
    }

    public function testResolvesContentTypeOnEditRoute(): void
    {
        $contentType = (new AiAltWidget())->resolveContentType(
            self::request('bolt_content_edit', ['id' => '5']),
            $this->boltConfig(),
            $this->entityManager(Fixtures::content(5))
        );

        self::assertInstanceOf(ContentType::class, $contentType);
        self::assertSame('pages', $contentType->getSlug());
    }

    public function testResolvesContentTypeOnNewRoute(): void
    {
        $contentType = (new AiAltWidget())->resolveContentType(
            self::request('bolt_content_new', ['contentType' => 'pages']),
            $this->boltConfig(),
            null
        );

        self::assertNotNull($contentType);
    }

    public function testNoContentTypeElsewhere(): void
    {
        $widget = new AiAltWidget();

        self::assertNull($widget->resolveContentType(self::request('bolt_dashboard'), $this->boltConfig(), $this->entityManager(null)));
        self::assertNull($widget->resolveContentType(self::request('bolt_content_edit', ['id' => 'x']), $this->boltConfig(), $this->entityManager(null)));
        self::assertNull($widget->resolveContentType(self::request('bolt_content_edit', ['id' => '404']), $this->boltConfig(), $this->entityManager(null)));
        self::assertNull($widget->resolveContentType(self::request('bolt_content_edit', ['id' => '5']), $this->boltConfig(), null));
        self::assertNull($widget->resolveContentType(self::request('bolt_content_new', ['contentType' => '']), $this->boltConfig(), null));
    }

    /**
     * @param array<string, mixed> $config
     */
    private function widget(array $config, Request $request, ?User $user = null): AiAltWidget
    {
        $tokenStorage = new TokenStorage();
        if ($user !== null) {
            $tokenStorage->setToken(new UsernamePasswordToken($user, 'main', $user->getRoles()));
        }

        $extension = $this->createStub(Extension::class);
        $extension->method('getAiAltConfig')
            ->willReturn(AiAltConfig::fromArray($config));
        $extension->method('getBoltConfig')
            ->willReturn($this->boltConfig());
        $extension->method('getObjectManager')
            ->willReturn($this->entityManager(Fixtures::content(5)));
        $extension->method('getSiteDefaultLocale')
            ->willReturn('en');
        $extension->method('getService')
            ->willReturn($tokenStorage);

        $widget = new AiAltWidget();
        $widget->injectExtension($extension);
        $widget->setTwig(new Environment(new FilesystemLoader()));
        $widget->setRequest($request);

        return $widget;
    }

    public function testRendersConfigAndScriptOnEditPage(): void
    {
        $user = new User();
        $user->setLocale('cs');

        $html = (string) $this->widget([], self::request('bolt_content_edit', ['id' => '5']), $user)();

        self::assertStringContainsString('<script type="application/json" id="ai-alt-config">', $html);
        self::assertStringContainsString('<script type="module" src="/extensions/ai-alt/ai-alt.js', $html);
        self::assertStringContainsString('href="/extensions/ai-alt/ai-alt.css', $html);

        preg_match('#<script type="application/json" id="ai-alt-config">(.*?)</script>#s', $html, $matches);
        $config = json_decode($matches[1] ?? '', true);
        self::assertIsArray($config);
        self::assertSame('pages', $config['contentType']);
        self::assertSame('cs', $config['uiLocale']);
        self::assertSame('<CAPTION>', $config['task']);
    }

    public function testRendersNothingWhenNotApplicable(): void
    {
        self::assertNull($this->widget([], self::request('bolt_dashboard'))());
        self::assertNull($this->widget(['enabled' => false], self::request('bolt_content_edit', ['id' => '5']))());
    }

    public function testRendersNothingWithoutOurExtension(): void
    {
        $widget = new AiAltWidget();
        $widget->injectExtension($this->createStub(BaseExtension::class));

        self::assertNull($widget());
    }

    public function testFallsBackToEnglishUi(): void
    {
        $html = (string) $this->widget([], self::request('bolt_content_new', ['contentType' => 'pages']))();

        self::assertStringContainsString('"uiLocale":"en"', $html);
    }

    public function testPrefixesUrlsWhenBoltRunsInASubdirectory(): void
    {
        $request = Request::create('https://example.com/cms/index.php/bolt/edit/5', server: [
            'SCRIPT_FILENAME' => '/var/www/cms/index.php',
            'SCRIPT_NAME' => '/cms/index.php',
            'PHP_SELF' => '/cms/index.php',
        ]);
        $request->attributes->add(['_route' => 'bolt_content_edit', 'id' => '5']);

        $html = (string) $this->widget([], $request)();

        self::assertStringContainsString('src="/cms/extensions/ai-alt/ai-alt.js', $html);
        self::assertStringContainsString('"thumbsBase":"/cms/thumbs"', $html);
    }
}
