<?php

declare(strict_types=1);

namespace Tomvondracek\AiAlt\Tests\Service;

use Bolt\Configuration\Config;
use Bolt\Configuration\Content\ContentType;
use Bolt\Entity\Content;
use Bolt\Entity\Field\ImageField;
use Illuminate\Support\Collection;
use PHPUnit\Framework\TestCase;
use Tomvondracek\AiAlt\AiAltConfig;
use Tomvondracek\AiAlt\AiAltConfigLoader;
use Tomvondracek\AiAlt\Service\FieldMetaProvider;
use Tomvondracek\AiAlt\Service\ImageFileLocator;
use Tomvondracek\AiAlt\Service\MissingAltFinder;
use Tomvondracek\AiAlt\Tests\Fixtures;

final class MissingAltFinderTest extends TestCase
{
    /** @var list<string> filenames that no longer exist on disk */
    private array $missingFiles = [];

    /**
     * @param list<Content> $contents
     * @param array<string, mixed> $config
     * @param array<string, ContentType>|null $contentTypes
     */
    private function finder(array $contents, array $config = [], ?array $contentTypes = null, mixed $rawContentTypes = null): MissingAltFinder
    {
        $boltConfig = $this->createStub(Config::class);
        $boltConfig->method('get')
            ->willReturnCallback(
                static fn (string $path): mixed => $path === 'contenttypes'
                    ? ($rawContentTypes ?? new Collection($contentTypes ?? [
                        'pages' => Fixtures::contentType(),
                        'entries' => Fixtures::contentType(['name' => 'Entries', 'slug' => 'entries', 'locales' => []]),
                        'blocks' => Fixtures::contentType(['name' => 'Blocks', 'slug' => 'blocks', 'fields' => ['title' => ['type' => 'text']]]),
                    ]))
                    : null
            );

        $loader = $this->createStub(AiAltConfigLoader::class);
        $loader->method('load')
            ->willReturn(AiAltConfig::fromArray($config));

        $fileLocator = $this->createStub(ImageFileLocator::class);
        $fileLocator->method('exists')
            ->willReturnCallback(fn (string $filename): bool => ! in_array($filename, $this->missingFiles, true));

        return new MissingAltFinder($boltConfig, Fixtures::source($contents), new FieldMetaProvider(), $loader, $fileLocator, 'en');
    }

    private function page(int $id): Content
    {
        $content = Fixtures::content($id);
        Fixtures::addImage($content, 'image', ['cs' => ['filename' => "page{$id}.jpg", 'alt' => '']], 'cs');
        Fixtures::addImagelist($content, 'gallery', [
            'cs' => [['filename' => 'g1.jpg', 'alt' => 'Pes'], ['filename' => 'g2.jpg', 'alt' => '']],
            'en' => [['filename' => 'g1.jpg', 'alt' => ''], ['filename' => 'g2.jpg', 'alt' => 'Cat']],
        ]);
        Fixtures::addImage($content, 'logo', ['cs' => ['filename' => 'logo.png', 'alt' => '']], 'cs');

        return $content;
    }

    public function testContentTypesListsOnlyThoseWithAltImages(): void
    {
        $contentTypes = $this->finder([])->contentTypes();

        self::assertSame(['pages', 'entries'], array_keys($contentTypes));
        self::assertSame('Pages', $contentTypes['pages']['name']);
        self::assertSame('cs', $contentTypes['pages']['defaultLocale']);
        self::assertSame('en', $contentTypes['entries']['defaultLocale'], 'no locales → site default');
        self::assertSame(
            [
                'image' => ['type' => 'image', 'localized' => false, 'label' => 'Main image'],
                'gallery' => ['type' => 'imagelist', 'localized' => true, 'label' => 'Gallery'],
            ],
            $contentTypes['pages']['fields']
        );
    }

    public function testContentTypesRespectsConfigFilters(): void
    {
        self::assertSame(['entries'], array_keys($this->finder([], ['contenttypes' => ['exclude' => ['pages']]])->contentTypes()));
        self::assertSame(['pages'], array_keys($this->finder([], ['contenttypes' => ['include' => ['pages']]])->contentTypes()));
    }

    public function testContentTypesToleratesBrokenConfig(): void
    {
        self::assertSame([], $this->finder([], rawContentTypes: 'nope')->contentTypes());
        self::assertSame([], $this->finder([], contentTypes: ['odd' => 'not iterable'])->contentTypes()); // @phpstan-ignore argument.type
    }

    public function testFindsMissingAltsPerLocale(): void
    {
        $items = $this->finder([$this->page(7)])->find();

        self::assertSame([
            [
                'key' => '7:image:-:cs',
                'contentId' => 7,
                'contentType' => 'pages',
                'title' => '#7',
                'field' => 'image',
                'fieldLabel' => 'Main image',
                'index' => null,
                'locale' => 'cs',
                'textLocale' => 'cs',
                'filename' => 'page7.jpg',
            ],
            [
                'key' => '7:gallery:1:cs',
                'contentId' => 7,
                'contentType' => 'pages',
                'title' => '#7',
                'field' => 'gallery',
                'fieldLabel' => 'Gallery',
                'index' => 1,
                'locale' => 'cs',
                'textLocale' => 'cs',
                'filename' => 'g2.jpg',
            ],
            [
                'key' => '7:gallery:0:en',
                'contentId' => 7,
                'contentType' => 'pages',
                'title' => '#7',
                'field' => 'gallery',
                'fieldLabel' => 'Gallery',
                'index' => 0,
                'locale' => 'en',
                'textLocale' => 'en',
                'filename' => 'g1.jpg',
            ],
        ], $items);
    }

