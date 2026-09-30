<?php

declare(strict_types=1);

namespace Tvondracek\AiAlt\Tests\Controller;

use Bolt\Configuration\Config;
use Bolt\Entity\Content;
use Bolt\Entity\User;
use Bolt\Security\ContentVoter;
use Doctrine\DBAL\Driver\AbstractException;
use Doctrine\DBAL\Exception\LockWaitTimeoutException;
use PHPUnit\Framework\TestCase;
use Symfony\Component\DependencyInjection\Container;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorage;
use Symfony\Component\Security\Core\Authentication\Token\UsernamePasswordToken;
use Symfony\Component\Security\Core\Authorization\AuthorizationCheckerInterface;
use Symfony\Component\Security\Core\Exception\AccessDeniedException;
use Symfony\Component\Security\Csrf\CsrfToken;
use Symfony\Component\Security\Csrf\CsrfTokenManagerInterface;
use Tvondracek\AiAlt\AiAltConfig;
use Tvondracek\AiAlt\AiAltConfigLoader;
use Tvondracek\AiAlt\Controller\BatchController;
use Tvondracek\AiAlt\Exception\AltAlreadyFilledException;
use Tvondracek\AiAlt\Exception\ImageNotFoundException;
use Tvondracek\AiAlt\Service\AltWriter;
use Tvondracek\AiAlt\Service\MissingAltFinder;
use Tvondracek\AiAlt\Tests\Fixtures;
use Twig\Environment;

final class BatchControllerTest extends TestCase
{
    private const TOKEN = 'valid-token';

    /** @var array<string, bool> attribute => granted */
    private array $granted = [
        'ROLE_EDITOR' => true,
        ContentVoter::CONTENT_EDIT => true,
    ];

    /** @var array<string, mixed>|null */
    private ?array $renderedContext = null;

    private ?string $renderedTemplate = null;

    /** @var list<int>|null content ids the user may edit; null = all */
    private ?array $editableIds = null;

    private function controller(?User $user = null): BatchController
    {
        $authorization = $this->createStub(AuthorizationCheckerInterface::class);
        $authorization->method('isGranted')
            ->willReturnCallback(fn (mixed $attribute, mixed $subject = null): bool => ($this->granted[(string) $attribute] ?? false)
                && ($this->editableIds === null || ! $subject instanceof Content || in_array($subject->getId(), $this->editableIds, true)));

        $router = $this->createStub(UrlGeneratorInterface::class);
        $router->method('generate')
            ->willReturnCallback(
                static fn (string $name, array $parameters = []): string => '/' . $name . ($parameters !== [] ? '?' . http_build_query($parameters) : '')
            );

        $twig = $this->createStub(Environment::class);
        $twig->method('render')
            ->willReturnCallback(function (string $template, array $context): string {
                $this->renderedTemplate = $template;
                $this->renderedContext = $context;

                return '<html>batch</html>';
            });

        $tokenStorage = new TokenStorage();
        if ($user !== null) {
            $tokenStorage->setToken(new UsernamePasswordToken($user, 'main', $user->getRoles()));
        }

        $container = new Container();
        $container->set('security.authorization_checker', $authorization);
        $container->set('router', $router);
        $container->set('twig', $twig);
        $container->set('security.token_storage', $tokenStorage);

        $csrf = $this->createStub(CsrfTokenManagerInterface::class);
        $csrf->method('isTokenValid')
            ->willReturnCallback(
                static fn (CsrfToken $token): bool => $token->getId() === BatchController::CSRF_TOKEN_ID && $token->getValue() === self::TOKEN
            );
        $csrf->method('getToken')
            ->willReturn(new CsrfToken(BatchController::CSRF_TOKEN_ID, self::TOKEN));

        $controller = new BatchController($this->createStub(Config::class));
        $controller->setContainer($container);
        $controller->setCsrfTokenManager($csrf);

        return $controller;
    }