    public function testFilterByContentTypeAndCounts(): void
    {
        $entry = Fixtures::content(9, Fixtures::contentType(['name' => 'Entries', 'slug' => 'entries', 'locales' => []]));
        Fixtures::addImage($entry, 'image', ['en' => ['filename' => 'e.jpg']]);

        $finder = $this->finder([$this->page(1), $this->page(2), $entry]);

        self::assertCount(6, $finder->find('pages'));
        self::assertCount(1, $finder->find('entries'));
        self::assertSame([], $finder->find('blocks'));
        self::assertCount(7, $finder->find(''));
        self::assertSame(['pages' => 6, 'entries' => 1], array_count_values(array_column($finder->find(), 'contentType')));

        $entryItem = $finder->find('entries')[0];
        self::assertSame('en', $entryItem['textLocale'], 'non-localized field without ContentType locales uses the site default');
    }

    public function testSkipsFieldsMissingOnTheRecord(): void
    {
        self::assertSame([], $this->finder([Fixtures::content(3)])->find());
    }

    public function testRelevantTranslationsForNonLocalizedField(): void
    {
        $content = Fixtures::content(1);
        $field = Fixtures::addImage($content, 'image', [
            'en' => ['filename' => 'old.jpg'],
            'cs' => ['filename' => 'current.jpg'],
        ], 'cs');

        $translations = MissingAltFinder::relevantTranslations($field, false);
        self::assertCount(1, $translations);
        self::assertSame('cs', $translations[0]->getLocale());

        self::assertCount(2, MissingAltFinder::relevantTranslations($field, true));

        // No row for the default locale: Bolt shows an empty field, and writing
        // the alt into another locale's row would never be displayed.
        $field->setDefaultLocale('de');
        self::assertSame([], MissingAltFinder::relevantTranslations($field, false));

        $single = Fixtures::addImage(Fixtures::content(2), 'image', ['en' => ['filename' => 'a.jpg']], 'cs');
        self::assertSame([], MissingAltFinder::relevantTranslations($single, false), 'a single row in another locale is not read either');

        self::assertSame([], MissingAltFinder::relevantTranslations(new ImageField(), false));
    }

    public function testTitleFallsBackToId(): void
    {
        self::assertSame('#12', MissingAltFinder::title(Fixtures::content(12)));
    }

    public function testSkipsImagesWhoseFileNoLongerExists(): void
    {
        // Bolt's /thumbs route would answer with a "404" placeholder image (HTTP 200)
        // that the model describes as if it were the real picture.
        $this->missingFiles = ['page7.jpg', 'g1.jpg'];

        self::assertSame(['7:gallery:1:cs'], array_column($this->finder([$this->page(7)])->find(), 'key'));
    }

    public function testFiltersRecordsTheUserMayNotEdit(): void
    {
        $asked = [];
        $canEdit = static function (Content $content) use (&$asked): bool {
            $asked[] = $content->getId();

            return $content->getId() === 2;
        };

        $empty = Fixtures::content(3);
        $finder = $this->finder([$this->page(1), $this->page(2), $empty]);

        self::assertSame([2], array_values(array_unique(array_column($finder->find(null, $canEdit), 'contentId'))));
        self::assertSame([1, 2], $asked, 'the voter is only consulted for records with missing alts');
        self::assertCount(3, $finder->find(null, $canEdit));
    }

    public function testCanSkipBuildingTitles(): void
    {
        $content = $this->getMockBuilder(Content::class)->onlyMethods(['getExtras'])->getMock();
        $content->expects(self::never())->method('getExtras');
        $content->setId(4);
        $content->setContentType('pages');
        $content->setDefinition(Fixtures::contentType());
        Fixtures::addImage($content, 'image', ['cs' => ['filename' => 'a.jpg']], 'cs');

        $finder = $this->finder([$content]);

        self::assertSame('', $finder->find(null, null, false)[0]['title']);
    }

    public function testBuildsTheTitleOncePerRecord(): void
    {
        $content = $this->getMockBuilder(Content::class)->onlyMethods(['getExtras'])->getMock();
        $content->expects(self::once())->method('getExtras')->willReturn(['title' => '<b>Bagry</b>']);
        $content->setId(5);
        $content->setContentType('pages');
        $content->setDefinition(Fixtures::contentType());
        Fixtures::addImagelist($content, 'gallery', ['cs' => [['filename' => 'a.jpg'], ['filename' => 'b.jpg'], ['filename' => 'c.jpg']]]);

        self::assertSame(['Bagry', 'Bagry', 'Bagry'], array_column($this->finder([$content])->find(), 'title'));
    }

    public function testIgnoresRowsOfLocalesTheContentTypeNoLongerHas(): void
    {
        $content = Fixtures::content(8);
        Fixtures::addImagelist($content, 'gallery', [
            'cs' => [['filename' => 'a.jpg']],
            'de' => [['filename' => 'a.jpg']],
        ]);

        self::assertSame(['8:gallery:0:cs'], array_column($this->finder([$content])->find(), 'key'));
    }

    public function testContentTypesExposeTheirLocales(): void
    {
        $contentTypes = $this->finder([])->contentTypes();

        self::assertSame(['cs', 'en'], $contentTypes['pages']['locales']);
        self::assertSame([], $contentTypes['entries']['locales']);
        self::assertSame(['cs'], MissingAltFinder::localeList(['cs', '', null, 5]));
        self::assertSame([], MissingAltFinder::localeList('cs'));
    }

    public function testSkipsFormatsBoltCannotThumbnail(): void
    {
        $content = Fixtures::content(9);
        Fixtures::addImagelist($content, 'gallery', [
            'cs' => [['filename' => 'scan.tif'], ['filename' => 'photo.heic'], ['filename' => 'photo.webp']],
        ]);

        self::assertSame(['photo.webp'], array_column($this->finder([$content])->find(), 'filename'));
    }
}