    /**
     * @param array<string, mixed> $config
     */
    private function loader(array $config = []): AiAltConfigLoader
    {
        $loader = $this->createStub(AiAltConfigLoader::class);
        $loader->method('load')
            ->willReturn(AiAltConfig::fromArray($config));

        return $loader;
    }

    /**
     * @param list<array<string, mixed>> $items
     */
    private function finder(array $items = []): MissingAltFinder
    {
        $finder = $this->createStub(MissingAltFinder::class);
        $finder->method('contentTypes')
            ->willReturn([
                'pages' => ['slug' => 'pages', 'name' => 'Pages', 'defaultLocale' => 'cs', 'fields' => []],
            ]);
        // Like the real finder: keep only items whose record passes $canEdit.
        $filter = static fn (?callable $canEdit): array => array_values(array_filter(
            $items,
            static fn (array $item): bool => $canEdit === null || $canEdit(Fixtures::content((int) ($item['contentId'] ?? 0)))
        ));
        $finder->method('find')
            ->willReturnCallback(static fn (?string $contentType = null, ?callable $canEdit = null): array => $filter($canEdit));

        return $finder;
    }

    /**
     * @param array<string, mixed>|string $body
     * @param array<string, string> $headers
     */
    private function saveRequest(array|string $body, array $headers = ['HTTP_X_CSRF_TOKEN' => self::TOKEN]): Request
    {
        return new Request([], [], [], [], [], $headers + ['REQUEST_METHOD' => 'POST'], is_string($body) ? $body : json_encode($body, JSON_THROW_ON_ERROR));
    }

    /**
     * @param array<string, mixed> $overrides
     *
     * @return array<string, mixed>
     */
    private static function payload(array $overrides = []): array
    {
        return array_replace([
            'contentId' => 5,
            'field' => 'image',
            'index' => null,
            'locale' => 'cs',
            'alt' => '  Bagr   na <b>stavbě</b> ',
            'filename' => 'a.jpg',
        ], $overrides);
    }

    /**
     * @return array<string, mixed>
     */
    private static function decode(Response $response): array
    {
        self::assertInstanceOf(JsonResponse::class, $response);
        $data = json_decode((string) $response->getContent(), true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($data);

        return $data;
    }

    private function writer(?\Throwable $throw = null, int $expectedCalls = 1): AltWriter
    {
        $writer = $this->createMock(AltWriter::class);
        $expectation = $writer->expects(self::exactly($expectedCalls))->method('write');
        if ($throw !== null) {
            $expectation->willThrowException($throw);
        }

        return $writer;
    }

    public function testBatchPageRendersConfig(): void
    {
        $user = new User();
        $user->setLocale('cs');
        $user->setRoles(['ROLE_EDITOR']);

        $response = $this->controller($user)
            ->batch(new Request(), $this->loader(), $this->finder([['contentType' => 'pages']]));

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('@ai-alt/batch.html.twig', $this->renderedTemplate);
        self::assertNotNull($this->renderedContext);
        self::assertTrue($this->renderedContext['enabled']);

        $config = $this->renderedContext['aiAlt'];
        self::assertIsArray($config);
        self::assertSame('cs', $config['uiLocale']);
        self::assertSame('/extensions/ai-alt', $config['assetBase']);
        self::assertSame([
            'missingUrl' => '/ai_alt_missing',
            'saveUrl' => '/ai_alt_save',
            'csrfToken' => self::TOKEN,
            'contentTypes' => [['slug' => 'pages', 'name' => 'Pages']],
        ], $config['batch']);
        self::assertIsString($this->renderedContext['configJson'] ?? null);
        self::assertStringNotContainsString('<', (string) $this->renderedContext['configJson'], 'JSON is safe inside <script>');
    }

    public function testBatchPageSupportsBoltInASubdirectory(): void
    {
        $request = Request::create('https://example.com/cms/index.php/bolt/ai-alt/batch', server: [
            'SCRIPT_FILENAME' => '/var/www/cms/index.php',
            'SCRIPT_NAME' => '/cms/index.php',
            'PHP_SELF' => '/cms/index.php',
        ]);
        self::assertSame('/cms', $request->getBasePath());

        $this->controller()
            ->batch(Request::create('/'), $this->loader(), $this->finder());
        self::assertSame('/extensions/ai-alt', $this->renderedContext['aiAlt']['assetBase'] ?? null);

        $this->controller()
            ->batch($request, $this->loader(), $this->finder());
        self::assertSame('/cms/extensions/ai-alt', $this->renderedContext['aiAlt']['assetBase'] ?? null);
        self::assertSame('/cms/thumbs', $this->renderedContext['aiAlt']['thumbsBase'] ?? null);
    }

    /**
     * @return iterable<string, array{string, string}>
     */
    public static function alts(): iterable
    {
        yield 'plain' => ['Bagr na stavbě', 'Bagr na stavbě'];
        yield 'whitespace' => ["  Bagr \n\t na   stavbě ", 'Bagr na stavbě'];
        yield 'tags' => ['<b>Bagr</b> na <a href="x">stavbě</a>', 'Bagr na stavbě'];
        yield 'script' => ['<script>alert(1)</script>Pes', 'alert(1) Pes'];
        yield 'comment' => ['Pes<!-- hidden -->', 'Pes'];
        yield 'less than' => ['Price < 5 CZK', 'Price < 5 CZK'];
        yield 'greater than' => ['2 > 1', '2 > 1'];
        yield 'arrows' => ['a <-> b', 'a <-> b'];
        yield 'unicode' => ['Štěně 🐶', 'Štěně 🐶'];
        yield 'control characters' => ["Bagr\x00na\x1Fstavbě\x7F", 'Bagr na stavbě'];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('alts')]
    public function testSanitiseAlt(string $input, string $expected): void
    {
        self::assertSame($expected, BatchController::sanitiseAlt($input));
    }

    public function testBatchPageDefaultsUiLocaleToEnglish(): void
    {
        $this->controller()
            ->batch(new Request(), $this->loader(), $this->finder());

        self::assertSame('en', $this->renderedContext['aiAlt']['uiLocale'] ?? null);
        self::assertSame('Fill in missing ALT texts', $this->renderedContext['title'] ?? null);
    }

    public function testBatchPageRequiresConfiguredPermission(): void
    {
        $this->expectException(AccessDeniedException::class);

        $this->controller()
            ->batch(new Request(), $this->loader(['permissions' => ['batch_page' => 'ROLE_ADMIN']]), $this->finder());
    }

    public function testMissingReturnsPagedItemsWithEditLinks(): void
    {
        $items = [];
        for ($i = 1; $i <= 5; ++$i) {
            $items[] = ['contentId' => $i, 'locale' => 'cs', 'contentType' => 'pages'];
        }

        $request = new Request(['offset' => '1', 'limit' => '2', 'contenttype' => 'pages']);
        $data = self::decode($this->controller()->missing($request, $this->loader(), $this->finder($items)));

        self::assertSame(5, $data['total']);
        self::assertSame(1, $data['offset']);
        self::assertSame(2, $data['limit']);
        self::assertSame([2, 3], array_column($data['items'], 'contentId'));
        self::assertSame('/bolt_content_edit?id=2&edit_locale=cs', $data['items'][0]['editUrl']);
    }

    public function testMissingOnlyIncludesEditableRecords(): void
    {
        $this->editableIds = [2];
        $items = [];
        foreach ([1, 2, 3] as $id) {
            $items[] = ['contentId' => $id, 'locale' => 'cs', 'contentType' => 'pages'];
        }

        $data = self::decode($this->controller()->missing(new Request(), $this->loader(), $this->finder($items)));
        self::assertSame(1, $data['total']);
        self::assertSame([2], array_column($data['items'], 'contentId'));
    }

    public function testBatchPageDoesNotScanContent(): void
    {
        $finder = $this->createMock(MissingAltFinder::class);
        $finder->method('contentTypes')
            ->willReturn([]);
        $finder->expects(self::never())->method('find');

        $this->controller()
            ->batch(new Request(), $this->loader(), $finder);
    }

    /**
     * @return iterable<string, array{array<string, mixed>, array<string, bool>, string}>
     */
    public static function saveGates(): iterable
    {
        yield 'extension disabled' => [['enabled' => false], [], 'The AI ALT batch page is disabled or not available to you.'];
        yield 'no batch permission' => [[], ['ROLE_EDITOR' => false], 'The AI ALT batch page is disabled or not available to you.'];
        yield 'content type excluded' => [['contenttypes' => ['exclude' => ['pages']]], [], 'AI ALT is not enabled for this content type.'];
    }

    /**
     * @param array<string, mixed> $config
     * @param array<string, bool> $granted
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('saveGates')]
    public function testSaveHonoursExtensionConfig(array $config, array $granted, string $message): void
    {
        $this->granted = $granted + $this->granted;

        $response = $this->controller()
            ->save(
                $this->saveRequest(self::payload()),
                Fixtures::source([Fixtures::content(5)]),
                $this->writer(expectedCalls: 0),
                $this->loader($config)
            );

        self::assertSame(403, $response->getStatusCode());
        self::assertSame($message, self::decode($response)['message']);
    }

    public function testMissingReturnsEverythingInOneResponseByDefault(): void
    {
        $items = array_map(static fn (int $id): array => ['contentId' => $id, 'locale' => 'cs', 'contentType' => 'pages'], range(1, 600));

        $data = self::decode($this->controller()->missing(new Request(), $this->loader(), $this->finder($items)));

        self::assertCount(600, $data['items']);
    }

    public function testMissingClampsPaging(): void
    {
        $request = new Request(['offset' => '-5', 'limit' => '100000']);
        $data = self::decode($this->controller()->missing($request, $this->loader(), $this->finder()));

        self::assertSame(0, $data['offset']);
        self::assertSame(2000, $data['limit']);
    }

    public function testMissingRequiresPermission(): void
    {
        $this->granted['ROLE_EDITOR'] = false;
        $this->expectException(AccessDeniedException::class);

        $this->controller()
            ->missing(new Request(), $this->loader(), $this->finder());
    }

    public function testSaveStoresSanitisedAlt(): void
    {
        $content = Fixtures::content(5);
        $writer = $this->createMock(AltWriter::class);
        $writer->expects(self::once())->method('write')->with($content, 'image', null, 'cs', 'Bagr na stavbě', 'a.jpg');

        $response = $this->controller()
            ->save($this->saveRequest(self::payload()), Fixtures::source([$content]), $writer, $this->loader());

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(['status' => 'saved', 'alt' => 'Bagr na stavbě'], self::decode($response));
    }

    public function testSaveAcceptsTokenInBody(): void
    {
        $response = $this->controller()
            ->save(
                $this->saveRequest(self::payload(['_csrf_token' => self::TOKEN]), []),
                Fixtures::source([Fixtures::content(5)]),
                $this->writer(),
                $this->loader()
            );

        self::assertSame(200, $response->getStatusCode());
    }

    public function testSaveRejectsInvalidCsrf(): void
    {
        $response = $this->controller()
            ->save(
                $this->saveRequest(self::payload(), ['HTTP_X_CSRF_TOKEN' => 'forged']),
                Fixtures::source([Fixtures::content(5)]),
                $this->writer(expectedCalls: 0),
                $this->loader()
            );

        self::assertSame(403, $response->getStatusCode());
        self::assertSame('Invalid CSRF token.', self::decode($response)['message']);
    }

    public function testSaveRejectsMissingCsrf(): void
    {
        $response = $this->controller()
            ->save($this->saveRequest(self::payload(), []), Fixtures::source([]), $this->writer(expectedCalls: 0), $this->loader());

        self::assertSame(403, $response->getStatusCode());
    }

    public function testSaveDeniesUsersWithoutEditPermission(): void
    {
        $this->granted[ContentVoter::CONTENT_EDIT] = false;

        $response = $this->controller()
            ->save($this->saveRequest(self::payload()), Fixtures::source([Fixtures::content(5)]), $this->writer(expectedCalls: 0), $this->loader());

        self::assertSame(403, $response->getStatusCode());
        self::assertSame('You are not allowed to edit this content.', self::decode($response)['message']);
    }

    public function testSaveReturnsConflictWhenAltAlreadyFilled(): void
    {
        $response = $this->controller()
            ->save(
                $this->saveRequest(self::payload()),
                Fixtures::source([Fixtures::content(5)]),
                $this->writer(new AltAlreadyFilledException()),
                $this->loader()
            );

        self::assertSame(409, $response->getStatusCode());
        self::assertSame(['status' => 'error', 'message' => 'The image already has an alt text.'], self::decode($response));
    }

    public function testSaveAsksToRetryWhenTheRecordIsLocked(): void
    {
        $driverException = new class('database is locked') extends AbstractException {
        };

        $response = $this->controller()
            ->save(
                $this->saveRequest(self::payload()),
                Fixtures::source([Fixtures::content(5)]),
                $this->writer(new LockWaitTimeoutException($driverException, null)),
                $this->loader()
            );

        self::assertSame(503, $response->getStatusCode());
        self::assertSame('The record is being saved by someone else, please try again.', self::decode($response)['message']);
    }

    public function testSaveReturnsNotFoundWhenImageIsGone(): void
    {
        $response = $this->controller()
            ->save(
                $this->saveRequest(self::payload()),
                Fixtures::source([Fixtures::content(5)]),
                $this->writer(new ImageNotFoundException()),
                $this->loader()
            );

        self::assertSame(404, $response->getStatusCode());
    }

    public function testSaveReturnsNotFoundForUnknownContent(): void
    {
        $response = $this->controller()
            ->save($this->saveRequest(self::payload(['contentId' => 99])), Fixtures::source([]), $this->writer(expectedCalls: 0), $this->loader());

        self::assertSame(404, $response->getStatusCode());
    }

    /**
     * @return iterable<string, array{array<string, mixed>|string}>
     */
    public static function badRequests(): iterable
    {
        yield 'not json' => ['{nope'];
        yield 'json scalar' => ['"text"'];
        yield 'contentId as string' => [self::payload(['contentId' => '5'])];
        yield 'missing field' => [self::payload(['field' => null])];
        yield 'index as string' => [self::payload(['index' => '1'])];
        yield 'locale missing' => [self::payload(['locale' => null])];
        yield 'filename not string' => [self::payload(['filename' => 5])];
        yield 'alt missing' => [self::payload(['alt' => null])];
        yield 'alt empty after sanitising' => [self::payload(['alt' => ' <br> '])];
        yield 'alt too long' => [self::payload(['alt' => str_repeat('a', BatchController::MAX_ALT_LENGTH + 1)])];
        yield 'alt huge before sanitising' => [self::payload(['alt' => str_repeat('<!--', 100_000)])];
    }

    /**
     * @param array<string, mixed>|string $body
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('badRequests')]
    public function testSaveRejectsBadRequests(array|string $body): void
    {
        $response = $this->controller()
            ->save($this->saveRequest($body), Fixtures::source([Fixtures::content(5)]), $this->writer(expectedCalls: 0), $this->loader());

        self::assertSame(400, $response->getStatusCode());
    }

    public function testSaveAcceptsNullFilenameAndImagelistIndex(): void
    {
        $writer = $this->createMock(AltWriter::class);
        $writer->expects(self::once())->method('write')->with(self::isInstanceOf(Content::class), 'gallery', 2, 'en', 'Dog', null);

        $response = $this->controller()
            ->save(
                $this->saveRequest(self::payload(['field' => 'gallery', 'index' => 2, 'locale' => 'en', 'alt' => 'Dog', 'filename' => null])),
                Fixtures::source([Fixtures::content(5)]),
                $writer,
                $this->loader()
            );

        self::assertSame(200, $response->getStatusCode());
    }
}
